// Preloaded into the built server by tests/build/server.test.ts
// (`node --import ./tests/build/upstream-stub.mjs server.mjs`): answers the
// Cloudinary Search, RAWG and WordPress calls the SSR routes make, checks they
// carry the credentials the server was started with, and appends one JSON
// line per call to $UPSTREAM_LOG. Any other outbound request is refused, so
// the run never touches the network.
import { appendFileSync } from "node:fs";

const LOG = process.env.UPSTREAM_LOG;
const TAGS = ["music", "soccer", "featured", "_internal"];

/** 25 photos, more than the gallery's first page of 20. */
const PHOTOS = Array.from({ length: 25 }, (_, i) => ({
  public_id: `stub-${String(i).padStart(2, "0")}`,
  secure_url: `https://res.cloudinary.com/stub/image/upload/v1/stub-${i}.jpg`,
  width: 3000,
  height: 2000,
  tags: [TAGS[i % TAGS.length]],
}));

const log = (entry) => {
  if (LOG) appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
};

function cloudinary(url, init) {
  const expected = `Basic ${Buffer.from(`${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`).toString("base64")}`;
  const auth = new Headers(init?.headers).get("authorization");
  const body = JSON.parse(String(init?.body ?? "{}"));
  log({ upstream: "cloudinary", path: url.pathname, expression: body.expression, authorized: auth === expected });
  if (auth !== expected || !url.pathname.startsWith(`/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/`)) {
    return Response.json({ error: { message: "Invalid credentials" } }, { status: 401 });
  }
  const ids = [...String(body.expression).matchAll(/public_id="([^"]+)"/g)].map((m) => m[1]);
  // The routes scope every expression with `AND NOT (folder:site/* OR tags=samples)`.
  const tag = String(body.expression).match(/^resource_type:image AND tags=([\w.:-]+)/)?.[1];
  const matches = ids.length
    ? ids.toReversed().map((public_id, i) => ({ ...PHOTOS[i % PHOTOS.length], public_id }))
    : PHOTOS.filter((photo) => !tag || photo.tags.includes(tag));
  // Pages like Search does: an opaque cursor while more remain.
  const from = Number(body.next_cursor ?? 0);
  const to = from + (body.max_results ?? 50);
  const page = { resources: matches.slice(from, to) };
  return Response.json(to < matches.length ? { ...page, next_cursor: String(to) } : page);
}

function rawg(url) {
  const authorized = url.searchParams.get("key") === process.env.RAWG_API_KEY;
  log({ upstream: "rawg", path: url.pathname, authorized });
  if (!authorized) return Response.json({ error: "bad key" }, { status: 401 });
  return Response.json({ count: 1, results: [{ id: 7, name: "Nintendo Switch", slug: "nintendo-switch" }] });
}

function wordpress(url) {
  log({ upstream: "wordpress", path: url.pathname });
  return Response.json({
    posts: [
      { ID: 1, title: "Stub Berlin Post", date: "2024-06-01T10:00:00+00:00", URL: "https://pbtw.example/one", featured_image: "" },
    ],
  });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "api.cloudinary.com") return cloudinary(url, init);
  if (url.hostname === "api.rawg.io") return rawg(url);
  if (url.hostname === "public-api.wordpress.com") return wordpress(url);
  log({ upstream: "refused", url: url.href });
  throw new TypeError(`upstream-stub: refused ${url.href}`);
};
