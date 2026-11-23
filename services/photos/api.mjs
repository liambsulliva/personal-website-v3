// What cms-dashboard can do to the library, in the shapes Cloudinary used
// (docs/photo-pipeline-plan.md):
//
//   GET  /v1/photos, /v1/site-images     { resources: [Photo] }
//   POST /v1/tags                        { ids, tag, command: "add" | "remove" }
//   GET  /v1/status                      the watcher's health, folders and pending albums
//   POST /v1/delete                      { ids } -> { deleted: { id: "deleted" | "not_found" } }
//   POST /v1/restore                     { ids } -> { restored: { id: "restored" | "not_found" | "taken" } }
//   POST /v1/site-image                  multipart: file, public_id (replaces)
//   POST /upload?timestamp&tags&folder&name&signature   multipart: file
//
// /v1 needs `Authorization: Bearer <PHOTOS_API_SECRET>`, on top of Cloudflare
// Access in front of it. /upload comes straight from the browser, so it takes a
// short-lived signature the dashboard's server makes with the same secret,
// checked before any of the file is read.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { link, mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isLive, TAG_RE, tagsOf } from "../lib/index.mjs";
import { readMetadata } from "./metadata.mjs";
import { newId, versionOf } from "./scan.mjs";

/** The dashboard's own ceiling. */
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_BODY = MAX_IMAGE_BYTES + 64 * 1024;
const MAX_JSON = 1024 * 1024;
const SIGNATURE_MS = 15 * 60_000;
const KEEP_DELETED_MS = 30 * 86_400_000;
// The same rule as the dashboard's shared/utils/upload.ts.
const SITE_ID = /^site\/(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-]+$/;
const EXT = { jpeg: "jpg", png: "png", webp: "webp", tiff: "tif", gif: "gif", svg: "svg" };
const PHOTO_FORMATS = new Set(["jpeg", "png", "webp", "tiff"]);
export const TRASH = ".site/deleted";

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const digest = (text) => createHash("sha256").update(text).digest();
const same = (a, b) => timingSafeEqual(digest(String(a)), digest(String(b)));

/** Signs an upload: the sorted k=v pairs, as Cloudinary's upload API did, with HMAC-SHA256. */
export const signUpload = (params, secret) =>
  createHmac("sha256", secret)
    .update(
      Object.keys(params)
        .filter((key) => params[key] !== undefined && params[key] !== "")
        .sort()
        .map((key) => `${key}=${params[key]}`)
        .join("&"),
    )
    .digest("hex");

const encodeId = (id) => id.split("/").map(encodeURIComponent).join("/");
const toPhoto = (id, photo, origin) => ({
  public_id: id,
  secure_url: `${origin}/img/upload/v${photo.version}/${encodeId(id)}.webp`,
  width: photo.width,
  height: photo.height,
  format: EXT[photo.format] ?? photo.format,
  bytes: photo.bytes,
  created_at: photo.createdAt,
  folder: photo.kind === "site" ? id.slice(0, id.lastIndexOf("/")) : photo.path.slice(0, Math.max(0, photo.path.indexOf("/"))),
  filename: photo.path.slice(photo.path.lastIndexOf("/") + 1),
  version: photo.version,
  taken_at: photo.takenAt ?? undefined,
  tags: tagsOf(photo),
});

/**
 * A folder an upload may go to: _unsorted, or a shoot folder the watcher would
 * publish. Null for anything else (a path, a hidden or reserved name).
 */
export function uploadFolder(name) {
  if (name === "" || name === "_unsorted") return "_unsorted";
  // eslint-disable-next-line no-control-regex
  if (name.length > 100 || name !== name.trim() || /^[._@#~]|[\\/:*?"<>|\x00-\x1f]|\.$/.test(name)) return null;
  return name;
}

/** "IMG 1.jpeg" → "IMG 1": the file's own name, without anything a path could be made of. */
export const uploadName = (name) =>
  name
    .replace(/\.[^.]*$/, "")
    .replace(/[^\p{L}\p{N} ._()&+,'-]/gu, "_")
    .replace(/^[._@#~ ]+|[. ]+$/g, "")
    .slice(0, 100);

/** Empties the trash of what was deleted more than 30 days ago. Touches nothing else. */
export async function emptyTrash(root, now = Date.now()) {
  const dir = join(root, TRASH);
  for (const name of await readdir(dir).catch(() => [])) {
    const at = Number(/^(\d{13})-/.exec(name)?.[1]);
    if (at && now - at > KEEP_DELETED_MS) await unlink(join(dir, name));
  }
}

/**
 * @param options.watcher  its `mutate` runs a change to the index alone and saves it
 */
export function createApi({ watcher, root, secret, origin = "https://liambsullivan.com", dashboardOrigin = "", now = () => Date.now(), warm = null, log = console.log }) {
  let uploads = 0;
  const waiting = [];
  let trashed = 0;

  async function body(req, limit) {
    const length = Number(req.headers["content-length"]);
    if (length > limit) throw new ApiError(413, "That file is too large");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new ApiError(413, "That file is too large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async function json(req) {
    try {
      const value = JSON.parse((await body(req, MAX_JSON)).toString("utf8"));
      if (value && typeof value === "object") return value;
    } catch (error) {
      if (error instanceof ApiError) throw error;
    }
    throw new ApiError(400, "Expected a JSON object");
  }

  /** A multipart body, at most two in memory at a time. The rest wait unread: the dashboard sends three. */
  async function form(req) {
    if (uploads >= 2) {
      if (waiting.length >= 30) throw new ApiError(429, "Too many uploads at once; try again");
      await new Promise((resolve) => waiting.push(resolve)); // takes over the slot it's woken with
    } else {
      uploads++;
    }
    try {
      const bytes = await body(req, MAX_BODY);
      const data = await new Request("http://photos", { method: "POST", headers: { "content-type": req.headers["content-type"] ?? "" }, body: bytes }).formData().catch(() => {
        throw new ApiError(400, "Expected a multipart form");
      });
      const file = data.get("file");
      if (!file || typeof file === "string") throw new ApiError(400, "No image file");
      const buffer = Buffer.from(await file.arrayBuffer());
      if (buffer.length > MAX_IMAGE_BYTES) throw new ApiError(413, "Image is larger than 16 MB");
      return { fields: Object.fromEntries([...data].filter(([, value]) => typeof value === "string")), buffer };
    } finally {
      const next = waiting.shift();
      if (next) next();
      else uploads--;
    }
  }

  async function metadata(buffer, formats) {
    const meta = await readMetadata(buffer).catch(() => null);
    if (!meta || (formats && !formats.has(meta.format))) throw new ApiError(415, "That isn't an image type this site can publish. Export a JPEG.");
    return { ...meta, fileTags: meta.fileTags.filter((tag) => TAG_RE.test(tag)) };
  }

  /** Writes next to the target under a name the watcher ignores, then moves it into place. */
  async function place(path, buffer, { replace }) {
    const file = join(root, path);
    const temp = join(dirname(file), `.upload-${process.pid}-${now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temp, buffer);
    try {
      if (replace) await rename(temp, file);
      else await link(temp, file); // fails if the name is taken
    } finally {
      await unlink(temp).catch(() => {});
    }
    const info = await stat(file);
    return `${info.size}:${Math.trunc(info.mtimeMs)}`;
  }

  async function toTrash(path, id) {
    const dir = join(root, TRASH);
    await mkdir(dir, { recursive: true });
    const name = `${now()}-${trashed++}-${id.replaceAll("/", "_")}-${path.slice(path.lastIndexOf("/") + 1)}`;
    await rename(join(root, path), join(dir, name.slice(0, 200))).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  const facts = (kind, path, sig, buffer, meta) => {
    const hash = createHash("sha256").update(buffer).digest("hex");
    return { path, kind, sig, hash, version: versionOf(hash), bytes: buffer.length, ...meta };
  };

  const list = (kind) => ({
    resources: Object.entries(watcher.index.photos)
      .filter(([, photo]) => photo.kind === kind && isLive(photo))
      .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
      .map(([id, photo]) => toPhoto(id, photo, origin)),
  });

  function idsOf({ ids }) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 2000 || !ids.every((id) => typeof id === "string" && id.length < 300)) throw new ApiError(400, "Expected 1 to 2000 ids");
    return [...new Set(ids)];
  }

  const livePhoto = (index, id) => (Object.hasOwn(index.photos, id) && isLive(index.photos[id]) ? index.photos[id] : null);

  async function tags(req) {
    const input = await json(req);
    const ids = idsOf(input);
    const { tag, command } = input;
    if (typeof tag !== "string" || !TAG_RE.test(tag)) throw new ApiError(400, "Tags may only use letters, numbers, _ . : -");
    if (command !== "add" && command !== "remove") throw new ApiError(400, "command must be add or remove");
    return watcher.mutate((index) => {
      const changed = [];
      for (const id of ids) {
        const photo = livePhoto(index, id);
        if (!photo) continue;
        const edits = { ...photo.tagEdits, [tag]: command === "add" };
        // Only differences from the file are kept.
        if ((photo.fileTags ?? []).includes(tag) === edits[tag]) delete edits[tag];
        if (Object.keys(edits).length) photo.tagEdits = edits;
        else delete photo.tagEdits;
        changed.push(id);
      }
      return { public_ids: changed };
    });
  }

  async function remove(req) {
    const ids = idsOf(await json(req));
    return watcher.mutate(async (index) => {
      const deleted = Object.create(null);
      for (const id of ids) {
        const photo = livePhoto(index, id);
        deleted[id] = photo ? "deleted" : "not_found";
        if (!photo) continue;
        await toTrash(photo.path, id);
        photo.goneAt = new Date(now()).toISOString();
        delete photo.missing;
        log(`[api] deleted ${id} (${photo.path})`);
      }
      return { deleted };
    });
  }

  /** Undoes a delete, within the 30 days. */
  async function restore(req) {
    const ids = idsOf(await json(req));
    return watcher.mutate(async (index) => {
      const restored = Object.create(null);
      const trash = await readdir(join(root, TRASH)).catch(() => []);
      for (const id of ids) {
        const photo = Object.hasOwn(index.photos, id) ? index.photos[id] : null;
        restored[id] = "not_found";
        if (!photo?.goneAt) continue;
        const ending = `-${id.replaceAll("/", "_")}-${photo.path.slice(photo.path.lastIndexOf("/") + 1)}`;
        const name = trash.filter((file) => /^\d{13}-\d+/.test(file) && file.replace(/^\d{13}-\d+/, "") === ending).sort().at(-1);
        if (!name) continue;
        const file = join(root, photo.path);
        try {
          await mkdir(dirname(file), { recursive: true });
          await link(join(root, TRASH, name), file); // fails if something took its place
          await unlink(join(root, TRASH, name));
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          restored[id] = "taken";
          continue;
        }
        const info = await stat(file);
        photo.sig = `${info.size}:${Math.trunc(info.mtimeMs)}`;
        delete photo.goneAt;
        delete photo.missing;
        restored[id] = "restored";
        log(`[api] restored ${id} (${photo.path})`);
      }
      return { restored };
    });
  }

  async function siteImage(req) {
    const { fields, buffer } = await form(req);
    const id = fields.public_id ?? "";
    if (id.length > 255 || !SITE_ID.test(id)) throw new ApiError(400, "Uploads must land under site/…");
    const meta = await metadata(buffer);
    return watcher.mutate(async (index) => {
      const was = livePhoto(index, id);
      const path = `_site/${id.slice("site/".length)}.${EXT[meta.format]}`;
      if (was) await toTrash(was.path, id);
      const sig = await place(path, buffer, { replace: true });
      index.photos[id] = { ...facts("site", path, sig, buffer, meta), createdAt: was?.createdAt ?? new Date(now()).toISOString() };
      log(`[api] ${was ? "replaced" : "added"} ${id}`);
      return toPhoto(id, index.photos[id], origin);
    });
  }

  async function upload(req) {
    const query = new URL(req.url, "http://photos").searchParams;
    const [timestamp, tagList, folderName, fileName, signature] = ["timestamp", "tags", "folder", "name", "signature"].map((name) => query.get(name) ?? "");
    const age = now() - Number(timestamp) * 1000;
    if (!/^\d{10}$/.test(timestamp) || age > SIGNATURE_MS || age < -60_000) throw new ApiError(401, "That upload link has expired; try again");
    if (!same(signature, signUpload({ timestamp, tags: tagList, folder: folderName, name: fileName }, secret))) throw new ApiError(401, "Invalid signature");
    const wanted = tagList ? tagList.split(",") : [];
    if (!wanted.every((tag) => TAG_RE.test(tag))) throw new ApiError(400, "Invalid tag");
    const folder = uploadFolder(folderName);
    if (folder === null) throw new ApiError(400, "That folder name can't be used");
    const { buffer } = await form(req);
    const meta = await metadata(buffer, PHOTO_FORMATS);
    const result = await watcher.mutate(async (index) => {
      const hash = createHash("sha256").update(buffer).digest("hex");
      const twin = Object.entries(index.photos).find(([, photo]) => photo.kind === "photo" && isLive(photo) && photo.hash === hash);
      if (twin) throw new ApiError(409, `That photo is already published (${twin[1].path})`);
      const id = newId(index.photos);
      const base = uploadName(fileName) || id;
      let path, sig;
      // The file keeps its name, so a later Lightroom export over it replaces it.
      for (let n = 1; !sig; n++) {
        path = `${folder}/${base}${n > 1 ? `-${n}` : ""}.${EXT[meta.format]}`;
        sig = await place(path, buffer, { replace: false }).catch((error) => {
          if (error.code !== "EEXIST" || n >= 50) throw error;
        });
      }
      const edits = Object.fromEntries(wanted.filter((tag) => !meta.fileTags.includes(tag)).map((tag) => [tag, true]));
      index.photos[id] = { ...facts("photo", path, sig, buffer, meta), ...(Object.keys(edits).length ? { tagEdits: edits } : {}), createdAt: new Date(now()).toISOString() };
      log(`[api] uploaded ${id} (${path})`);
      return [id, index.photos[id]];
    });
    warm?.([result]);
    return toPhoto(...result, origin);
  }

  const ROUTES = {
    "GET /v1/photos": () => list("photo"),
    "GET /v1/site-images": () => list("site"),
    "GET /v1/status": () => watcher.report(),
    "POST /v1/tags": tags,
    "POST /v1/delete": remove,
    "POST /v1/restore": restore,
    "POST /v1/site-image": siteImage,
    "POST /upload": upload,
  };

  return async function handle(req, res) {
    const path = (req.url ?? "/").split("?", 1)[0];
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
    if (path === "/upload" && dashboardOrigin && req.headers.origin === dashboardOrigin) {
      Object.assign(headers, { "Access-Control-Allow-Origin": dashboardOrigin, Vary: "Origin" });
    }
    const send = (status, value) => {
      // Nothing more is read from a request that was refused early.
      if (!req.complete) headers.Connection = "close";
      res.writeHead(status, headers);
      res.end(value === null ? undefined : JSON.stringify(value));
    };
    try {
      if (req.method === "OPTIONS" && path === "/upload") {
        if (headers["Access-Control-Allow-Origin"]) Object.assign(headers, { "Access-Control-Allow-Methods": "POST", "Access-Control-Max-Age": "600" });
        return send(204, null);
      }
      const route = ROUTES[`${req.method} ${path}`];
      if (path.startsWith("/v1/") && !same(req.headers.authorization ?? "", `Bearer ${secret}`)) throw new ApiError(401, "Unauthorized");
      if (!route) throw new ApiError(404, "Not found");
      send(200, await route(req));
    } catch (error) {
      if (!(error instanceof ApiError)) log(`[api] ${req.method} ${path}: ${error.stack ?? error}`);
      send(error instanceof ApiError ? error.status : 500, { error: { message: error instanceof ApiError ? error.message : "The photo service failed; nothing was confirmed" } });
    }
  };
}
