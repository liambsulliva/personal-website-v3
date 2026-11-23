// Everything the NAS index keeps from Cloudinary (docs/photo-pipeline-plan.md):
// id, upload date, MD5, tags and alt text of every image but Cloudinary's
// samples. Reads only.
//
//   t3-vault run cloudinary-cloud-name cloudinary-api-key cloudinary-api-secret -- node scripts/cloudinary-export.mjs > cloudinary.json
const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
if (!cloud || !key || !secret) {
  console.error("CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET are required");
  process.exit(2);
}

const assets = [];
let cursor;
do {
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}` },
    body: JSON.stringify({ expression: "resource_type:image", max_results: 500, sort_by: [{ created_at: "desc" }], with_field: ["tags", "context"], ...(cursor ? { next_cursor: cursor } : {}) }),
  });
  if (!res.ok) {
    console.error(`Cloudinary Search: ${res.status}`);
    process.exit(1);
  }
  const page = await res.json();
  for (const { public_id, created_at, etag, tags = [], context, width, height, format, bytes } of page.resources) {
    // The same exclusion as the site's PHOTO_SCOPE.
    if (tags.includes("samples") || public_id.startsWith("samples/") || public_id === "main-sample") continue;
    const alt = context?.custom?.alt ?? context?.alt ?? null;
    assets.push({ public_id, created_at, etag, tags, alt, width, height, format, bytes });
  }
  cursor = page.next_cursor;
} while (cursor);
console.log(JSON.stringify(assets, null, 1));
console.error(`${assets.length} images, ${assets.filter(({ public_id }) => public_id.startsWith("site/")).length} under site/`);
