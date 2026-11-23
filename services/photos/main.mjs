// The photo watcher (docs/photo-pipeline-plan.md): scans Published, keeps the
// index, warms the resizer and commits album files.
//
// Env: PUBLISHED_DIR, INDEX_FILE, SCAN_SECONDS (60), PORT (4331), IMG_ORIGIN
// (http://img:4330). Albums are committed only with PUBLISH_ALBUMS=1 and
// GITHUB_TOKEN; without them the plan is logged and nothing leaves the NAS.
//
// Writes in Published: .site/index.json (the index's backup), and it deletes
// .allow-removals, the file that lets one mass removal through.
import { existsSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isLive, loadIndex, saveIndex } from "../lib/index.mjs";
import { planAlbums, syncAlbums } from "./albums.mjs";
import { githubAlbums } from "./github.mjs";
import { scan } from "./scan.mjs";

export const WARM_TRANSFORMS = [480, 640, 800, 960, 1200, 1280].map((w) => `c_limit,f_auto,q_auto,w_${w}`).concat("c_fill,w_352,h_440,f_auto,q_auto");
export const warmPaths = (id, { version }) =>
  WARM_TRANSFORMS.map((transform) => `/img/upload/${transform}/v${version}/${id.split("/").map(encodeURIComponent).join("/")}.webp`);

export function createWatcher({ root, indexFile, repo = null, warm = null, log = console.log, scanMs = 60_000, now = () => new Date() }) {
  const memory = { seen: new Map(), rejected: new Map() };
  const albumMemory = new Map();
  const told = new Set();
  let status = { ok: false, lastScan: null, error: "no scan yet", photos: 0, blocked: null, skipped: [] };
  let index = loadIndex(indexFile);
  // Starting empty would give every published photo a new id.
  if (!index) throw new Error(`no index at ${indexFile}; run services/photos/seed.mjs first`);

  async function save() {
    await saveIndex(indexFile, index);
    // The copy the share's snapshots carry. Losing it must not stop publishing.
    await saveIndex(join(root, ".site", "index.json"), index).catch((error) => log(`[photos] index backup failed: ${error.message}`));
  }

  async function tick() {
    try {
      // An unmounted or wrong folder can look empty; the removal guard also catches it.
      if (!(await readdir(root)).length && Object.keys(index.photos).length) throw new Error("Published is empty");
      const allowFile = join(root, ".allow-removals");
      const allowRemovals = existsSync(allowFile);
      const result = await scan({ root, index, memory, now: now(), allowRemovals });
      index = result.index;
      if (result.changed) await save();
      // Kept until the removals have gone through (they take two scans).
      if (allowRemovals && result.events.some(({ type }) => type === "removed")) await unlink(allowFile);
      for (const event of result.events) log(`[photos] ${event.type} ${event.id} ${event.from ? `${event.from} -> ` : ""}${event.path}`);
      for (const { path, reason } of result.skipped) if (!told.has(`${path}:${reason}`)) log(`[photos] skipped ${path}: ${reason}`);
      told.clear();
      for (const { path, reason } of result.skipped) told.add(`${path}:${reason}`);

      if (repo) {
        // Nothing is dropped from an album while a mass removal waits for a decision.
        if (!result.blocked && (await syncAlbums({ index, memory: albumMemory, repo, now: now().getTime(), log }))) await save();
      } else {
        for (const { slug, folder, add, remove } of planAlbums(index)) {
          const line = `[albums] not publishing: ${slug ?? "new album"} from "${folder}" +${add.length} -${remove.length}`;
          if (!albumMemory.has(line)) log(line);
          albumMemory.set(line, true);
        }
      }
      status = {
        ok: !result.blocked,
        lastScan: now().toISOString(),
        error: result.blocked ? `${result.blocked.missing} photos are missing at once (limit ${result.blocked.limit}); nothing was removed. Put them back, or create .allow-removals in Published.` : null,
        photos: Object.values(index.photos).filter(isLive).length,
        blocked: result.blocked,
        skipped: result.skipped,
      };
      if (status.error) log(`[photos] ${status.error}`);
      if (warm) warm(result.events.filter(({ type }) => type === "added" || type === "replaced" || type === "restored").map(({ id }) => [id, index.photos[id]]));
      return result;
    } catch (error) {
      status = { ...status, ok: false, error: error.message };
      log(`[photos] scan failed, nothing changed: ${error.message}`);
      return null;
    }
  }

  return {
    tick,
    get index() {
      return index;
    },
    health: () => {
      const stale = !status.lastScan || now() - new Date(status.lastScan) > Math.max(5 * 60_000, scanMs * 5);
      return { ...status, ok: status.ok && !stale, skipped: status.skipped.length };
    },
  };
}

/** Fetches previews one at a time so the first visitor doesn't wait for them. */
export function createWarmer(origin, { log = console.log, fetch = globalThis.fetch } = {}) {
  let tail = Promise.resolve();
  return (photos) => {
    for (const [id, photo] of photos) {
      if (photo.kind !== "photo") continue;
      for (const path of warmPaths(id, photo)) {
        tail = tail.then(async () => {
          try {
            const res = await fetch(origin + path, { signal: AbortSignal.timeout(60_000) });
            await res.arrayBuffer();
            if (!res.ok) log(`[warm] ${res.status} ${path}`);
          } catch (error) {
            log(`[warm] ${error.message} ${path}`);
          }
        });
      }
    }
    return tail;
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const scanMs = (Number(process.env.SCAN_SECONDS) || 60) * 1000;
  const publish = process.env.PUBLISH_ALBUMS === "1" && process.env.GITHUB_TOKEN;
  const watcher = createWatcher({
    root: process.env.PUBLISHED_DIR || "/published",
    indexFile: process.env.INDEX_FILE || "/index/index.json",
    repo: publish ? githubAlbums({ token: process.env.GITHUB_TOKEN, repo: process.env.GITHUB_REPO || "liambsulliva/personal-website-v3", branch: process.env.GITHUB_BRANCH || "main" }) : null,
    warm: createWarmer(process.env.IMG_ORIGIN || "http://img:4330"),
    scanMs,
  });
  createServer((req, res) => {
    const health = watcher.health();
    const found = (req.url ?? "").split("?", 1)[0] === "/healthz";
    res.writeHead(found ? (health.ok ? 200 : 503) : 404, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(found ? `${JSON.stringify(health)}\n` : "{}\n");
  }).listen(Number(process.env.PORT || 4331), process.env.HOST || "0.0.0.0");

  let stop = false;
  let wake = () => {};
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      stop = true;
      wake();
    });
  }
  // Each scan finishes before the next starts, and before the process exits.
  while (!stop) {
    await watcher.tick();
    if (!stop) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, scanMs);
        wake = () => (clearTimeout(timer), resolve());
      });
    }
  }
  process.exit(0);
}
