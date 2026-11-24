// Albums, worked out from the photo index (docs/folder-albums-plan.md). Every
// folder in Published is an album; what its album.yaml says is in
// index.folders. No dependencies and no disk: the site imports this too.
//
//   index.folders  { <folder path>: { link, date, order, was, … } }
import { isLive } from "./index.mjs";

/** A folder with no sub-albums is shown from this many photos. */
export const MIN_ALBUM_PHOTOS = 5;

const NONE = /^[._]/;
const nfc = (text) => text.normalize("NFC");
export const baseName = (path) => path.slice(path.lastIndexOf("/") + 1);
/** The folder a path is in; "" for Published itself. */
export const dirName = (path) => path.slice(0, Math.max(0, path.lastIndexOf("/")));
export const joinPath = (folder, name) => (folder ? `${folder}/${name}` : name);
export const isUnder = (path, folder) => path.startsWith(`${folder}/`);

/** Is this folder an album? Not Published itself, and nothing in a `_` or `.` folder. */
export const isAlbumFolder = (folder) => folder !== "" && !folder.split("/").some((name) => NONE.test(name));

/** The album folder a photo is in, or null (the root, or any `_` or `.` folder). */
export function albumOf(path) {
  const folder = dirName(path);
  return isAlbumFolder(folder) ? folder : null;
}

/** "Bigelow Bash 4-11" → { title: "Bigelow Bash", month: 4, day: 11, suffix: " 4-11" } */
export function parseFolder(name) {
  const m = /^(.*\S)(\s+(\d{1,2})-(\d{1,2}))$/.exec(name);
  const month = Number(m?.[3]);
  const day = Number(m?.[4]);
  return m && month >= 1 && month <= 12 && day >= 1 && day <= 31
    ? { title: m[1], month, day, suffix: m[2] }
    : { title: name, month: null, day: null, suffix: "" };
}

// As cms-dashboard's shared/utils/content.ts.
export const slugify = (text) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");

/** By capture time, then file name; photos without a time last. */
const byCapture = ([, a], [, b]) =>
  (a.takenAt ?? "9999").localeCompare(b.takenAt ?? "9999") || baseName(a.path).localeCompare(baseName(b.path), "en", { numeric: true });

/** `items` with the ones `order` names first, in its order; the rest keep theirs. */
function ordered(items, order, nameOf) {
  if (!order?.length) return items;
  const at = new Map(order.map((name, i) => [nfc(name), i]).reverse());
  const rank = (item) => at.get(nfc(nameOf(item))) ?? Infinity;
  return items.toSorted((a, b) => (rank(a) === rank(b) ? 0 : rank(a) - rank(b)));
}

const sortDate = ({ date, year }) => date ?? `${year ?? "0000"}-01-01`;
/** Newest first; an undated album counts as January 1st of its year. */
export const newestFirst = (a, b) => sortDate(b).localeCompare(sortDate(a)) || a.title.localeCompare(b.title) || a.folder.localeCompare(b.folder);

const earliest = (values) => values.filter(Boolean).reduce((a, b) => (a && a < b ? a : b), undefined);
const pad = (n) => String(n).padStart(2, "0");

/**
 * Every album in the index, shown or not.
 *
 * Album: folder, name, title, parent (album folder or null), link (own segment
 * or null), path (full link or null), date, year, count (everything beneath),
 * photos (own ids, in order), cover (up to 3 ids), subs (shown sub-albums, in
 * order), children (all sub-albums, same order), shown.
 *
 * @returns {{ all: Map<string, any>, top: any[], byPath: Map<string, any>, was: Map<string, any> }}
 *   `top`, `byPath` and `was` (old links) hold shown albums only.
 */
export function buildAlbums(index) {
  const records = index.folders ?? {};
  // Until the one-time copy has run, an old album's address is in the index only.
  const legacy = new Map(Object.entries(index.albums ?? {}).map(([slug, { folder }]) => [folder, slug]));
  const all = new Map();
  const add = (folder) => {
    for (let path = folder; path && !all.has(path); path = dirName(path)) {
      const { title, month, day } = parseFolder(baseName(path));
      all.set(path, { folder: path, name: baseName(path), title, month, day, parent: dirName(path) || null, children: [], own: [] });
    }
  };
  for (const folder of Object.keys(records)) if (isAlbumFolder(folder)) add(folder);
  for (const entry of Object.entries(index.photos)) {
    const photo = entry[1];
    const folder = photo.kind === "photo" && isLive(photo) ? albumOf(photo.path) : null;
    if (folder === null) continue;
    add(folder);
    all.get(folder).own.push(entry);
  }
  // Deepest first, so an album's sub-albums are done before it.
  const deepestFirst = [...all.values()].sort((a, b) => b.folder.split("/").length - a.folder.split("/").length);
  for (const album of deepestFirst) {
    const record = records[album.folder] ?? {};
    if (album.parent) all.get(album.parent).children.push(album);
    album.link = record.link ?? legacy.get(album.folder) ?? null;
    album.count = album.own.length + album.children.reduce((sum, child) => sum + child.count, 0);
    album.taken = earliest([...album.own.map(([, photo]) => photo.takenAt), ...album.children.map((child) => child.taken)]);
    album.arrived = earliest([...album.own.map(([, photo]) => photo.createdAt), ...album.children.map((child) => child.arrived)]);
    const { month, day, taken, arrived } = album;
    album.date = record.date ?? taken?.slice(0, 10) ?? (month && arrived ? `${arrived.slice(0, 4)}-${pad(month)}-${pad(day)}` : null);
    album.year = Number((album.date ?? arrived)?.slice(0, 4)) || null;
    album.photos = ordered(album.own.toSorted(byCapture), record.order, ([, photo]) => baseName(photo.path)).map(([id]) => id);
    album.children = ordered(album.children.sort(newestFirst), record.order, ({ name }) => name);
    album.subs = album.children.filter(({ shown }) => shown);
    album.shown = album.children.length ? album.photos.length > 0 || album.subs.length > 0 : album.photos.length >= MIN_ALBUM_PHOTOS;
    album.cover = album.photos.length ? album.photos.slice(0, 3) : (album.subs[0]?.cover ?? []);
  }
  const byPath = new Map();
  const was = new Map();
  for (const album of deepestFirst.reverse()) {
    const parent = album.parent ? all.get(album.parent) : null;
    album.path = album.link && (!parent || parent.path) ? joinPath(parent?.path ?? "", album.link) : null;
    for (const key of ["own", "taken", "arrived", "month", "day"]) delete album[key];
    if (!album.shown || !album.path) continue;
    if (!byPath.has(album.path)) byPath.set(album.path, album);
    for (const old of new Set(records[album.folder]?.was)) was.set(old, was.has(old) ? null : album);
  }
  const top = [...all.values()].filter(({ parent, shown, path }) => !parent && shown && path).sort(newestFirst);
  return { all, top, byPath, was };
}

/** The shown album a link means today: a current link, else an old one, else one whose parent moved. Null for nothing shown. */
export function resolveLink(albums, link, depth = 0) {
  const found = albums.byPath.get(link) ?? albums.was.get(link);
  if (found || depth > 8) return found ?? null;
  for (let at = link.lastIndexOf("/"); at > 0; at = link.lastIndexOf("/", at - 1)) {
    const prefix = link.slice(0, at);
    if (albums.byPath.has(prefix)) return null;
    const parent = albums.was.get(prefix);
    if (parent) return resolveLink(albums, parent.path + link.slice(at), depth + 1);
  }
  return null;
}

/** The shown albums from the top down to this one. */
export function ancestry(albums, album) {
  const chain = [];
  for (let at = album; at; at = at.parent ? albums.all.get(at.parent) : null) chain.unshift(at);
  return chain;
}

/** A new album's own link segment; `taken` are its siblings'. */
export function linkFor({ parent, title, year, date }, taken) {
  const name = slugify(title) || "album";
  const base = parent ? name : `${year}-${name}${date ? `-${date.slice(5, 7)}${date.slice(8, 10)}` : ""}`;
  let link = base;
  for (let n = 2; taken.has(link); n++) link = `${base}-${n}`;
  return link;
}

/**
 * Gives every shown album without a link one, kept for good in its record.
 * Returns the folders that got one. Changes `index.folders`.
 */
export function assignLinks(index) {
  const albums = buildAlbums(index);
  const given = [];
  for (const album of albums.all.values()) {
    if (!album.shown || album.link) continue;
    const taken = new Set();
    for (const other of albums.all.values()) if (other.parent === album.parent && other.link) taken.add(other.link);
    album.link = linkFor(album, taken);
    (index.folders[album.folder] ??= {}).link = album.link;
    given.push(album.folder);
  }
  return given;
}
