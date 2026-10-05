#!/usr/bin/env node
// Tags photography in Cloudinary from the terminal — the v3 stand-in for v2's
// dashboard checkboxes. `featured` drives the /photography carousel; every
// other tag on a photo outside site/ becomes a chip.
//
//   npm run photos:tags -- list <tag>                  public_ids carrying <tag>
//   npm run photos:tags -- add <tag> <public_id…>      e.g. add featured DSC_0412
//   npm run photos:tags -- remove <tag> <public_id…>
//
// Needs CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET in .env.

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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

const [command, tag, ...ids] = process.argv.slice(2);
const usage = () => {
  console.error("usage: photos:tags -- list <tag> | add <tag> <public_id…> | remove <tag> <public_id…>");
  process.exit(1);
};

if (!cloud || !key || !secret) {
  console.error("Missing CLOUDINARY_* credentials in .env");
  process.exit(1);
}
if (!tag || !/^[A-Za-z0-9_.:-]+$/.test(tag)) usage();

if (command === "list") {
  const ids = [];
  let cursor;
  do {
    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        expression: `resource_type:image AND tags=${tag}`,
        max_results: 500,
        ...(cursor ? { next_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    ids.push(...data.resources.map((r) => r.public_id));
    cursor = data.next_cursor;
  } while (cursor);
  console.log(ids.join("\n"));
  console.error(`${ids.length} image(s) tagged "${tag}"`);
} else if (command === "add" || command === "remove") {
  if (ids.length === 0) usage();
  // Upload API tags endpoint: signed, up to 1000 public_ids per call.
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { command, public_ids: ids.join(","), tag, timestamp };
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  const body = new URLSearchParams({ command, tag, timestamp: String(timestamp), api_key: key });
  ids.forEach((id) => body.append("public_ids[]", id));
  body.set("signature", createHash("sha1").update(toSign + secret).digest("hex"));

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/tags`, { method: "POST", body });
  const data = await res.json();
  if (!res.ok) throw new Error(`Tagging failed: ${data.error?.message ?? res.status}`);
  console.log(`${command === "add" ? "Added" : "Removed"} "${tag}" ${command === "add" ? "to" : "from"} ${data.public_ids.length} image(s)`);
  console.error("The site's photo pages cache for up to 5 minutes on Vercel.");
} else {
  usage();
}
