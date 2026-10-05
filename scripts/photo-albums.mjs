#!/usr/bin/env node
// Builds /photography's albums from the photo drive's shoot folders
// (scripts/album-folders.json). Cloudinary has no link back to those folders,
// so photos are matched by EXIF capture date and reviewed before anything is
// written.
//
//   npm run photos:albums -- exif      cache each photo's EXIF capture date and
//                                      original filename (resumable; stops
//                                      with 150 of the hourly 500 Admin/Search
//                                      calls left for the live site)
//   npm run photos:albums -- propose   match photos to folders → scripts/album-proposal.json
//                                      + a thumbnail contact sheet in scripts/.cache/
//   npm run photos:albums -- apply     tag `_album-<slug>` from the (edited) proposal
//                                      and generate src/data/albums.ts
//
// Needs CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET in .env.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PHOTO_SCOPE, ROOT, changeTag, requireCredentials, resourceWithMetadata, searchAll } from "./lib/cloudinary.mjs";
import { MIN_ALBUM_PHOTOS, albumTag, captureDay, parseFolders, proposeAlbums, toAlbumsModule } from "./lib/albums.mjs";

const CACHE_DIR = resolve(ROOT, "scripts/.cache");
// public_id → { taken: EXIF DateTimeOriginal | null, file: original filename }
const EXIF_CACHE = resolve(CACHE_DIR, "photo-meta.json");
const FOLDERS = resolve(ROOT, "scripts/album-folders.json");
const PROPOSAL = resolve(ROOT, "scripts/album-proposal.json");
const SHEET = resolve(CACHE_DIR, "proposal.html");
const ALBUMS_MODULE = resolve(ROOT, "src/data/albums.ts");
// The Admin API's 500 calls an hour include Search, which the live site's
// photo pages use on every uncached render. Leave them plenty.
const RATE_FLOOR = 150;

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

const listPhotos = () =>
  searchAll(`resource_type:image AND ${PHOTO_SCOPE}`, { fields: ["tags", "secure_url", "width", "height", "created_at"] });

async function exif() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cache = readJson(EXIF_CACHE, {});
  const photos = await listPhotos();
  const todo = photos.filter((photo) => !cache[photo.public_id]);
  console.error(`${photos.length} photos, ${photos.length - todo.length} cached, ${todo.length} to fetch`);
  let fetched = 0;
  for (const photo of todo) {
    const result = await resourceWithMetadata(photo.public_id);
    if (result.limited) {
      console.error(`Rate limited. Resets ${result.reset}; run again after that.`);
      break;
    }
    const meta = result.data.image_metadata ?? {};
    cache[photo.public_id] = {
      taken: meta.DateTimeOriginal ?? meta.CreateDate ?? null,
      // Flickr originals keep their title here: `pitt-volleyball-v-oregon_54200994529_o`.
      file: result.data.original_filename ?? null,
    };
    fetched += 1;
    if (fetched % 25 === 0) writeJson(EXIF_CACHE, cache);
    if (result.remaining <= RATE_FLOOR) {
      console.error(`Stopping with ${result.remaining} Admin calls left. Resets ${result.reset}; run again after that.`);
      break;
    }
  }
  writeJson(EXIF_CACHE, cache);
  const left = photos.filter((photo) => !cache[photo.public_id]).length;
  const dated = Object.values(cache).filter((entry) => entry.taken).length;
  console.error(`Fetched ${fetched}. ${left} left. ${dated} of ${Object.keys(cache).length} cached photos are dated.`);
}

async function propose() {
  const cache = readJson(EXIF_CACHE, null);
  if (!cache) throw new Error("No EXIF cache yet: run `exif` first.");
  const photos = await listPhotos();
  const missing = photos.filter((photo) => !cache[photo.public_id]).length;
  if (missing) console.error(`Warning: ${missing} photos have no cached EXIF yet; they're treated as undated.`);
  const folders = parseFolders(readJson(FOLDERS, null) ?? {});
  const proposal = proposeAlbums(
    folders,
    photos.map((photo) => {
      const { taken = null, file = null } = cache[photo.public_id] ?? {};
      return { ...photo, taken: captureDay(taken) ? taken : null, file };
    }),
  );
  writeJson(PROPOSAL, proposal);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SHEET, contactSheet(proposal, photos));

  const shown = proposal.albums.filter((album) => album.photos.length >= MIN_ALBUM_PHOTOS).length;
  console.error(
    `${proposal.albums.length} folders matched photos (${shown} with ≥ ${MIN_ALBUM_PHOTOS}); ` +
      `${proposal.unassigned.length} photos unassigned.\n` +
      `Review ${PROPOSAL.replace(`${ROOT}/`, "")} (move ids between albums, delete what's wrong) ` +
      `with the contact sheet ${SHEET.replace(`${ROOT}/`, "")}, then run \`apply\`.`,
  );
}

async function apply() {
  const proposal = readJson(PROPOSAL, null);
  if (!proposal) throw new Error("No proposal yet: run `propose` first.");
  const cache = readJson(EXIF_CACHE, {});
  const photos = await listPhotos();
  const byId = new Map(photos.map((photo) => [photo.public_id, photo]));

  // Membership is whatever the proposal says now: strip stale album tags first.
  const wanted = new Map(proposal.albums.map((album) => [albumTag(album.slug), album.photos.map((photo) => photo.id)]));
  const existing = new Map();
  for (const photo of photos)
    for (const tag of photo.tags ?? [])
      if (tag.startsWith("_album-")) existing.set(tag, [...(existing.get(tag) ?? []), photo.public_id]);

  for (const [tag, ids] of existing) {
    const keep = new Set(wanted.get(tag) ?? []);
    const stale = ids.filter((id) => !keep.has(id));
    if (stale.length) console.error(`- ${tag}: removed from ${(await changeTag("remove", tag, stale)).length}`);
  }
  for (const [tag, ids] of wanted) {
    const have = new Set(existing.get(tag) ?? []);
    const add = ids.filter((id) => byId.has(id) && !have.has(id));
    if (add.length) console.error(`+ ${tag}: added to ${(await changeTag("add", tag, add)).length}`);
  }

  const taken = Object.fromEntries(Object.entries(cache).map(([id, entry]) => [id, entry.taken]));
  writeFileSync(ALBUMS_MODULE, toAlbumsModule(proposal, byId, taken));
  console.error(`Wrote ${ALBUMS_MODULE.replace(`${ROOT}/`, "")}. The site's photo pages cache for up to 5 minutes on Vercel.`);
}

const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const thumb = (url) => url.replace("/upload/", "/upload/c_fill,w_160,h_160,g_auto,f_auto,q_auto/");

function contactSheet(proposal, photos) {
  const byId = new Map(photos.map((photo) => [photo.public_id, photo]));
  const tile = ({ id, how }) => {
    const photo = byId.get(id);
    return photo
      ? `<figure class="${how}"><img loading="lazy" src="${thumb(photo.secure_url)}"><figcaption>${escape(id)}<br>${how} · ${escape((photo.tags ?? []).join(", "))}</figcaption></figure>`
      : "";
  };
  const section = (title, items) => `<h2>${escape(title)} <small>${items.length}</small></h2><div class="grid">${items.map(tile).join("")}</div>`;
  return `<!doctype html><meta charset="utf-8"><title>Album proposal</title>
<style>body{font:14px system-ui;margin:24px;background:#fafafa}h2{margin-top:32px}small{color:#888}.grid{display:flex;flex-wrap:wrap;gap:8px}
figure{margin:0;width:160px}img{width:160px;height:160px;border-radius:6px;display:block;background:#ddd}figcaption{font-size:11px;color:#555;word-break:break-all}
.inferred img{outline:3px dashed #d90}.ambiguous img{outline:3px solid #c33}</style>
<p>Dated = EXIF match. <b style="color:#d90">Dashed</b> = inferred from neighbours in upload order. <b style="color:#c33">Red</b> = same-day folders the tags couldn't split.</p>
${proposal.albums.map((album) => section(`${album.year} · ${album.folder}${album.photos.length < MIN_ALBUM_PHOTOS ? ` (hidden: < ${MIN_ALBUM_PHOTOS})` : ""}`, album.photos)).join("")}
${section("Unassigned", proposal.unassigned.map((id) => ({ id, how: "unassigned" })))}`;
}

requireCredentials();
const command = process.argv[2];
if (command === "exif") await exif();
else if (command === "propose") await propose();
else if (command === "apply") await apply();
else {
  console.error("usage: photos:albums -- exif | propose | apply");
  process.exit(1);
}
