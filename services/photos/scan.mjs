// One pass over Published: compare what's on disk with the index and return
// the index that should replace it. Never writes to Published.
//
//   new       same size and mtime in two scans running, and it decodes
//   replaced  the same for a known path with other bytes: keeps its id
//   moved     a known photo's bytes at a new path, its old path gone: keeps its id
//   restored  an unpublished photo's bytes are back within 30 days: keeps its id
//   removed   missing for two scans running, unless too many vanish at once
import { createHash, randomBytes } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { TAG_RE } from "../lib/index.mjs";
import { readMetadata } from "./metadata.mjs";

const MAX_BYTES = 50e6;
const PHOTO_EXT = /\.(jpe?g|png|webp|tiff?)$/i;
const SITE_EXT = /\.(jpe?g|png|webp|tiff?|gif|svg)$/i;
const KEEP_GONE_MS = 30 * 86_400_000;
const SITE_DIR = "_site";

/** Dotfiles, DSM's @eaDir and #recycle, Lightroom's and SMB's temporaries. */
const isHidden = (name) => /^[.@#~]/.test(name) || /\.(tmp|part|crdownload|download)$/i.test(name) || name === "Thumbs.db";

/** Files that could be published: root and one folder deep, and any depth under _site. Symlinks aren't followed. */
export async function listPublished(root) {
  const files = [];
  const skipped = [];
  async function walk(dir, depth) {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      if (isHidden(entry.name)) continue;
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      const site = path === SITE_DIR || path.startsWith(`${SITE_DIR}/`);
      if (entry.isDirectory()) {
        if (site || depth === 0) await walk(path, depth + 1);
        else skipped.push({ path, reason: "folders inside a shoot folder aren't published" });
      } else if (!entry.isFile()) {
        skipped.push({ path, reason: "not a regular file" });
      } else if (!(site ? SITE_EXT : PHOTO_EXT).test(entry.name)) {
        skipped.push({ path, reason: "not an image type that's published" });
      } else {
        // Gone between the listing and here: treat it as not there.
        const info = await stat(join(root, path)).catch(() => null);
        if (!info) continue;
        if (info.size > MAX_BYTES) skipped.push({ path, reason: "over 50 MB" });
        files.push({ path, kind: site ? "site" : "photo", size: info.size, sig: `${info.size}:${Math.trunc(info.mtimeMs)}`, tooBig: info.size > MAX_BYTES });
      }
    }
  }
  await walk("", 0);
  return { files, skipped };
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newId(taken, random = randomBytes) {
  for (;;) {
    const id = Array.from(random(20), (byte) => ALPHABET[byte % ALPHABET.length]).join("");
    if (!Object.hasOwn(taken, id)) return id;
  }
}

export const versionOf = (hash) => hash.slice(0, 12);

/** How many photos may disappear at once before a person has to say so. */
export const removalLimit = (live) => Math.max(3, Math.min(20, Math.floor(live / 10)));

/**
 * @param index  the current index (not modified)
 * @param memory { seen: Map<path, sig>, rejected: Map<path, sig> }, kept by the caller between scans
 * Returns { index, changed, events, blocked, skipped }  events: [{ type, id, path, from? }]
 */
export async function scan({ root, index, memory, now = new Date(), allowRemovals = false, id = newId }) {
  const { files, skipped } = await listPublished(root);
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

  const seen = new Map();
  for (const file of files) {
    seen.set(file.path, file.sig);
    const known = byPath.get(file.path);
    if (known && photos[known].sig === file.sig) continue;
    if (file.tooBig || memory.rejected.get(file.path) === file.sig) continue;
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
      memory.rejected.set(file.path, file.sig);
      skipped.push({ path: file.path, reason: `doesn't decode: ${error.message}` });
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
      memory.rejected.set(file.path, file.sig);
      skipped.push({ path: file.path, reason: `same bytes as ${photos[twins.find((twin) => !photos[twin].goneAt)].path}` });
      continue;
    }
    // Site imagery is addressed by name, as site/… public_ids always were.
    const fresh = file.kind === "site" ? `site/${file.path.slice(SITE_DIR.length + 1).replace(SITE_EXT, "")}` : id(photos);
    if (file.kind === "site" && photos[fresh] && !photos[fresh].goneAt) {
      memory.rejected.set(file.path, file.sig);
      skipped.push({ path: file.path, reason: `${fresh} is already ${photos[fresh].path}` });
      continue;
    }
    photos[fresh] = { ...facts, createdAt: photos[fresh]?.createdAt ?? now.toISOString() };
    byPath.set(file.path, fresh);
    byHash.set(hash, [...(byHash.get(hash) ?? []), fresh]);
    events.push({ type: "added", id: fresh, path: file.path });
  }
  memory.seen = seen;
  for (const path of memory.rejected.keys()) if (!onDisk.has(path)) memory.rejected.delete(path);

  // Removals last, once every move has been recognised.
  const missing = Object.entries(photos).filter(([, photo]) => isMissing(photo));
  const live = Object.values(photos).filter((photo) => !photo.goneAt).length;
  const limit = removalLimit(live);
  const blocked = missing.length > limit && !allowRemovals ? { missing: missing.length, limit } : null;
  for (const [photoId, photo] of missing) {
    // A same-sized file is still settling: probably this photo, being moved.
    if (pendingSizes.has(photo.bytes)) continue;
    if ((photo.missing ?? 0) < 2) {
      photo.missing = (photo.missing ?? 0) + 1;
      touched = true;
    }
    if (photo.missing < 2 || blocked) continue;
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
