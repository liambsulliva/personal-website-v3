// Album folders and their album.yaml, kept in step with index.folders
// (docs/folder-albums-plan.md). A record is what the file says, kept as the
// last good values when the file is broken and to write it again when it's gone.
import { albumOf, assignLinks, buildAlbums, dirName, isUnder } from "../lib/albums.mjs";
import { ALBUM_FILE, editAlbumFile, parseAlbumFile, readAlbumFile, writeAlbumFile } from "./albumFile.mjs";

const FIELD_NAMES = ["link", "date", "order", "was"];
export const newFolderMemory = () => ({ seen: new Map(), gone: new Map(), told: new Map() });

const union = (a = [], b = []) => [...new Set([...a, ...b])];
/** Set, or taken out when there's nothing to say. */
function put(record, name, value) {
  if (value === undefined || value === null || value.length === 0) delete record[name];
  else record[name] = value;
}

/** Holds back an old album whose album.yaml hasn't been copied from the YAML yet. */
const awaitsCopy = (index, folder) => !index.folders[folder]?.link && Object.values(index.albums ?? {}).some((album) => album.folder === folder);

/**
 * An album's folder is now `to`: its record and its sub-albums' go along, and
 * so do the paths of photos in the trash. Under another parent, the link it had
 * goes into `was`. Photos still published are the caller's.
 */
export function relocate(index, from, to) {
  const { folders } = index;
  const oldPath = dirName(from) === dirName(to) ? null : (buildAlbums(index).all.get(from)?.path ?? null);
  const moved = Object.keys(folders).filter((folder) => folder === from || isUnder(folder, from));
  const records = moved.map((folder) => [to + folder.slice(from.length), folders[folder]]);
  for (const folder of moved) delete folders[folder];
  for (const [folder, record] of records) folders[folder] = { ...folders[folder], ...record };
  const record = (folders[to] ??= {});
  if (oldPath) {
    record.was = union(record.was, [oldPath]);
    record.unsaved ||= true;
  }
  // A link a new sibling already has can't be kept; the old one still redirects.
  const clash = record.link && Object.entries(folders).some(([folder, other]) => folder !== to && dirName(folder) === dirName(to) && other.link === record.link);
  if (clash) {
    delete record.link;
    record.unsaved ||= true;
  }
  for (const photo of Object.values(index.photos)) {
    if (photo.kind === "photo" && photo.goneAt && isUnder(photo.path, from)) photo.path = to + photo.path.slice(from.length);
  }
  for (const album of Object.values(index.albums ?? {})) {
    if (album.folder === from || isUnder(album.folder, from)) album.folder = to + album.folder.slice(from.length);
  }
  return record;
}

/**
 * New links, and every file that has something to be written. Changes
 * `index.folders`; `onDisk` (folder -> file sig or null) is every folder that
 * may be written to. A record's `unsaved` is "all" when its date and order are
 * to be written too, else true. Returns whether anything changed.
 */
export async function saveFolders({ root, index, onDisk, memory, log }) {
  let changed = false;
  for (const folder of assignLinks(index)) {
    index.folders[folder].unsaved ||= true;
    changed = true;
    log(`[albums] ${folder} is shown as ${index.folders[folder].link}`);
  }
  for (const [folder, record] of Object.entries(index.folders)) {
    if (!onDisk.has(folder) || record.broken || awaitsCopy(index, folder)) continue;
    const lost = onDisk.get(folder) === null;
    if (!record.unsaved && !lost) continue;
    try {
      const text = await readAlbumFile(root, folder);
      const names = text === null || record.unsaved === "all" ? FIELD_NAMES : ["link", "was"];
      const next = editAlbumFile(text, Object.fromEntries(names.map((name) => [name, record[name]])));
      if (next !== text) record.sig = await writeAlbumFile(root, folder, next);
      delete record.unsaved;
      memory.told.delete(folder);
      changed = true;
    } catch (error) {
      // The index has the values; the next scan tries again.
      if (memory.told.get(folder) !== error.message) log(`[albums] ${folder}/${ALBUM_FILE} not written: ${error.message}`);
      memory.told.set(folder, error.message);
    }
  }
  return changed;
}

/**
 * One pass, after scan() has recognised the photos that moved.
 *
 * @param index    the index to change
 * @param folders  listPublished's
 * @param events   scan's
 * @param blocked  a mass removal is waiting: no record is dropped
 * Returns { changed, problems }  problems: [{ path, reason }]
 */
export async function syncFolders({ root, index, folders, events = [], memory, blocked = null, log = console.log }) {
  const records = index.folders;
  const listed = new Map(folders.map((folder) => [folder.path, folder]));
  // A folder counts once two scans have seen it, with the same album.yaml.
  const settled = new Map(folders.filter(({ path, ino, file }) => memory.seen.get(path) === `${ino}:${file}`).map((folder) => [folder.path, folder]));
  memory.seen = new Map(folders.map(({ path, ino, file }) => [path, `${ino}:${file}`]));
  let changed = false;

  const texts = new Map();
  /** { fields } or { broken }, read once a pass. */
  async function read(folder) {
    if (!texts.has(folder)) {
      let result;
      try {
        const text = await readAlbumFile(root, folder);
        result = { fields: text === null ? {} : parseAlbumFile(text) };
      } catch (error) {
        if (error.code && !["ENOENT", "EACCES", "EPERM"].includes(error.code)) throw error; // the share is failing
        result = { broken: error.message };
      }
      texts.set(folder, result);
    }
    return texts.get(folder);
  }

  // ── Folders renamed or moved in Finder ──
  const vanished = new Set(Object.keys(records).filter((folder) => !listed.has(folder)));
  if (vanished.size) {
    /** from folder -> to folder -> photos that went there in this scan */
    const went = new Map();
    for (const { type, from, path } of events) {
      if (type !== "moved") continue;
      const to = went.get(dirName(from)) ?? went.set(dirName(from), new Map()).get(dirName(from));
      to.set(dirName(path), (to.get(dirName(path)) ?? 0) + 1);
    }
    const depth = (folder) => folder.split("/").length;
    /** Where most of a vanished folder's photos went. */
    const mostly = (folder, at) => {
      const to = went.get(folder);
      const total = to ? [...to.values()].reduce((a, b) => a + b, 0) : 0;
      return total > 0 && (to.get(at) ?? 0) * 2 > total;
    };
    for (const taker of [...settled.values()].sort((a, b) => depth(a.path) - depth(b.path))) {
      const at = taker.path;
      const candidates = [...vanished].filter((folder) => !isUnder(at, folder));
      if (!candidates.length) break;
      const own = records[at]?.link;
      let from;
      if (own) {
        // A copy of a folder has its link too, and is it once the original is gone.
        from = candidates.find((folder) => records[folder].link === own && mostly(folder, at));
      } else {
        const { fields } = taker.file ? await read(at) : {};
        const same = fields?.link ? candidates.filter((folder) => records[folder].link === fields.link) : [];
        from =
          // The same folder, with the same file in it: an inode alone can be reused.
          candidates.find((folder) => records[folder].ino === taker.ino && (records[folder].link ?? null) === (fields?.link ?? null)) ??
          (same.length === 1 ? same[0] : undefined) ??
          (records[at] ? undefined : candidates.find((folder) => mostly(folder, at)));
      }
      if (!from) continue;
      relocate(index, from, at);
      for (const folder of [...vanished]) if (folder === from || isUnder(folder, from)) vanished.delete(folder);
      changed = true;
      log(`[albums] ${from} is now ${at}`);
    }
  }

  // ── What each album.yaml says ──
  const problems = [];
  for (const { path, ino, file } of settled.values()) {
    const record = (records[path] ??= ((changed = true), {}));
    if (record.ino !== ino) {
      record.ino = ino;
      changed = true;
    }
    if (file === null) {
      // Deleted: the record writes it again, whatever was wrong with the old one.
      if (record.broken) changed = delete record.broken;
    } else if (record.sig !== file) {
      const { fields, broken } = await read(path);
      changed = true;
      record.sig = file;
      if (broken) {
        record.broken = broken;
        log(`[albums] ${path}/${ALBUM_FILE}: ${broken}; keeping the last good values`);
      } else {
        delete record.broken;
        take(index, path, fields, vanished);
      }
    } else if (!record.link && !record.broken) {
      // Its own link may have come free: the album it was copied from is gone.
      const { fields } = await read(path);
      if (fields?.link && take(index, path, fields, vanished)) changed = true;
    }
    if (record.broken) problems.push({ path: `${path}/${ALBUM_FILE}`, reason: `${record.broken}; using the last good values`, album: path });
    if (awaitsCopy(index, path)) problems.push({ path: `${path}/${ALBUM_FILE}`, reason: "waiting for the one-time copy of the old albums", album: path });
  }

  // ── Folders that are gone ──
  const holding = new Set();
  for (const photo of Object.values(index.photos)) {
    if (photo.goneAt || photo.kind !== "photo") continue;
    for (let folder = albumOf(photo.path); folder; folder = dirName(folder)) holding.add(folder);
  }
  for (const folder of [...memory.gone.keys()]) if (!vanished.has(folder)) memory.gone.delete(folder);
  for (const folder of vanished) {
    const scans = (memory.gone.get(folder) ?? 0) + 1;
    memory.gone.set(folder, scans);
    if (scans < 3 || blocked || holding.has(folder)) continue;
    delete records[folder];
    memory.gone.delete(folder);
    changed = true;
    log(`[albums] ${folder} is gone`);
  }

  if (await saveFolders({ root, index, onDisk: new Map([...settled].map(([path, { file }]) => [path, file])), memory, log })) changed = true;
  return { changed, problems };
}

/** A good file's values, into its record. Returns whether its link was taken. */
function take(index, folder, fields, vanished) {
  const record = index.folders[folder];
  put(record, "date", fields.date);
  put(record, "order", fields.order);
  put(record, "was", record.unsaved ? union(fields.was, record.was) : fields.was);
  if (!fields.link) {
    if (record.link) record.unsaved ||= true; // set once
    return false;
  }
  // Two siblings can't share a link (a copied folder has its original's); an
  // album on its way out keeps its own a little longer.
  const held = Object.entries(index.folders).some(([other, { link }]) => other !== folder && dirName(other) === dirName(folder) && link === fields.link && !vanished.has(other));
  if (held) {
    if (record.link) record.unsaved ||= true;
    return false;
  }
  record.link = fields.link;
  return true;
}
