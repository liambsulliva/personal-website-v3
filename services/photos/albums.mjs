// Album files (src/content/albums/*.yaml) from Published folders.
import { Document, isSeq, parseDocument } from "yaml";
import { isLive } from "../lib/index.mjs";

/** The Published folder a photo is in, or null when that isn't an album (root, _unsorted, _site). */
export function folderOf(path) {
  const at = path.indexOf("/");
  return at === -1 || path.startsWith("_") ? null : path.slice(0, at);
}

/** "Bigelow Bash 4-11" → { title: "Bigelow Bash", month: 4, day: 11 } */
export function parseFolder(folder) {
  const m = /^(.*\S)\s+(\d{1,2})-(\d{1,2})$/.exec(folder);
  const month = Number(m?.[2]);
  const day = Number(m?.[3]);
  return m && month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { title: m[1], month, day } : { title: folder, month: null, day: null };
}

// Same rule as cms-dashboard's shared/utils/content.ts.
export const slugify = (text) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const byCapture = ([, a], [, b]) =>
  (a.takenAt ?? "9999").localeCompare(b.takenAt ?? "9999") || a.path.localeCompare(b.path, "en", { numeric: true });

/** The live photos in `folder`, in capture order: [[id, photo], …] */
export const photosIn = (index, folder) =>
  Object.entries(index.photos)
    .filter(([, photo]) => photo.kind === "photo" && isLive(photo) && folderOf(photo.path) === folder)
    .sort(byCapture);

const pad = (n) => String(n).padStart(2, "0");

/** A new album's fields. Its date is the first capture, or the folder's month and day in the year it arrived. */
export function describeAlbum(folder, entries) {
  const { title, month, day } = parseFolder(folder);
  const taken = entries.map(([, photo]) => photo.takenAt).filter(Boolean).sort()[0];
  const arrived = entries.map(([, photo]) => photo.createdAt).sort()[0];
  const year = Number((taken ?? arrived).slice(0, 4));
  const date = taken ? taken.slice(0, 10) : month ? `${year}-${pad(month)}-${pad(day)}` : null;
  return { title, year, date };
}

export function slugFor({ title, year, date }, taken) {
  const base = `${year}-${slugify(title) || "album"}${date ? `-${date.slice(5, 7)}${date.slice(8, 10)}` : ""}`;
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

const HEADER = " title, year and date are yours to edit. The photos service adds photos that land in the\n album's Published folder and drops ones that leave it; the order is yours.";

export function newAlbumYaml({ title, year, date }, ids) {
  const doc = new Document({ title, year, date, count: ids.length, photos: ids });
  doc.commentBefore = HEADER;
  doc.get("title", true).type = "QUOTE_DOUBLE";
  // Unquoted, as in the existing files: the schema coerces it to a date.
  if (date) doc.get("date", true).type = "PLAIN";
  for (const item of doc.get("photos").items) item.type = "QUOTE_DOUBLE";
  return doc.toString({ lineWidth: 0 });
}

/**
 * `text` with `add` appended to its photos and `remove` taken out, everything
 * else (title, date, order, comments) left as it was. Null when nothing
 * changes, or when it would be left with no photos (the schema needs one).
 */
export function mergeAlbumYaml(text, { add, remove }) {
  const doc = parseDocument(text);
  if (doc.errors.length) throw doc.errors[0];
  const seq = doc.get("photos");
  if (!isSeq(seq)) throw new Error("album has no photos list");
  const before = seq.items.map((item) => item.value);
  const kept = seq.items.filter((item) => !remove.has(item.value));
  const added = add.filter((id) => !before.includes(id));
  if (kept.length === before.length && !added.length) return null;
  if (!kept.length && !added.length) return null;
  seq.items = kept;
  for (const id of added) {
    const node = doc.createNode(id);
    node.type = "QUOTE_DOUBLE";
    seq.items.push(node);
  }
  doc.set("count", seq.items.length);
  return doc.toString({ lineWidth: 0 });
}

/**
 * The album changes Published asks for. An album remembers which photos it has
 * been offered (`known`), so one taken off an album in the dashboard isn't put
 * back while its file stays in the folder.
 *
 * Returns [{ slug, folder, create, add, remove, ids }], slug null for a new album
 */
export function planAlbums(index) {
  const folders = new Map();
  for (const photo of Object.values(index.photos)) {
    const folder = photo.kind === "photo" && isLive(photo) ? folderOf(photo.path) : null;
    if (folder !== null && !folders.has(folder)) folders.set(folder, photosIn(index, folder).map(([id]) => id));
  }
  const plans = [];
  const linked = new Set();
  const albums = Object.entries(index.albums).map(([slug, album]) => {
    // A renamed folder: the album's own has emptied, and most of its photos are together somewhere unlinked.
    let { folder } = album;
    if (!folders.has(folder) && album.known.length) {
      const renamed = [...folders].find(
        ([name, ids]) => !Object.values(index.albums).some((other) => other.folder === name) && album.known.filter((id) => ids.includes(id)).length * 2 > album.known.length,
      );
      if (renamed) folder = renamed[0];
    }
    linked.add(folder);
    return { slug, folder, known: album.known, was: album.folder };
  });
  for (const { slug, folder, known, was } of albums) {
    const ids = folders.get(folder) ?? [];
    const add = ids.filter((id) => !known.includes(id));
    const remove = known.filter((id) => !ids.includes(id));
    if (add.length || remove.length || folder !== was) plans.push({ slug, folder, create: false, add, remove, ids });
  }
  for (const [folder, ids] of folders) if (!linked.has(folder)) plans.push({ slug: null, folder, create: true, add: ids, remove: [], ids });
  return plans;
}

const idsIn = (text) => {
  const doc = parseDocument(text);
  const seq = doc.errors.length ? null : doc.get("photos");
  return isSeq(seq) ? seq.items.map((item) => item.value) : [];
};

/**
 * The album file that already holds most of `ids` and that no folder is linked
 * to: one renamed in the dashboard, or made there before the folder's photos
 * were known. Null when there isn't one.
 */
async function findAlbumOf(ids, { repo, index, slugs }) {
  for (const slug of slugs) {
    if (Object.hasOwn(index.albums, slug)) continue;
    const file = await repo.read(slug);
    const held = file ? new Set(idsIn(file.text)) : new Set();
    if (ids.length && ids.filter((id) => held.has(id)).length * 2 > ids.length) return { slug, file };
  }
  return null;
}

/** Carries out `planAlbums` for folders that have been quiet for `quietMs`, one commit per album. */
export async function syncAlbums({ index, memory, repo, now = Date.now(), quietMs = 300_000, log = console.log }) {
  const plans = planAlbums(index);
  const pending = new Map();
  let changed = false;
  for (const plan of plans) {
    const key = `${plan.add.join()}|${plan.remove.join()}`;
    const was = memory.get(plan.folder);
    const since = was?.key === key ? was.since : now;
    pending.set(plan.folder, { key, since });
    if (now - since < quietMs) continue;
    try {
      let { slug } = plan;
      if (plan.create) {
        const made = await findAlbumOf(plan.ids, { repo, index, slugs: await repo.slugs() });
        if (made) {
          // Only what it was missing is added; its title, order and photos are the dashboard's.
          const text = mergeAlbumYaml(made.file.text, { add: plan.ids, remove: new Set() });
          if (text) await repo.write(made.slug, text, made.file.sha, `albums: update ${made.slug}`);
          index.albums[made.slug] = { folder: plan.folder, known: plan.ids };
          log(`[albums] linked ${made.slug} to "${plan.folder}"`);
          pending.delete(plan.folder);
          changed = true;
          continue;
        }
        const fields = describeAlbum(plan.folder, photosIn(index, plan.folder));
        slug = slugFor(fields, new Set([...(await repo.slugs()), ...Object.keys(index.albums)]));
        await repo.write(slug, newAlbumYaml(fields, plan.ids), null, `albums: add ${fields.title}`);
        index.albums[slug] = { folder: plan.folder, known: plan.ids };
        log(`[albums] created ${slug} from "${plan.folder}" (${plan.ids.length})`);
      } else {
        let file = plan.add.length || plan.remove.length ? await repo.read(slug) : null;
        if (!file && (plan.add.length || plan.remove.length)) {
          const renamed = await findAlbumOf(index.albums[slug].known, { repo, index, slugs: await repo.slugs() });
          if (renamed) {
            log(`[albums] ${slug} is now ${renamed.slug}`);
            delete index.albums[slug];
            ({ slug, file } = renamed);
          }
        }
        const text = file && mergeAlbumYaml(file.text, { add: plan.add, remove: new Set(plan.remove) });
        if (text) await repo.write(slug, text, file.sha, `albums: update ${slug}`);
        // A deleted album's photos stay published; the folder just has no album any more.
        index.albums[slug] = { folder: plan.folder, known: plan.ids };
        log(`[albums] ${slug}: +${plan.add.length} -${plan.remove.length}${text ? "" : " (file unchanged)"}`);
      }
      pending.delete(plan.folder);
      changed = true;
    } catch (error) {
      log(`[albums] "${plan.folder}" will retry: ${error.message}`);
    }
  }
  memory.clear();
  for (const [folder, entry] of pending) memory.set(folder, entry);
  return changed;
}
