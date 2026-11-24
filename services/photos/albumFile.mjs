// album.yaml, one per album folder (docs/folder-albums-plan.md): link, date,
// order and was. Anything else in the file, comments included, is kept.
import { randomBytes } from "node:crypto";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Document, isMap, isSeq, parseDocument } from "yaml";

export const ALBUM_FILE = "album.yaml";
export const MAX_ALBUM_FILE = 256 * 1024;

const LINK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEADER = ` link: this album's address, set once; was: addresses it had before
 date (2026-04-11) and order (file names, the first three are the cover) are optional`;

const isDay = (text) => {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : null;
  return Boolean(at) && !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === text;
};
export const isLinkSegment = (text) => text.length <= 120 && LINK.test(text);
const isFullLink = (text) => text.length <= 600 && text.split("/").every(isLinkSegment);

/** A field's value as it may be written, or an error naming what's wrong. */
export const FIELDS = {
  link: (value) => (isLinkSegment(value) ? value : fail("link must be lower-case words joined by hyphens")),
  date: (value) => (isDay(value) ? value : fail("date must be a day, like 2026-04-11")),
  order: (value) => (value.every((name) => name && name.length <= 255) ? value : fail("order must be a list of file names")),
  was: (value) => (value.every(isFullLink) ? value : fail("was must be a list of links")),
};
function fail(message) {
  throw new Error(message);
}

/** { link?, date?, order?, was? }; throws, saying what's wrong, when the file can't be used. */
export function parseAlbumFile(text) {
  // Every scalar stays a string: a folder called 007 isn't a number.
  const doc = parseDocument(text, { schema: "failsafe" });
  if (doc.errors.length) fail(`not valid YAML (line ${doc.errors[0].linePos?.[0].line ?? "?"})`);
  if (doc.contents === null || doc.contents?.value === "") return {};
  if (!isMap(doc.contents)) fail("expected fields, like date: 2026-04-11");
  const values = doc.toJS({ maxAliasCount: 0 });
  const out = {};
  for (const [name, check] of Object.entries(FIELDS)) {
    const value = values[name];
    if (value === undefined || value === null || value === "") continue;
    const list = name === "order" || name === "was";
    if (list ? !Array.isArray(value) || !value.every((item) => typeof item === "string") : typeof value !== "string") fail(`${name} must be ${list ? "a list" : "a single value"}`);
    out[name] = check(value);
    if (list && !value.length) delete out[name];
  }
  return out;
}

/** An album as src/content/albums kept it, for the one-time copy (scripts/album-yaml.mjs). */
export function parseOldAlbum(text) {
  const { title, year, date, photos } = parseDocument(text, { schema: "failsafe" }).toJS();
  return { title, year: Number(year), date: date && date !== "null" ? date : null, photos };
}

/** `text` (null for a new file) with these fields set; an undefined or empty one is taken out. */
export function editAlbumFile(text, fields) {
  let doc = text === null ? new Document({}) : parseDocument(text);
  if (doc.errors.length) throw new Error("album.yaml isn't valid YAML");
  if (!isMap(doc.contents)) {
    const { commentBefore, comment } = doc;
    doc = new Document({});
    doc.commentBefore = commentBefore ?? comment ?? HEADER;
  }
  if (text === null) doc.commentBefore = HEADER;
  for (const name of Object.keys(FIELDS)) {
    if (!(name in fields)) continue;
    const value = fields[name];
    if (value === undefined || value === null || value.length === 0) doc.delete(name);
    else {
      const node = doc.createNode(value);
      if (isSeq(node)) node.flow = false;
      doc.set(name, node);
    }
  }
  return doc.contents.items.length ? doc.toString({ lineWidth: 0 }) : `${doc.commentBefore ? doc.commentBefore.replace(/^/gm, "#") : ""}\n`;
}

export const sigOf = (info) => `${info.size}:${Math.trunc(info.mtimeMs)}`;

/** The file's text, or null without one. */
export async function readAlbumFile(root, folder) {
  try {
    const file = join(root, folder, ALBUM_FILE);
    if ((await stat(file)).size > MAX_ALBUM_FILE) fail("album.yaml is too large");
    return await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Replaces the file whole, or makes it. Never makes the folder. Returns its sig. */
export async function writeAlbumFile(root, folder, text) {
  const file = join(root, folder, ALBUM_FILE);
  // A dotfile, so neither the scan nor Finder shows it.
  const temp = join(dirname(file), `.${ALBUM_FILE}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    await writeFile(temp, text);
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
  return sigOf(await stat(file));
}
