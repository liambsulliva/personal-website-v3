// The photo watcher (docs/photo-pipeline-plan.md, docs/folder-albums-plan.md):
// scans Published, keeps the index and each album's album.yaml, warms the resizer.
//
// Env: PUBLISHED_DIR, INDEX_FILE, SCAN_SECONDS (10), PORT (4331), IMG_ORIGIN
// (http://img:4330). The dashboard's API (api.mjs) runs only with
// PHOTOS_API_SECRET (32+ characters); DASHBOARD_ORIGIN is the one site that may
// upload from a browser. It has no route to the GitHub token.
//
// Writes in Published: .site/index.json (the index's backup), album.yaml in
// album folders, what the dashboard asks for (api.mjs), and deletes
// (.site/deleted, emptied after 30 days).
import { renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isLive, loadIndex, saveIndex } from "../lib/index.mjs";
import { createApi, emptyTrash } from "./api.mjs";
import { newFolderMemory, saveFolders, syncFolders } from "./folders.mjs";
import { listPublished, scan } from "./scan.mjs";

export const WARM_TRANSFORMS = [480, 640, 800, 960, 1200, 1280].map((w) => `c_limit,f_auto,q_auto,w_${w}`).concat("c_fill,w_352,h_440,f_auto,q_auto");
export const warmPaths = (id, { version }) =>
  WARM_TRANSFORMS.map((transform) => `/img/upload/${transform}/v${version}/${id.split("/").map(encodeURIComponent).join("/")}.webp`);

export function createWatcher({ root, indexFile, warm = null, log = console.log, scanMs = 10_000, now = () => new Date() }) {
  const memory = { seen: new Map(), rejected: new Map() };
  const folderMemory = newFolderMemory();
  /** Photos a person said may go, though 100 or more are missing. */
  let confirmed = new Set();
  const told = new Set();
  let status = { ok: false, lastScan: null, error: "no scan yet", photos: 0, blocked: null, skipped: [] };
  let index = loadIndex(indexFile);
  if (!index) {
    // A new host, or a lost disk: the copy that lives with the photos.
    index = loadIndex(join(root, ".site", "index.json"));
    // Starting empty would give every published photo a new id.
    if (!index) throw new Error(`no index at ${indexFile} or in Published/.site`);
    writeFileSync(`${indexFile}.tmp`, `${JSON.stringify(index)}\n`);
    renameSync(`${indexFile}.tmp`, indexFile);
    log(`[photos] restored the index from Published/.site (${Object.keys(index.photos).length} images)`);
  }

  // Scans and API changes take turns, so neither works from a stale index.
  let turn = Promise.resolve();
  function alone(work) {
    const result = turn.then(work);
    turn = result.catch(() => {});
    return result;
  }

  async function save() {
    await saveIndex(indexFile, index);
    // The copy the share's snapshots carry. Losing it must not stop publishing.
    await saveIndex(join(root, ".site", "index.json"), index).catch((error) => log(`[photos] index backup failed: ${error.message}`));
  }

  async function tick() {
    try {
      const result = await alone(async () => {
        const listing = await listPublished(root);
        const scanned = await scan({ root, index, memory, now: now(), confirmed, listing });
        const next = scanned.changed ? scanned.index : structuredClone(index);
        const albums = await syncFolders({ root, index: next, folders: listing.folders, events: scanned.events, memory: folderMemory, blocked: scanned.blocked, log });
        if (scanned.changed || albums.changed) {
          index = next;
          await save();
        }
        return { ...scanned, skipped: [...albums.problems, ...scanned.skipped] };
      });
      if (!result.blocked) confirmed = new Set();
      for (const event of result.events) log(`[photos] ${event.type} ${event.id} ${event.from ? `${event.from} -> ` : ""}${event.path}`);
      for (const { path, reason } of result.skipped) if (!told.has(`${path}:${reason}`)) log(`[photos] skipped ${path}: ${reason}`);
      told.clear();
      for (const { path, reason } of result.skipped) told.add(`${path}:${reason}`);

      const hold = result.blocked ? `${result.blocked.missing} photos are missing at once; nothing was removed. Put them back, or confirm the removal in the dashboard.` : null;
      if (hold && hold !== status.error) log(`[photos] ${hold}`);
      status = {
        ok: !result.blocked,
        lastScan: now().toISOString(),
        error: hold,
        photos: Object.values(index.photos).filter(isLive).length,
        blocked: result.blocked,
        skipped: result.skipped,
      };
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
    /**
     * Runs `change(index)` by itself, gives its albums their links and files,
     * and saves. If it throws, whatever it did to files is picked up by the next scan.
     */
    mutate: (change) =>
      alone(async () => {
        const next = structuredClone(index);
        const result = await change(next);
        const { folders } = await listPublished(root);
        await saveFolders({ root, index: next, onDisk: new Map(folders.map(({ path, file }) => [path, file])), memory: folderMemory, log });
        index = next;
        await save();
        return result;
      }),
    /** Lets the removals a person has seen go through, and nothing that went missing since. */
    async confirmRemoval(key) {
      if (!status.blocked || status.blocked.key !== key) return null;
      const { missing, ids } = status.blocked;
      confirmed = new Set([...confirmed, ...ids]);
      log(`[photos] removal of ${missing} photos confirmed`);
      await tick();
      return { confirmed: missing };
    },
    get index() {
      return index;
    },
    /** For the dashboard: what the service sees. */
    report() {
      return { ...this.health(), skipped: status.skipped };
    },
    health: () => {
      const stale = !status.lastScan || now() - new Date(status.lastScan) > Math.max(5 * 60_000, scanMs * 5);
      const blocked = status.blocked && { missing: status.blocked.missing, folders: status.blocked.folders, key: status.blocked.key };
      return { ...status, blocked, ok: status.ok && !stale, skipped: status.skipped.length };
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
  const scanMs = (Number(process.env.SCAN_SECONDS) || 10) * 1000;
  const watcher = createWatcher({
    root: process.env.PUBLISHED_DIR || "/published",
    indexFile: process.env.INDEX_FILE || "/index/index.json",
    warm: createWarmer(process.env.IMG_ORIGIN || "http://img:4330"),
    scanMs,
  });
  const secret = process.env.PHOTOS_API_SECRET ?? "";
  if (secret && secret.length < 32) throw new Error("PHOTOS_API_SECRET must be at least 32 characters");
  const api = secret ? createApi({ watcher, root: process.env.PUBLISHED_DIR || "/published", secret, dashboardOrigin: process.env.DASHBOARD_ORIGIN || "", warm: createWarmer(process.env.IMG_ORIGIN || "http://img:4330") }) : null;
  createServer((req, res) => {
    const path = (req.url ?? "").split("?", 1)[0];
    if (api && path !== "/healthz") return void api(req, res);
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
    await emptyTrash(process.env.PUBLISHED_DIR || "/published").catch((error) => console.error("[photos] trash:", error.message));
    if (!stop) {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, scanMs);
        wake = () => (clearTimeout(timer), resolve());
      });
    }
  }
  process.exit(0);
}
