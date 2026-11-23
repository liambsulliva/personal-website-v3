// Resizes photos from /photography/Published (docs/photo-pipeline-plan.md).
// Reads the photo index and the originals, both mounted read-only; holds no
// secrets. Two renders at a time, plus one large one; each result is kept on disk.
//
// Env: PORT (4330), HOST, INDEX_FILE, PUBLISHED_DIR, CACHE_DIR, CACHE_MAX_BYTES, JOBS (2).
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { indexReader, isLive } from "../lib/index.mjs";
import { DiskCache } from "./cache.mjs";
import { CONTENT_TYPES, render } from "./render.mjs";
import { parsePath, PIPELINE, resolve } from "./transforms.mjs";

const IMMUTABLE = "public, max-age=31536000, immutable";
/** No version in the URL, or an old one: the bytes behind it can change. */
const SHORT = "public, max-age=3600, stale-while-revalidate=86400";
const NO_STORE = "no-store";

/** Runs at most `jobs` at once; refuses work past `maxQueue` instead of piling it up. */
export function pool(jobs, maxQueue) {
  let running = 0;
  const queue = [];
  const next = () => {
    if (running >= jobs || !queue.length) return;
    running++;
    const { work, done, fail } = queue.shift();
    work()
      .then(done, fail)
      .finally(() => {
        running--;
        next();
      });
  };
  return {
    run(work) {
      if (queue.length >= maxQueue) return Promise.reject(Object.assign(new Error("busy"), { code: "BUSY" }));
      return new Promise((done, fail) => {
        queue.push({ work, done, fail });
        next();
      });
    },
    get waiting() {
      return queue.length;
    },
  };
}

export function createImgServer({ indexFile, publishedDir, cacheDir, cacheMaxBytes, jobs = 2, maxQueue = 200, renderImage = render }) {
  const readIndex = indexReader(indexFile);
  const cache = new DiskCache(cacheDir, { maxBytes: cacheMaxBytes });
  const work = pool(jobs, maxQueue);
  // A lightbox size takes several times a thumbnail's memory and time, so those
  // run one by one and never hold up the thumbnails.
  const largeWork = pool(1, maxQueue);
  const isLarge = ({ width, height, natural }) => width * (height ?? (width * natural.height) / natural.width) > 3e6;
  const inFlight = new Map();
  let root;

  /** The original on disk; null if it resolves outside Published (a symlink). */
  async function original(photo) {
    root ??= await realpath(publishedDir);
    const file = await realpath(join(root, photo.path));
    return file.startsWith(root + sep) ? file : null;
  }

  async function image(photo, id, spec) {
    const key = [PIPELINE, id, photo.version, spec.key].join("|");
    const file = cache.name(key, spec.format);
    const hit = await cache.get(file);
    if (hit) return { body: hit, key };
    if (!inFlight.has(file)) {
      const job = (isLarge(spec) ? largeWork : work)
        .run(async () => {
          const source = await original(photo);
          if (!source) throw Object.assign(new Error("outside Published"), { code: "ENOENT" });
          const body = await renderImage(source, { ...spec, animated: photo.format === "gif" });
          // A full or read-only cache disk must not stop the image being served.
          await cache.put(file, body).catch((error) => console.error("[img] cache write failed:", error.message));
          return body;
        })
        .finally(() => inFlight.delete(file));
      inFlight.set(file, job);
    }
    return { body: await inFlight.get(file), key };
  }

  const send = (res, status, headers, body) => {
    res.writeHead(status, { "X-Content-Type-Options": "nosniff", ...headers });
    res.end(res.req.method === "HEAD" ? undefined : body);
  };
  const fail = (res, status, message, headers = {}) => send(res, status, { "Content-Type": "text/plain", "Cache-Control": NO_STORE, ...headers }, `${message}\n`);

  async function handle(req, res) {
    const path = (req.url ?? "/").split(/[?#]/, 1)[0];
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
    const index = readIndex();
    if (path === "/healthz") {
      const body = JSON.stringify({ ok: Boolean(index), photos: index ? Object.keys(index.photos).length : 0, waiting: work.waiting + largeWork.waiting, cacheBytes: cache.bytes });
      return send(res, index ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": NO_STORE }, `${body}\n`);
    }
    const request = parsePath(path);
    if (!request) return fail(res, 404, "Not found");
    if (!index) return fail(res, 503, "No photo index", { "Retry-After": "10" });

    // An id can end in something that looks like an extension; the whole name wins.
    const id = Object.hasOwn(index.photos, request.rawId) ? request.rawId : request.id;
    const photo = Object.hasOwn(index.photos, id) ? index.photos[id] : null;
    if (!isLive(photo)) return fail(res, 404, "Not found");
    const spec = resolve(request.transform, photo);
    if (!spec) return fail(res, 404, "Not found");

    try {
      const { body, key } = await image(photo, id, spec);
      const etag = `"${createHash("sha1").update(key).digest("base64url")}"`;
      const headers = {
        "Content-Type": CONTENT_TYPES[spec.format],
        "Cache-Control": request.version && photo.version.startsWith(request.version) ? IMMUTABLE : SHORT,
        ETag: etag,
      };
      if (req.headers["if-none-match"] === etag) return send(res, 304, headers);
      return send(res, 200, { ...headers, "Content-Length": body.length }, body);
    } catch (error) {
      if (error.code === "BUSY") return fail(res, 503, "Busy", { "Retry-After": "5" });
      // The index can name a file that was just moved or removed.
      if (error.code === "ENOENT") return fail(res, 404, "Not found");
      console.error(`[img] ${id} ${spec.key}:`, error.message);
      return fail(res, 500, "Could not render");
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      console.error("[img]", error);
      res.headersSent ? res.destroy() : fail(res, 500, "Error");
    });
  });
  // As in the site's server.mjs: longer than cloudflared's 90 s idle connections.
  server.keepAliveTimeout = 95_000;
  server.headersTimeout = 96_000;
  return Object.assign(server, { cache });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createImgServer({
    indexFile: process.env.INDEX_FILE || "/index/index.json",
    publishedDir: process.env.PUBLISHED_DIR || "/published",
    cacheDir: process.env.CACHE_DIR || "/cache",
    cacheMaxBytes: Number(process.env.CACHE_MAX_BYTES) || 5e9,
    jobs: Number(process.env.JOBS) || 2,
  });
  await server.cache.sweep().catch((error) => console.error("[cache]", error.message));
  const port = Number(process.env.PORT || 4330);
  server.listen(port, process.env.HOST || "0.0.0.0", () => console.log(`[img] listening on ${port}`));
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }
}
