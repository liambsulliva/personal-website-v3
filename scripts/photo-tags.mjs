#!/usr/bin/env node
// Tags photography in Cloudinary from the terminal — the v3 stand-in for v2's
// dashboard checkboxes. Every tag on a photo outside site/ becomes a chip,
// except `_`-prefixed ones (e.g. the `_album-<slug>` tags photo-albums writes).
//
//   npm run photos:tags -- list <tag>                  public_ids carrying <tag>
//   npm run photos:tags -- add <tag> <public_id…>      e.g. add _album-2026-nala DSC_0412
//   npm run photos:tags -- remove <tag> <public_id…>
//
// Needs CLOUDINARY_CLOUD_NAME / _API_KEY / _API_SECRET in .env.

import { TAG_PATTERN, changeTag, requireCredentials, searchAll } from "./lib/cloudinary.mjs";

const [command, tag, ...ids] = process.argv.slice(2);
const usage = () => {
  console.error("usage: photos:tags -- list <tag> | add <tag> <public_id…> | remove <tag> <public_id…>");
  process.exit(1);
};

requireCredentials();
if (!tag || !TAG_PATTERN.test(tag)) usage();

if (command === "list") {
  const resources = await searchAll(`resource_type:image AND tags=${tag}`, { fields: [] });
  console.log(resources.map((r) => r.public_id).join("\n"));
  console.error(`${resources.length} image(s) tagged "${tag}"`);
} else if (command === "add" || command === "remove") {
  if (ids.length === 0) usage();
  const done = await changeTag(command, tag, ids);
  console.log(`${command === "add" ? "Added" : "Removed"} "${tag}" ${command === "add" ? "to" : "from"} ${done.length} image(s)`);
  console.error("The site's photo pages cache for up to 5 minutes on Vercel.");
} else {
  usage();
}
