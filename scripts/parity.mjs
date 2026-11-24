// The self-host plan's parity list (docs/self-host-plan.md), run against two
// origins: a reference (the live Vercel site) and a candidate (the NAS
// server, staging, or the apex after cutover). Prints one line per check and
// exits 1 if any differ.
//
//   node scripts/parity.mjs https://liambsullivan.com http://127.0.0.1:4321 --as liambsullivan.com
//   node scripts/parity.mjs https://liambsullivan.com https://staging.liambsullivan.com
//
// --as <host>   send this Host header and X-Forwarded-Proto: https to the
//               candidate, the way cloudflared does (for a local server).
// Behind Cloudflare Access, set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET
// (a service token) and they go to the candidate only.
//
// JSON routes compare shapes (keys and value types), not values: a local
// server with stubbed upstreams returns other photos than production.
import { request as http } from "node:http";
import { request as https } from "node:https";
import { LEGACY_REDIRECTS } from "../src/lib/redirects.mjs";

const args = process.argv.slice(2);
const asAt = args.indexOf("--as");
const as = asAt === -1 ? undefined : args[asAt + 1];
// Without --as, asAt + 1 is 0: don't drop the first origin.
const [reference, candidate] = args.filter((arg, i) => !arg.startsWith("--") && (asAt === -1 || i !== asAt + 1));
if (!reference || !candidate) {
  console.error("usage: node scripts/parity.mjs <reference origin> <candidate origin> [--as <host>]");
  process.exit(2);
}

const access = process.env.CF_ACCESS_CLIENT_ID
  ? { "cf-access-client-id": process.env.CF_ACCESS_CLIENT_ID, "cf-access-client-secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "" }
  : {};

/** One GET, no redirects followed. */
function get(origin, path, headers = {}) {
  const url = new URL(path, origin);
  const isCandidate = origin === candidate;
  const send = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = send(
      url,
      {
        headers: {
          "user-agent": "parity-check",
          ...(isCandidate && as ? { host: as, "x-forwarded-proto": "https" } : {}),
          ...(isCandidate ? access : {}),
          ...headers,
        },
        timeout: 20_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on("timeout", () => req.destroy(new Error(`timeout: ${url}`)));
    req.on("error", reject);
    req.end();
  });
}

const text = (res) => res.body.toString("utf8");
const title = (res) => text(res).match(/<title>([^<]*)<\/title>/)?.[1] ?? null;
const canonical = (res) => text(res).match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? null;
const ogUrl = (res) => text(res).match(/<meta property="og:url" content="([^"]+)"/)?.[1] ?? null;
const shape = (value) =>
  Array.isArray(value)
    ? value.length ? [shape(value[0])] : []
    : value && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]))
      : typeof value;
const json = (res) => {
  try {
    return [res.status, shape(JSON.parse(text(res)))];
  } catch {
    return [res.status, "not JSON"];
  }
};

let failures = 0;
const notes = [];
async function check(name, path, pick, headers) {
  const [ref, cand] = await Promise.all([get(reference, path, headers), get(candidate, path, headers)]);
  const a = JSON.stringify(pick(ref, reference));
  const b = JSON.stringify(pick(cand, candidate));
  const ok = a === b;
  if (!ok) failures++;
  console.log(ok ? `ok    ${name.padEnd(48)} ${a.slice(0, 90)}` : `DIFF  ${name}\n        reference ${a}\n        candidate ${b}`);
  return { ref, cand };
}

// Write-ups from the reference's sitemap, one per wing; the first album it shows.
const sitemap = text(await get(reference, "/sitemap.xml"));
const writeups = [...sitemap.matchAll(/<loc>https?:\/\/[^/]+(\/(?:engineering|design|writing)\/[^<]+\/)<\/loc>/g)].map((m) => m[1]);
const perWing = Object.values(Object.groupBy(writeups, (path) => path.split("/")[1])).map((paths) => paths[0]);
const album = [...text(await get(reference, "/photography")).matchAll(/data-album-stack="([^"]+)"/g)].map((m) => m[1])[0];

console.log(`reference ${reference}\ncandidate ${candidate}${as ? ` (as ${as})` : ""}\n`);

// Legacy redirects: status and Location, with and without a slash, with a query.
for (const from of Object.keys(LEGACY_REDIRECTS)) {
  for (const path of [from, `${from}/`, `${from}?ref=old`]) {
    await check(`redirect ${path}`, path, (res) => [res.status, res.headers.location ?? null]);
  }
}

// Pages: status, <title> and canonical.
for (const path of ["/", "/me/", "/career/", "/engineering/", "/design/", "/writing/", "/photography/", ...perWing]) {
  await check(`page ${path}`, path, (res) => [res.status, title(res), canonical(res)]);
}
await check("page /me (no slash)", "/me", (res) => [res.status, title(res)]);

// Shared photography links render that source.
await check(`photography ${album}`, `/photography/${album}`, (res) => [res.status, title(res), ogUrl(res)]);
await check(`photography ?album=${album}`, `/photography?album=${album}`, (res) => [res.status, res.headers.location ?? null]);
await check("photography ?tag=music", "/photography?tag=music", (res) => [res.status, title(res), ogUrl(res)]);

// The four photo routes: status and JSON shape.
await check("api cloudinary/search", "/api/cloudinary/search?expression=resource_type%3Aimage&max_results=3", json);
await check("api cloudinary/tags", "/api/cloudinary/tags", json);
await check("api cloudinary/pool ?tag=music", "/api/cloudinary/pool?tag=music", json);
await check(`api cloudinary/album ?slug=${album}`, `/api/cloudinary/album?slug=${album}`, json);
await check("api cloudinary/pool hidden tag", "/api/cloudinary/pool?tag=_internal", (res) => res.status);

// Switch menu: the embed's RAWG call (as the iframe sends it), a direct visit, frame headers.
const embed = (origin) => ({ referer: `${new URL(as && origin === candidate ? `https://${as}` : origin).origin}/switch-menu/`, "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" });
for (const [origin, label] of [[reference, "reference"], [candidate, "candidate"]]) {
  const res = await get(origin, "/api/rawg/platforms", embed(origin));
  notes.push(`switch menu RAWG from the embed (${label}): ${res.status} ${text(res).slice(0, 60)}`);
}
await check("rawg without the embed's Referer", "/api/rawg/platforms", (res) => res.status);
await check("switch-menu direct visit → write-up", "/switch-menu/", (res) => [res.status, /window\.location\.replace\("\/engineering\/switch-react-menu\/"\)/.test(text(res))]);
const frame = (res) => ["x-frame-options", "content-security-policy", "referrer-policy"].map((h) => res.headers[h] ?? null);
const swAsset = text(await get(reference, "/switch-menu/")).match(/\/switch-menu\/assets\/[^"]+\.js/)?.[0];
if (swAsset) await check("switch-menu asset frame headers", swAsset, frame);
for (const path of ["/switch-menu/", "/switch-menu"]) {
  const [ref, cand] = await Promise.all([get(reference, path), get(candidate, path)]);
  notes.push(`frame headers on ${path}: reference ${JSON.stringify(frame(ref))}, candidate ${JSON.stringify(frame(cand))}`);
}

// Not found, sitemap, robots.
for (const path of ["/nope", "/dashboard", "/engineering/nope/", "/OTHER-WORK"]) {
  await check(`404 ${path}`, path, (res) => [res.status, title(res)]);
}
await check("sitemap.xml", "/sitemap.xml", (res) => [res.status, text(res)]);
await check("robots.txt", "/robots.txt", (res) => [res.status, text(res)]);

// Hashed assets cache immutably; PDFs load.
// Each build hashes its own file names, so each side is asked for one of its own.
const assetOf = async (origin) => text(await get(origin, "/")).match(/\/_astro\/[^"]+\.(?:css|js)/)?.[0];
const assets = { [reference]: await assetOf(reference), [candidate]: await assetOf(candidate) };
{
  const [a, b] = await Promise.all(
    [reference, candidate].map(async (origin) => {
      if (!assets[origin]) return JSON.stringify(null);
      const res = await get(origin, assets[origin]);
      return JSON.stringify([res.status, res.headers["cache-control"]]);
    }),
  );
  if (a !== b) failures++;
  console.log(a === b ? `ok    ${"asset /_astro/* (each side's own)".padEnd(48)} ${a}` : `DIFF  asset /_astro/*\n        reference ${assets[reference]} ${a}\n        candidate ${assets[candidate]} ${b}`);
}
for (const pdf of ["/Resume.pdf", "/pitch-deck.pdf", "/presentation/clubmeeting1.pdf", "/layouts/wii-manual.pdf"]) {
  await check(`pdf ${pdf}`, pdf, (res) => [res.status, res.headers["content-type"], res.body.length]);
}

console.log(`\nnot compared (expected to differ):\n${notes.map((n) => `  ${n}`).join("\n")}`);
console.log(`\n${failures ? `${failures} difference(s)` : "no differences"}`);
process.exit(failures ? 1 : 0);
