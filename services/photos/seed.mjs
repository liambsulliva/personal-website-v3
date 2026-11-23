// Builds the first index: every photo already published on Cloudinary keeps
// its id, upload date, tags and alt text, and every album keeps its slug.
//
//   node services/photos/seed.mjs --export cloudinary.json --published /published --albums src/content/albums --out index.json
//
// The export comes from scripts/cloudinary-export.mjs. Files are matched by
// name: Published/<folder>/<id>.jpg, and Published/_site/… for site/….
// Refuses to write over an index, or while a photo is missing or its bytes
// differ from Cloudinary's (--allow-different accepts listed differences).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { emptyIndex, saveIndex, TAG_RE } from "../lib/index.mjs";
import { folderOf, photosIn } from "./albums.mjs";
import { readMetadata } from "./metadata.mjs";
import { listPublished, versionOf } from "./scan.mjs";

const nameOf = (path) => path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");

/** Returns { index, problems: { missing, different, extra, badTags, albums } } */
export async function seed({ exported, root, albums }) {
  const index = emptyIndex();
  const problems = { missing: [], different: [], extra: [], badTags: [], albums: [] };
  const { files } = await listPublished(root);
  const photoFiles = new Map(files.filter(({ kind }) => kind === "photo").map((file) => [nameOf(file.path), file]));
  const siteFiles = new Map(files.filter(({ kind }) => kind === "site").map((file) => [`site/${file.path.slice("_site/".length).replace(/\.[^.]+$/, "")}`, file]));
  const used = new Set();

  for (const asset of exported) {
    const file = asset.public_id.startsWith("site/") ? siteFiles.get(asset.public_id) : photoFiles.get(asset.public_id);
    if (!file) {
      problems.missing.push(asset.public_id);
      continue;
    }
    used.add(file.path);
    const buffer = await readFile(join(root, file.path));
    if (createHash("md5").update(buffer).digest("hex") !== asset.etag) problems.different.push(asset.public_id);
    const hash = createHash("sha256").update(buffer).digest("hex");
    const meta = await readMetadata(buffer);
    const badTags = asset.tags.filter((tag) => !TAG_RE.test(tag));
    if (badTags.length) problems.badTags.push(`${asset.public_id}: ${badTags.join(", ")}`);
    // Today's tags exactly: a file keyword Cloudinary never had would change the site, so it starts switched off.
    const fileTags = meta.fileTags.filter((tag) => TAG_RE.test(tag));
    const tagEdits = { ...Object.fromEntries(fileTags.map((tag) => [tag, false])), ...Object.fromEntries(asset.tags.map((tag) => [tag, true])) };
    index.photos[asset.public_id] = {
      path: file.path,
      kind: file.kind,
      sig: file.sig,
      hash,
      version: versionOf(hash),
      bytes: file.size,
      ...meta,
      fileTags,
      ...(Object.keys(tagEdits).length ? { tagEdits } : {}),
      ...(asset.alt ? { alt: asset.alt } : {}),
      createdAt: new Date(asset.created_at).toISOString(),
    };
  }
  problems.extra = files.filter(({ path }) => !used.has(path)).map(({ path }) => path);

  for (const { slug, photos } of albums) {
    const folders = new Set(photos.map((id) => index.photos[id]).filter(Boolean).map(({ path }) => folderOf(path)));
    const [folder] = folders;
    if (folders.size !== 1 || folder === null || Object.values(index.albums).some((album) => album.folder === folder)) {
      problems.albums.push(`${slug}: ${folders.size === 1 ? "folder is shared or not an album folder" : `${folders.size} folders`} (${[...folders].join(", ")})`);
      continue;
    }
    index.albums[slug] = { folder, known: photosIn(index, folder).map(([id]) => id) };
  }
  return { index, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { export: { type: "string" }, published: { type: "string" }, albums: { type: "string" }, out: { type: "string" }, "allow-different": { type: "boolean" } },
  });
  if (!values.export || !values.published || !values.albums || !values.out) {
    console.error("usage: seed.mjs --export <json> --published <dir> --albums <dir> --out <index.json> [--allow-different]");
    process.exit(2);
  }
  if (existsSync(values.out)) {
    console.error(`${values.out} exists; move it away first`);
    process.exit(1);
  }
  const albums = [];
  for (const name of await readdir(values.albums)) {
    if (name.endsWith(".yaml")) albums.push({ slug: name.slice(0, -5), ...parse(await readFile(join(values.albums, name), "utf8")) });
  }
  const { index, problems } = await seed({ exported: JSON.parse(await readFile(values.export, "utf8")), root: values.published, albums });
  for (const [kind, list] of Object.entries(problems)) {
    if (list.length) console.error(`${kind} (${list.length}):\n${list.slice(0, 20).map((line) => `  ${line}`).join("\n")}${list.length > 20 ? "\n  …" : ""}`);
  }
  const stop = problems.missing.length || problems.extra.length || problems.badTags.length || problems.albums.length || (problems.different.length && !values["allow-different"]);
  if (stop) {
    console.error("nothing written");
    process.exit(1);
  }
  await saveIndex(values.out, index);
  console.log(`${Object.keys(index.photos).length} photos, ${Object.keys(index.albums).length} albums -> ${values.out}`);
}
