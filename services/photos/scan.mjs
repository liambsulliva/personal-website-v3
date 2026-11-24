// One pass over Published: compare what's on disk with the index and return
// the index that should replace it. Never writes to Published.
//
//   new       same size and mtime in two scans running, and it decodes
//   replaced  the same for a known path with other bytes: keeps its id
//   moved     a known photo's bytes at a new path, its old path gone: keeps its id
//   restored  an unpublished photo's bytes are back within 30 days: keeps its id
//   removed   missing for two scans running; 100 or more at once wait for a person
//
// Folders and their album.yaml are folders.mjs's.
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { dirName, isAlbumFolder } from "../lib/albums.mjs";
import { TAG_RE } from "../lib/index.mjs";
import { ALBUM_FILE, sigOf } from "./albumFile.mjs";
import { readMetadata } from "./metadata.mjs";

const MAX_BYTES = 50e6;
const PHOTO_EXT = /\.(jpe?g|png|webp|tiff?)$/i;
const SITE_EXT = /\.(jpe?g|png|webp|tiff?|gif|svg)$/i;
const KEEP_GONE_MS = 30 * 86_400_000;
const SITE_DIR = "_site";

/** Dotfiles, DSM's @eaDir and #recycle, Lightroom's and SMB's temporaries. */
const isHidden = (name) => /^[.@#~]/.test(name) || /\.(tmp|part|crdownload|download)$/i.test(name) || name === "Thumbs.db";

/**
 * What's in Published, at any depth. Symlinks aren't followed.
 * files: what could be published; folders: every album folder, with its
 * album.yaml's sig (null without one).
 */
export async function listPublished(root) {
  const files = [];
  const folders = [];
  const skipped = [];
  const statOrNull = (path) =>
    stat(join(root, path)).catch((error) => {
      if (error.code === "ENOENT") return null; // gone between the listing and here: treat it as not there
      throw error; // the share is failing: change nothing
    });
  async function walk(dir, names) {
    for (const entry of names) {
      if (isHidden(entry.name)) continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      const site = path === SITE_DIR || path.startsWith(`${SITE_DIR}/`);
      if (entry.isDirectory()) {
        const info = await statOrNull(path);
        const inside = info && (await readdir(join(root, path), { withFileTypes: true }).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }));
        if (!inside) continue;
        if (isAlbumFolder(path)) {
          const file = inside.some((child) => child.name === ALBUM_FILE && child.isFile()) ? await statOrNull(`${path}/${ALBUM_FILE}`) : null;
          folders.push({ path, ino: info.ino, file: file && sigOf(file) });
        }
        await walk(path, inside);
      } else if (!entry.isFile()) {
        skipped.push({ path, reason: "not a regular file" });
      } else if (entry.name === ALBUM_FILE && isAlbumFolder(dir)) {
        continue;
      } else if (!(site ? SITE_EXT : PHOTO_EXT).test(entry.name)) {
        skipped.push({ path, reason: "not an image type that's published" });
      } else {
        const info = await statOrNull(path);
        if (!info) continue;
        if (info.size > MAX_BYTES) skipped.push({ path, reason: "over 50 MB" });
        files.push({ path, kind: site ? "site" : "photo", size: info.size, sig: sigOf(info), mtime: Math.trunc(info.mtimeMs), tooBig: info.size > MAX_BYTES });
      }
    }
  }
  const top = await readdir(root, { withFileTypes: true });
  await walk("", top);
  return { files, folders, skipped, empty: top.every((entry) => isHidden(entry.name)) };
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newId(taken, random = randomBytes) {
  for (;;) {
    const id = Array.from(random(20), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
    if (!Object.hasOwn(taken, id)) return id;
  }
}

export const versionOf = (hash) => hash.slice(0, 12);

/** This many photos missing at once is held until a person confirms it. */
export const REMOVAL_HOLD = 100;

/** What a confirmation is for: exactly these photos. */
const holdKey = (ids) => createHash("sha256").update([...ids].sort().join("\n")).digest("hex").slice(0, 16);

/**
 * @param index      the current index (not modified)
 * @param memory     { seen: Map<path, sig>, rejected: Map<path, { sig, reason, twin? }> }, kept by the caller between scans
 * @param confirmed  ids whose removal a person has confirmed
 * @param listing    listPublished(root), when the caller already has it
 * Returns { index, changed, events, blocked, skipped }  events: [{ type, id, path, from? }]
 *   blocked: { missing, limit, folders: [{ folder, count }], ids, key }
 */
export async function scan({ root, index, memory, now = new Date(), confirmed = new Set(), id = newId, listing }) {
  const { files, empty, skipped } = listing ?? (await listPublished(root));
  // An unmounted or wrong folder looks empty, and is not a deletion however long it lasts.
  if (empty && Object.values(index.photos).some((photo) => !photo.goneAt)) throw new Error("Published is empty");
  const next = structuredClone(index);
  const photos = next.photos;
  const events = [];
  const pendingSizes = new Set();
  let touched = false;

  const byPath = new Map();
  const byHash = new Map();
  for (const [photoId, photo] of Object.entries(photos)) {
    if (!photo.goneAt) byPath.set(photo.path, photoId);
    byHash.set(photo.hash, [...(byHash.get(photo.hash) ?? []), photoId]);
  }
  const onDisk = new Set(files.map((file) => file.path));
  // A photo is there while its file is, even one now too big or damaged: that keeps the last good version.
  const isMissing = (photo) => !photo.goneAt && !onDisk.has(photo.path);

  const refuse = (file, reason, twin = {}) => {
    memory.rejected.set(file.path, { sig: file.sig, reason, ...twin });
    skipped.push({ path: file.path, reason, ...(twin.twin ? { copyOf: twin.twin } : {}) });
  };
  const seen = new Map();
  // Of two new files with the same bytes, the older is published.
  for (const file of files.toSorted((a, b) => a.mtime - b.mtime || a.path.localeCompare(b.path))) {
    seen.set(file.path, file.sig);
    const known = byPath.get(file.path);
    if (known && photos[known].sig === file.sig) continue;
    if (file.tooBig) continue;
    const refused = memory.rejected.get(file.path);
    // A copy is looked at again once the file it copies has gone or changed.
    if (refused?.sig === file.sig && !(refused.twin && (!onDisk.has(refused.twin) || photos[refused.id]?.goneAt || photos[refused.id]?.hash !== refused.hash))) {
      skipped.push({ path: file.path, reason: refused.reason, ...(refused.twin ? { copyOf: refused.twin } : {}) });
      continue;
    }
    memory.rejected.delete(file.path);
    if (memory.seen.get(file.path) !== file.sig) {
      pendingSizes.add(file.size); // still being written, or just arrived
      continue;
    }

    let buffer, meta;
    try {
      buffer = await readFile(join(root, file.path));
    } catch (error) {
      if (error.code === "ENOENT") continue; // removed meanwhile; the next scan sees it
      throw error; // the share is failing: change nothing
    }
    if (buffer.length !== file.size) {
      pendingSizes.add(file.size);
      continue;
    }
    const hash = createHash("sha256").update(buffer).digest("hex");
    try {
      meta = await readMetadata(buffer);
    } catch (error) {
      refuse(file, `doesn't decode: ${error.message}`);
      continue;
    }
    meta.fileTags = meta.fileTags.filter((tag) => TAG_RE.test(tag));
    const facts = { path: file.path, kind: file.kind, sig: file.sig, hash, version: versionOf(hash), bytes: file.size, ...meta };
    touched = true;

    if (known) {
      const same = photos[known].hash === hash;
      Object.assign(photos[known], facts);
      if (!same) events.push({ type: "replaced", id: known, path: file.path });
      continue;
    }
    const twins = (byHash.get(hash) ?? []).filter((twin) => photos[twin].kind === file.kind);
    const moved = file.kind === "photo" && (twins.find((twin) => isMissing(photos[twin])) ?? twins.find((twin) => photos[twin].goneAt));
    if (moved) {
      const was = photos[moved];
      const type = was.goneAt ? "restored" : "moved";
      events.push({ type, id: moved, path: file.path, from: was.path });
      byPath.delete(was.path);
      Object.assign(was, facts);
      delete was.goneAt;
      delete was.missing;
      byPath.set(file.path, moved);
      continue;
    }
    if (file.kind === "photo" && twins.some((twin) => !photos[twin].goneAt)) {
      const twin = twins.find((other) => !photos[other].goneAt);
      refuse(file, `same bytes as ${photos[twin].path}`, { twin: photos[twin].path, id: twin, hash });
      continue;
    }
    // Site imagery is addressed by name, as site/… public_ids always were.
    const fresh = file.kind === "site" ? `site/${file.path.slice(SITE_DIR.length + 1).replace(SITE_EXT, "")}` : id(photos);
    if (file.kind === "site" && photos[fresh] && !photos[fresh].goneAt) {
      refuse(file, `${fresh} is already ${photos[fresh].path}`);
      continue;
    }
    photos[fresh] = { ...facts, createdAt: photos[fresh]?.createdAt ?? now.toISOString() };
    byPath.set(file.path, fresh);
    byHash.set(hash, [...(byHash.get(hash) ?? []), fresh]);
    events.push({ type: "added", id: fresh, path: file.path });
  }
  memory.seen = seen;
  for (const path of memory.rejected.keys()) if (!onDisk.has(path)) memory.rejected.delete(path);

  // Removals last, once every move has been recognised. A same-sized file that
  // is still settling is probably a missing photo being moved.
  const missing = Object.entries(photos).filter(([, photo]) => isMissing(photo) && !pendingSizes.has(photo.bytes));
  for (const [, photo] of missing) {
    if ((photo.missing ?? 0) < 2) {
      photo.missing = (photo.missing ?? 0) + 1;
      touched = true;
    }
  }
  let blocked = null;
  if (missing.length >= REMOVAL_HOLD && missing.some(([photoId, photo]) => photo.missing >= 2 && !confirmed.has(photoId))) {
    const counts = new Map();
    for (const [, photo] of missing) counts.set(dirName(photo.path), (counts.get(dirName(photo.path)) ?? 0) + 1);
    const ids = missing.map(([photoId]) => photoId);
    blocked = {
      missing: missing.length,
      limit: REMOVAL_HOLD,
      folders: [...counts].map(([folder, count]) => ({ folder, count })).sort((a, b) => b.count - a.count || a.folder.localeCompare(b.folder)),
      ids,
      key: holdKey(ids),
    };
  }
  for (const [photoId, photo] of missing) {
    if (photo.missing < 2 || (blocked && !confirmed.has(photoId))) continue;
    photo.goneAt = now.toISOString();
    touched = true;
    events.push({ type: "removed", id: photoId, path: photo.path });
  }
  for (const [photoId, photo] of Object.entries(photos)) {
    if (!photo.goneAt && onDisk.has(photo.path) && photo.missing) {
      delete photo.missing;
      touched = true;
    }
    if (photo.goneAt && now - new Date(photo.goneAt) > KEEP_GONE_MS) {
      delete photos[photoId];
      touched = true;
    }
  }
  return { index: touched ? next : index, changed: touched, events, blocked, skipped };
}
