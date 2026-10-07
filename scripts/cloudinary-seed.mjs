#!/usr/bin/env node
// Seeds site imagery into Cloudinary from the frozen v2 repo and writes
// src/data/cloudinary-manifest.json (public_id → intrinsic size), which the
// site uses for aspect ratios / CLS without calling the Admin API at runtime.
//
//   npm run cloudinary:seed            dry run: verify sources, write manifest
//   npm run cloudinary:seed -- --apply upload missing assets (never overwrites)
//
// Needs CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET in .env for --apply.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";
import { IMAGE_MAP, V2_ROOT } from "./cloudinary-map.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = resolve(ROOT, "src/data/cloudinary-manifest.json");
const apply = process.argv.includes("--apply");

const env = Object.fromEntries(
  existsSync(resolve(ROOT, ".env"))
    ? readFileSync(resolve(ROOT, ".env"), "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.startsWith("#"))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()])
    : [],
);
const cloud = process.env.CLOUDINARY_CLOUD_NAME ?? env.CLOUDINARY_CLOUD_NAME;
const key = process.env.CLOUDINARY_API_KEY ?? env.CLOUDINARY_API_KEY;
const secret = process.env.CLOUDINARY_API_SECRET ?? env.CLOUDINARY_API_SECRET;

const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const manifest = {};
const reserved = [];
const missing = [];
const uploads = [];

for (const { id, src, local } of IMAGE_MAP) {
  if (!src) {
    reserved.push(id);
    if (previous[id]) manifest[id] = previous[id];
    continue;
  }
  const file = local ? resolve(ROOT, src) : resolve(ROOT, V2_ROOT, src);
  if (!existsSync(file)) {
    missing.push(`${id} ← ${src}`);
    continue;
  }
  const buffer = readFileSync(file);
  const { width, height } = imageSize(buffer);
  manifest[id] = { width, height };
  uploads.push({ id, file, buffer });
}

const exists = async (id) => {
  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload/${encodeURIComponent(id).replaceAll("%2F", "/")}`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  return res.ok;
};

const upload = async ({ id, file, buffer }) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { overwrite: "false", public_id: id, timestamp: String(timestamp) };
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const signature = createHash("sha1").update(toSign + secret).digest("hex");
  const form = new FormData();
  form.append("file", new Blob([buffer]), file.split("/").pop());
  for (const [k, v] of Object.entries(params)) form.append(k, v);
  form.append("api_key", key);
  form.append("signature", signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`${id}: ${res.status} ${await res.text()}`);
  return res.json();
};

console.log(`${uploads.length} sourced, ${reserved.length} reserved, ${missing.length} missing`);
missing.forEach((m) => console.log(`  ✗ missing source: ${m}`));
reserved.forEach((r) => console.log(`  ○ reserved (upload by hand): ${r}`));

if (apply) {
  if (!cloud || !key || !secret) throw new Error("Cloudinary credentials missing");
  let done = 0;
  const queue = [...uploads];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        if (await exists(item.id)) {
          console.log(`  = exists   ${item.id}`);
          continue;
        }
        const result = await upload(item);
        manifest[item.id] = { width: result.width, height: result.height };
        console.log(`  ↑ uploaded ${item.id} (${++done})`);
      }
    }),
  );
  // Reserved slots that were uploaded by hand: record their size too.
  for (const id of reserved) {
    const auth = Buffer.from(`${key}:${secret}`).toString("base64");
    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloud}/resources/image/upload/${id}`,
      { headers: { Authorization: `Basic ${auth}` } },
    );
    if (res.ok) {
      const { width, height } = await res.json();
      manifest[id] = { width, height };
      console.log(`  ✓ reserved slot filled: ${id}`);
    }
  }
} else {
  console.log("Dry run. Re-run with --apply to upload.");
}

// CMS uploads write ids that aren't in IMAGE_MAP. Keep them so a later seed
// doesn't blank the covers the dashboard already published.
const mapped = new Set(IMAGE_MAP.map((e) => e.id));
for (const [id, size] of Object.entries(previous)) {
  if (!mapped.has(id) && manifest[id] === undefined) manifest[id] = size;
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + "\n");
console.log(`Wrote ${Object.keys(sorted).length} entries → src/data/cloudinary-manifest.json`);
