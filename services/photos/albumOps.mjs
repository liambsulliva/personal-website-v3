// The dashboard's album actions, as file operations in Published
// (docs/folder-albums-plan.md). Each runs inside watcher.mutate, alone with the
// index it's given; nothing is ever written over, and no photo is deleted.
import { link, mkdir, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { baseName, buildAlbums, dirName, isAlbumFolder, isUnder, joinPath, parseFolder } from "../lib/albums.mjs";
import { isLive } from "../lib/index.mjs";
import { ALBUM_FILE, FIELDS } from "./albumFile.mjs";
import { relocate } from "./folders.mjs";
import { isHidden } from "./scan.mjs";

export const UNSORTED = "_unsorted";

export class OpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** A name one album folder may have. */
export const isFolderName = (name) =>
  typeof name === "string" &&
  name.length > 0 &&
  name.length <= 100 &&
  name === name.trim() &&
  name.toLowerCase() !== ALBUM_FILE &&
  !isHidden(name) &&
  // eslint-disable-next-line no-control-regex
  !/^[._@#~]|[\\/:*?"<>|\x00-\x1f]|\.$/.test(name);

const NAME_HELP = "That name can't be used: it can't start with . _ @ # ~, end with a dot, or contain / \\ : * ? \" < > |";
const same = (a, b) => a.normalize("NFC").toLowerCase() === b.normalize("NFC").toLowerCase();

/** As the dashboard reads them: every album, shown or not. */
export function listAlbums(index) {
  const { all } = buildAlbums(index);
  return [...all.values()].map(({ folder, name, title, parent, link: segment, path, date, year, count, photos, cover, children, shown }) => {
    const record = index.folders[folder] ?? {};
    return { folder, name, title, parent, link: segment, path, date, dateSet: record.date ?? null, year, count, photos, cover, subs: children.map((child) => child.folder), order: record.order ?? [], shown, broken: record.broken ?? null };
  });
}

function albumAt(index, folder) {
  const album = typeof folder === "string" ? buildAlbums(index).all.get(folder) : undefined;
  if (!album) throw new OpError(404, "That album isn't in Published any more");
  return album;
}

/** For writing album.yaml: what's in a broken one isn't ours to replace. */
function recordAt(index, folder) {
  albumAt(index, folder);
  const record = (index.folders[folder] ??= {});
  if (record.broken) throw new OpError(409, `${folder}/${ALBUM_FILE} can't be used (${record.broken}). Fix or delete it first.`);
  return record;
}

const names = (root, folder) => readdir(join(root, folder)).catch((error) => (error.code === "ENOENT" ? [] : Promise.reject(error)));

async function mustBeFree(root, parent, name, except = null) {
  const taken = (await names(root, parent)).find((other) => other !== except && same(other, name));
  if (taken) throw new OpError(409, `There's already a "${taken}" ${parent ? `in ${parent}` : "in Published"}`);
}

/** In its parent's order a folder that was `name` is now `next`, or gone. */
function renameInOrder(index, parent, name, next = null) {
  const record = index.folders[parent];
  if (!record?.order?.includes(name)) return;
  record.order = record.order.flatMap((item) => (item === name ? (next ? [next] : []) : [item]));
  if (!record.order.length) delete record.order;
  record.unsaved = "all";
}

/** A folder, on disk and in the index: its record, and every photo beneath. */
async function moveFolder(root, index, from, to) {
  await rename(join(root, from), join(root, to));
  if (isAlbumFolder(from) && isAlbumFolder(to)) relocate(index, from, to);
  for (const photo of Object.values(index.photos)) {
    if (photo.kind === "photo" && isUnder(photo.path, from)) photo.path = to + photo.path.slice(from.length);
  }
}

/** Moves a file without ever writing over another: "a.jpg" becomes "a-2.jpg" next to one. Returns its name. */
async function moveFile(root, from, folder) {
  await mkdir(join(root, folder), { recursive: true });
  const name = baseName(from);
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 1; ; n++) {
    const to = joinPath(folder, n === 1 ? name : `${base}-${n}${ext}`);
    try {
      await link(join(root, from), join(root, to));
    } catch (error) {
      if (error.code === "EEXIST" && n < 1000) continue;
      throw error;
    }
    await unlink(join(root, from));
    return to;
  }
}

export async function createAlbum({ root, index }, { title, parent = "" }) {
  if (!isFolderName(title)) throw new OpError(400, NAME_HELP);
  if (parseFolder(title).suffix) throw new OpError(400, "A title can't end in a day, like 4-11: it would be read as the album's date");
  if (parent !== "") albumAt(index, parent);
  await mustBeFree(root, parent, title);
  const folder = joinPath(parent, title);
  await mkdir(join(root, folder));
  index.folders[folder] = {};
  return { folder };
}

export async function renameAlbum({ root, index }, { folder, title }) {
  const album = albumAt(index, folder);
  const { suffix } = parseFolder(album.name);
  const name = `${title}${suffix}`;
  if (!isFolderName(title) || !isFolderName(name)) throw new OpError(400, NAME_HELP);
  if (!suffix && parseFolder(name).suffix) throw new OpError(400, "A title can't end in a day, like 4-11: it would be read as the album's date");
  if (name === album.name) return { folder };
  const parent = dirName(folder);
  await mustBeFree(root, parent, name, album.name);
  const to = joinPath(parent, name);
  await moveFolder(root, index, folder, to);
  renameInOrder(index, parent, album.name, name);
  return { folder: to };
}

export async function moveAlbum({ root, index }, { folder, parent }) {
  const album = albumAt(index, folder);
  if (parent !== "") albumAt(index, parent);
  if (parent === folder || isUnder(parent, folder)) throw new OpError(400, "An album can't go inside itself");
  const from = dirName(folder);
  if (from === parent) return { folder };
  await mustBeFree(root, parent, album.name);
  const to = joinPath(parent, album.name);
  await moveFolder(root, index, folder, to);
  renameInOrder(index, from, album.name);
  return { folder: to };
}

/** `date` null takes it out; `order` is file and sub-album folder names, [] takes it out. */
export function updateAlbum({ index }, { folder, date, order }) {
  const record = recordAt(index, folder);
  if (order !== undefined && !(Array.isArray(order) && order.length <= 5000 && order.every((name) => typeof name === "string" && name && !name.includes("/")))) throw new OpError(400, "order must be a list of names");
  if (date !== undefined && date !== null && typeof date !== "string") throw new OpError(400, "date must be a day, like 2026-04-11");
  try {
    if (date) FIELDS.date(date);
    if (order) FIELDS.order(order);
  } catch (error) {
    throw new OpError(400, error.message);
  }
  if (date !== undefined) date ? (record.date = date) : delete record.date;
  if (order !== undefined) order.length ? (record.order = [...new Set(order)]) : delete record.order;
  record.unsaved = "all";
  return { folder };
}

/** Photos into an album, or out of them all (`_unsorted`). They keep their ids. */
export async function movePhotos({ root, index }, { ids, folder }) {
  if (folder !== UNSORTED) albumAt(index, folder);
  const moved = Object.create(null);
  for (const id of ids) {
    const photo = Object.hasOwn(index.photos, id) ? index.photos[id] : null;
    moved[id] = "not_found";
    if (!isLive(photo) || photo.kind !== "photo") continue;
    moved[id] = "moved";
    const from = dirName(photo.path);
    if (from === folder) continue;
    try {
      const name = baseName(photo.path);
      photo.path = await moveFile(root, photo.path, folder);
      renameInOrder(index, from, name);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      moved[id] = "not_found"; // gone from disk since the last scan
    }
  }
  return { moved };
}

/**
 * The album goes, its photos don't: files to `_unsorted`, sub-albums (and `_`
 * folders) up a level. What's left (album.yaml, hidden files) goes in the trash.
 */
export async function removeAlbum({ root, index, toTrash }, { folder }) {
  const album = albumAt(index, folder);
  const parent = dirName(folder);
  const result = { photos: 0, albums: 0 };
  const byPath = new Map(Object.values(index.photos).filter((photo) => photo.kind === "photo" && isLive(photo)).map((photo) => [photo.path, photo]));
  const entries = await readdir(join(root, folder), { withFileTypes: true });
  for (const entry of entries) {
    const from = joinPath(folder, entry.name);
    if (isHidden(entry.name) || entry.name === ALBUM_FILE) continue;
    if (entry.isFile()) {
      const to = await moveFile(root, from, UNSORTED);
      const photo = byPath.get(from);
      if (photo) photo.path = to;
      result.photos += photo ? 1 : 0;
    } else if (entry.isDirectory()) {
      const { title, suffix } = parseFolder(entry.name);
      const taken = await names(root, parent);
      let name = entry.name;
      // Never Published's own _site: that's the site's images.
      for (let n = 2; name === "_site" || taken.some((other) => same(other, name)); n++) name = `${title} ${n}${suffix}`;
      await moveFolder(root, index, from, joinPath(parent, name));
      result.albums += isAlbumFolder(from) ? 1 : 0;
    }
  }
  // A photo deleted from it would be restored to _unsorted.
  for (const photo of Object.values(index.photos)) {
    if (photo.kind === "photo" && photo.goneAt && dirName(photo.path) === folder) photo.path = joinPath(UNSORTED, baseName(photo.path));
  }
  await toTrash(folder, "album");
  delete index.folders[folder];
  renameInOrder(index, parent, album.name);
  return result;
}
