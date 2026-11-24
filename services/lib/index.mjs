// The photo index: one JSON file, written only by the `photos` service and
// replaced atomically, so any reader sees a whole version. Read by `img` and
// the site. docs/photo-pipeline-plan.md.
//
//   photos  { <id>: Photo }   id is the old Cloudinary public_id, or 20 random characters
//   folders { <folder path>: Folder }   every album folder (lib/albums.mjs)
//   albums  { <slug>: { folder, known } }   before folders had an album.yaml; only read for an
//           old album's address until the one-time copy has run, and by a rollback
//
// Folder: what its album.yaml says (link, date, order, was), and sig ("size:mtimeMs"
// of that file), ino (the folder's inode), broken (why the file can't be used; the
// values are then its last good ones), unsaved (the file has yet to be written).
//
// Photo: kind ("photo" | "site"), path (relative to Published, "/" separated),
// sig ("size:mtimeMs", to skip unchanged files), hash (sha256), version (first
// 12 of it, the URL's v), width, height (after EXIF orientation), bytes,
// format, takenAt ("YYYY-MM-DDTHH:MM:SS", camera time, or null), createdAt,
// fileTags (keywords in the file), tagEdits ({ tag: true|false }, from the
// dashboard; they win), alt, missing (scans in a row), goneAt (ISO, once unpublished).
import { readFileSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const INDEX_VERSION = 1;
/** Same rule as cms-dashboard: a tag outside it couldn't be filtered on /photography. */
export const TAG_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

/** @returns {{ indexVersion: number, photos: Record<string, any>, folders: Record<string, any>, albums: Record<string, any> }} */
export const emptyIndex = () => ({ indexVersion: INDEX_VERSION, photos: {}, folders: {}, albums: {} });

export function parseIndex(text) {
  const index = JSON.parse(text);
  if (index?.indexVersion !== INDEX_VERSION || typeof index.photos !== "object" || typeof index.albums !== "object") {
    throw new Error("not a photo index this version understands");
  }
  index.folders ??= {};
  return index;
}

/** The index at `file`, or null when there is none. A damaged one throws: starting empty would re-id every photo. */
export function loadIndex(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return parseIndex(text);
}

export async function writeAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, data);
  await rename(temp, file);
}

export const saveIndex = (file, index) => writeAtomic(file, `${JSON.stringify(index)}\n`);

/** Re-reads `file` when it changes, checking at most once a second. Keeps the last good one if a read fails. */
export function indexReader(file, { everyMs = 1000, now = Date.now } = {}) {
  let index = null;
  let stamp = "";
  let checked = -Infinity;
  return () => {
    if (now() - checked < everyMs) return index;
    checked = now();
    try {
      const { mtimeMs, size, ino } = statSync(file);
      const next = `${mtimeMs}:${size}:${ino}`;
      if (next !== stamp) {
        index = parseIndex(readFileSync(file, "utf8"));
        stamp = next;
      }
    } catch (error) {
      if (error.code !== "ENOENT") console.error("[index]", error.message);
    }
    return index;
  };
}

export const isLive = (photo) => Boolean(photo) && !photo.goneAt;

/** A photo's tags: the file's keywords, with the dashboard's edits on top. */
export function tagsOf(photo) {
  const tags = new Set(photo.fileTags ?? []);
  for (const [tag, on] of Object.entries(photo.tagEdits ?? {})) on ? tags.add(tag) : tags.delete(tag);
  return [...tags].sort();
}
