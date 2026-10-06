#!/usr/bin/env node
// Builds /photography's albums from the photo drive's shoot folders
// (scripts/album-folders.json). Cloudinary has no link back to those folders,
// so photos are matched by capture date and reviewed before anything is
// written. Most Cloudinary copies are Flickr originals that lost their EXIF;
// their filename carries the Flickr id, and Flickr kept the date taken.
//
//   npm run photos:albums -- exif      cache each photo's EXIF capture date and
//                                      original filename (resumable; stops
//                                      with 150 of the hourly 500 Admin/Search
//                                      calls left for the live site)
//   npm run photos:albums -- flickr    cache Flickr's date taken for those
//                                      filenames (needs FLICKR_API_KEY)
//   npm run photos:albums -- propose   match photos to folders → scripts/album-proposal.json
//                                      (--offline: no Cloudinary call, from caches)
//                                      + a thumbnail contact sheet in scripts/.cache/
//   npm run photos:albums -- build     generate src/content/albums/*.yaml from the (edited)
//                                      proposal, offline (photo ids live in the
//                                      repo; nothing is tagged in Cloudinary)
//
// Needs CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET (and FLICKR_API_KEY,
// FLICKR_USER_ID) in .env.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PHOTO_SCOPE, ROOT, envValue, requireCredentials, resourceWithMetadata, searchAll } from "./lib/cloudinary.mjs";
import { MIN_ALBUM_PHOTOS, captureDay, flickrIdOf, parseFolders, proposeAlbums, albumYaml, siteAlbums } from "./lib/albums.mjs";
import { accountDates, photoDate } from "./lib/flickr.mjs";

const CACHE_DIR = resolve(ROOT, "scripts/.cache");
// public_id → { taken: EXIF DateTimeOriginal | null, file: original filename }
const EXIF_CACHE = resolve(CACHE_DIR, "photo-meta.json");
// Flickr photo id → date taken (EXIF form) | null
const FLICKR_CACHE = resolve(CACHE_DIR, "flickr-dates.json");
const FLICKR_USER = () => envValue("FLICKR_USER_ID") ?? "148052898@N03"; // flickr.com/photos/zebulatory
// NAS camera-file hits: stem → paths under /PhotoDrive (Synology search)
const NAS_HITS = resolve(CACHE_DIR, "nas-hits.json");
// The Cloudinary photo list from the last online propose
const PHOTOS_CACHE = resolve(CACHE_DIR, "photos.json");
const FOLDERS = resolve(ROOT, "scripts/album-folders.json");
const PROPOSAL = resolve(ROOT, "scripts/album-proposal.json");
const SHEET = resolve(CACHE_DIR, "proposal.html");
const ALBUMS_DIR = resolve(ROOT, "src/content/albums");
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

async function flickr() {
  const apiKey = envValue("FLICKR_API_KEY");
  if (!apiKey) throw new Error("Missing FLICKR_API_KEY in .env (free key: flickr.com/services/apps/create).");
  const meta = readJson(EXIF_CACHE, {});
  const wanted = [...new Set(Object.values(meta).map((entry) => flickrIdOf(entry.file)).filter(Boolean))];
  const dates = { ...readJson(FLICKR_CACHE, {}), ...(await accountDates(apiKey, FLICKR_USER())) };
  // Photos outside the public listing (another account, or since hidden).
  const missing = wanted.filter((id) => !(id in dates));
  for (const id of missing) dates[id] = await photoDate(apiKey, id);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeJson(FLICKR_CACHE, dates);
  const dated = wanted.filter((id) => dates[id]).length;
  console.error(`${wanted.length} Flickr ids in the cached filenames; ${dated} have a date taken (${missing.length} looked up one by one).`);
}

/** The photo list propose matches: Cloudinary's (cached for offline runs),
 *  or with `--offline` the cache, else the ids in the last proposal. */
async function photoList(offline) {
  if (!offline) {
    const photos = await listPhotos();
    mkdirSync(CACHE_DIR, { recursive: true });
    writeJson(PHOTOS_CACHE, photos.map(({ public_id, secure_url, tags, created_at }) => ({ public_id, secure_url, tags, created_at })));
    return photos;
  }
  const cached = readJson(PHOTOS_CACHE, null);
  if (cached) return cached;
  const previous = readJson(PROPOSAL, null);
  if (!previous) throw new Error("Nothing to run offline from: run `propose` online once.");
  const cloud = envValue("CLOUDINARY_CLOUD_NAME");
  const ids = [...previous.albums.flatMap((album) => album.photos.map(({ id }) => id)), ...previous.unassigned];
  return [...new Set(ids)].map((public_id) => ({
    public_id,
    secure_url: `https://res.cloudinary.com/${cloud}/image/upload/${public_id}`,
    tags: [],
    created_at: "",
  }));
}

async function propose(offline) {
  const cache = readJson(EXIF_CACHE, null);
  if (!cache) throw new Error("No EXIF cache yet: run `exif` first.");
  const photos = await photoList(offline);
  const missing = photos.filter((photo) => !cache[photo.public_id]).length;
  if (missing) console.error(`Note: ${missing} photos have no cached filename/EXIF; only their public_id can place them.`);
  const flickrDates = readJson(FLICKR_CACHE, {});
  const nasHits = readJson(NAS_HITS, {});
  const folders = parseFolders(readJson(FOLDERS, null) ?? {});
  const proposal = proposeAlbums(
    folders,
    photos.map((photo) => {
      const { taken = null, file = null } = cache[photo.public_id] ?? {};
      const when = captureDay(taken) ? taken : (flickrDates[flickrIdOf(file)] ?? null);
      return { ...photo, taken: when, file };
    }),
    { nasHits },
  );
  writeJson(PROPOSAL, proposal);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(SHEET, contactSheet(proposal, photos));

  const shown = proposal.albums.filter((album) => album.photos.length >= MIN_ALBUM_PHOTOS).length;
  console.error(
    `${proposal.albums.length} folders, ${shown} with ≥ ${MIN_ALBUM_PHOTOS} photos; ` +
      `${proposal.unassigned.length} photos unassigned.\n` +
      `Review ${PROPOSAL.replace(`${ROOT}/`, "")} (move ids between albums, delete what's wrong) ` +
      `with the contact sheet ${SHEET.replace(`${ROOT}/`, "")}, then run \`build\`.`,
  );
}

// Offline: no Cloudinary or Flickr calls. Membership lives in the generated
// module; the site reads each album's photos from Cloudinary by id.
function build() {
  const proposal = readJson(PROPOSAL, null);
  if (!proposal) throw new Error("No proposal yet: run `propose` first.");
  const cache = readJson(EXIF_CACHE, {});
  const flickrDates = readJson(FLICKR_CACHE, {});
  const taken = Object.fromEntries(
    Object.entries(cache).map(([id, entry]) => [id, captureDay(entry.taken) ? entry.taken : (flickrDates[flickrIdOf(entry.file)] ?? null)]),
  );
  const albums = siteAlbums(proposal, taken, envValue("CLOUDINARY_CLOUD_NAME"));
  // The collection is exactly this build: albums that fell under the minimum go.
  rmSync(ALBUMS_DIR, { recursive: true, force: true });
  mkdirSync(ALBUMS_DIR, { recursive: true });
  for (const album of albums) writeFileSync(resolve(ALBUMS_DIR, `${album.slug}.yaml`), albumYaml(album));
  const kept = proposal.albums.flatMap((album) => album.photos).filter(({ how }) => how !== "ambiguous").length;
  console.error(`Wrote ${albums.length} albums to ${ALBUMS_DIR.replace(`${ROOT}/`, "")} from ${kept} placed photos (ambiguous ones wait for review).`);
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
.nas img{outline:3px solid #72c}.named img{outline:3px solid #2a7}.nearby img{outline:3px dotted #27c}.inferred img{outline:3px dashed #d90}.ambiguous img{outline:3px solid #c33}</style>
<p><b style="color:#72c">Purple</b> = its camera file is in that NAS folder. Named = the photo's own name matches the folder. Dated = capture date (EXIF or Flickr) match. <b style="color:#27c">Dotted</b> = a folder dated a day off. <b style="color:#d90">Dashed</b> = inferred from neighbours in upload order. <b style="color:#c33">Red</b> = same-day folders the tags couldn't split.</p>
${proposal.albums.map((album) => section(`${album.year} · ${album.folder}${album.photos.length < MIN_ALBUM_PHOTOS ? ` (hidden: < ${MIN_ALBUM_PHOTOS})` : ""}`, album.photos)).join("")}
${section("Unassigned", proposal.unassigned.map((id) => ({ id, how: "unassigned" })))}`;
}

requireCredentials();
const command = process.argv[2];
if (command === "exif") await exif();
else if (command === "flickr") await flickr();
else if (command === "propose") await propose(process.argv.includes("--offline"));
else if (command === "build") build();
else {
  console.error("usage: photos:albums -- exif | flickr | propose | build");
  process.exit(1);
}
