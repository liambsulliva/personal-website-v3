#!/usr/bin/env node
// The one-time copy of the old albums (src/content/albums/*.yaml) into an
// album.yaml in each one's Published folder (docs/folder-albums-plan.md):
//
//   node scripts/album-yaml.mjs --albums <dir of the old YAML> --index <index.json> \
//     [--published /nas/photography/Published] [--out <dir>]
//
// Writes nothing in Published. It prints what it would write and checks that
// the site would show exactly what the YAML shows: the same albums, links,
// titles, dates, counts, covers and order. --out writes the files as a tree
// (<folder>/album.yaml) to be copied by hand. It can be run again at any time:
// a folder that already has an album.yaml is compared, never replaced.
//
// The old YAML, once it's gone from the branch:
//   git archive <commit before> src/content/albums | tar -x -C <dir>
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { albumOf, baseName, buildAlbums, MIN_ALBUM_PHOTOS } from "../services/lib/albums.mjs";
import { isLive, parseIndex } from "../services/lib/index.mjs";
import { editAlbumFile, parseAlbumFile, parseOldAlbum } from "../services/photos/albumFile.mjs";

/** The old albums as [{ slug, title, year, date, photos }]. */
export const readOldAlbums = (dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".yaml"))
    .sort()
    .map((name) => ({ slug: name.slice(0, -5), ...parseOldAlbum(readFileSync(join(dir, name), "utf8")) }));

/** What the site shows for the old files, as src/lib/albums.ts listed them. */
const shownBefore = (old) =>
  old
    .filter(({ photos }) => photos.length >= MIN_ALBUM_PHOTOS)
    .map(({ slug, title, year, date, photos }) => ({ link: slug, title, year, date, count: photos.length, photos }))
    .sort((a, b) => (b.date ?? `${b.year}-01-01`).localeCompare(a.date ?? `${a.year}-01-01`) || a.title.localeCompare(b.title));

const shownAfter = (index) => buildAlbums(index).top.map(({ path, title, year, date, count, photos }) => ({ link: path, title, year, date, count, photos }));

/**
 * @param old    readOldAlbums()
 * @param index  the photo index (not modified)
 * @param read   folder -> the album.yaml already there, or null
 * Returns { files: [{ folder, slug, text, state, kept }], problems, differences }
 *   state: "new" | "same" | "differs" (the file there is left alone)
 */
export function planCopy({ old, index, read = () => null }) {
  const next = structuredClone(index);
  next.albums = {}; // the copy must stand without it
  const files = [];
  const problems = [];
  for (const { slug, date, photos } of old) {
    const found = photos.map((id) => [id, next.photos[id]]);
    const lost = found.filter(([, photo]) => !isLive(photo)).map(([id]) => id);
    if (lost.length) problems.push(`${slug}: ${lost.length} photos aren't published (${lost.slice(0, 5).join(", ")})`);
    const live = found.filter(([, photo]) => isLive(photo)).map(([, photo]) => photo);
    const folders = new Set(live.map(({ path }) => albumOf(path)));
    const [folder] = folders;
    if (folders.size !== 1 || folder === null) {
      problems.push(`${slug}: its photos are in ${folders.size === 1 ? "no album folder" : `${folders.size} folders`}`);
      continue;
    }
    if (files.some((file) => file.folder === folder)) {
      problems.push(`${slug}: ${folder} already belongs to ${files.find((file) => file.folder === folder).slug}`);
      continue;
    }
    const fields = { link: slug, ...(date ? { date } : {}), order: live.map(({ path }) => baseName(path)) };
    const there = read(folder);
    const record = there === null ? fields : parseAlbumFile(there);
    const kept = Object.keys(fields).filter((name) => JSON.stringify(record[name]) !== JSON.stringify(fields[name]));
    files.push({ folder, slug, text: there ?? editAlbumFile(null, fields), state: there === null ? "new" : kept.length ? "differs" : "same", kept });
    next.folders[folder] = record;
  }
  const before = shownBefore(old);
  const after = shownAfter(next);
  const differences = [];
  if (before.length !== after.length) differences.push(`${before.length} albums now, ${after.length} after`);
  for (const [i, album] of before.entries()) {
    const now = after.find(({ link }) => link === album.link);
    if (!now) {
      differences.push(`${album.link}: not shown after`);
      continue;
    }
    if (after[i]?.link !== album.link) differences.push(`${album.link}: not in the same place in the carousel`);
    for (const name of Object.keys(album)) if (JSON.stringify(now[name]) !== JSON.stringify(album[name])) differences.push(`${album.link}: ${name} differs${name === "photos" ? "" : ` (${album[name]} → ${now[name]})`}`);
  }
  return { files, problems, differences };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { albums: { type: "string" }, index: { type: "string" }, published: { type: "string" }, out: { type: "string" }, quiet: { type: "boolean" } } });
  if (!values.albums || !values.index) {
    console.error("usage: album-yaml.mjs --albums <dir> --index <index.json> [--published <dir>] [--out <dir>] [--quiet]");
    process.exit(2);
  }
  const index = parseIndex(readFileSync(values.index, "utf8"));
  const read = (folder) => {
    const file = values.published && join(values.published, folder, "album.yaml");
    return file && existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  const { files, problems, differences } = planCopy({ old: readOldAlbums(values.albums), index, read });
  for (const { folder, text, state, kept } of files) {
    if (!values.quiet) console.log(`── ${folder}/album.yaml (${state}${kept.length ? `: ${kept.join(", ")}` : ""})\n${text}`);
    if (values.out && state === "new") {
      mkdirSync(join(values.out, folder), { recursive: true });
      writeFileSync(join(values.out, folder, "album.yaml"), text);
    }
  }
  const count = (state) => files.filter((file) => file.state === state).length;
  console.log(`${files.length} albums: ${count("new")} to write, ${count("same")} already there, ${count("differs")} there and different (left alone)${values.out ? `; written under ${dirname(join(values.out, "x"))}` : "; nothing written"}`);
  for (const line of problems) console.log(`PROBLEM ${line}`);
  for (const line of differences) console.log(`VISIBLE ${line}`);
  if (!problems.length && !differences.length) console.log("The site would show exactly what the old files show.");
  process.exit(problems.length || differences.length ? 1 : 0);
}
