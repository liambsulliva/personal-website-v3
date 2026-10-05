// Shared Cloudinary helpers for the photography scripts (photo-tags,
// photo-albums). Credentials come from the environment or .env.

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

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

export function requireCredentials() {
  if (!cloud || !key || !secret) {
    console.error("Missing CLOUDINARY_* credentials in .env");
    process.exit(1);
  }
}

const API = () => `https://api.cloudinary.com/v1_1/${cloud}`;
const authHeader = () => `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;

// Same scope as src/lib/cloudinaryServer.ts PHOTO_SCOPE.
export const PHOTO_SCOPE = "NOT (folder:site/* OR tags=samples)";

/** Every resource matching `expression`, paged through Search (500 a call). */
export async function searchAll(expression, { fields = ["tags"], sortBy = [{ created_at: "asc" }] } = {}) {
  const resources = [];
  let cursor;
  do {
    const res = await fetch(`${API()}/resources/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader() },
      body: JSON.stringify({
        expression,
        fields,
        sort_by: sortBy,
        max_results: 500,
        ...(cursor ? { next_cursor: cursor } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    resources.push(...data.resources);
    cursor = data.next_cursor;
  } while (cursor);
  return resources;
}

/** Admin API resource details with EXIF. Returns the JSON plus the rate-limit
 *  headers (the Admin API allows 500 calls an hour). */
export async function resourceWithMetadata(publicId) {
  const res = await fetch(`${API()}/resources/image/upload/${encodeURIComponent(publicId)}?image_metadata=true`, {
    headers: { Authorization: authHeader() },
  });
  const remaining = Number(res.headers.get("x-featureratelimit-remaining") ?? NaN);
  const reset = res.headers.get("x-featureratelimit-reset");
  if (res.status === 420 || res.status === 429) return { limited: true, remaining: 0, reset };
  if (!res.ok) throw new Error(`Resource ${publicId} failed: ${res.status} ${await res.text()}`);
  return { data: await res.json(), remaining, reset };
}

/** Upload API tags endpoint: signed, up to 1000 public_ids per call. */
export async function changeTag(command, tag, ids) {
  const done = [];
  for (let i = 0; i < ids.length; i += 1000) {
    const batch = ids.slice(i, i + 1000);
    const timestamp = Math.floor(Date.now() / 1000);
    const params = { command, public_ids: batch.join(","), tag, timestamp };
    const toSign = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join("&");
    const body = new URLSearchParams({ command, tag, timestamp: String(timestamp), api_key: key });
    batch.forEach((id) => body.append("public_ids[]", id));
    body.set("signature", createHash("sha1").update(toSign + secret).digest("hex"));

    const res = await fetch(`${API()}/image/tags`, { method: "POST", body });
    const data = await res.json();
    if (!res.ok) throw new Error(`Tagging failed: ${data.error?.message ?? res.status}`);
    done.push(...data.public_ids);
  }
  return done;
}

export const TAG_PATTERN = /^[A-Za-z0-9_.:-]+$/;
