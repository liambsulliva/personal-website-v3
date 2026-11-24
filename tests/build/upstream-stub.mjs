// Preloaded into the built server by tests/build/server.test.ts
// (`node --import ./tests/build/upstream-stub.mjs server.mjs`): answers the
// RAWG and WordPress calls the SSR routes make, checks they carry the key the
// server was started with, and appends one JSON line per call to
// $UPSTREAM_LOG. Any other outbound request is refused, so the run never
// touches the network.
import { appendFileSync } from "node:fs";

const LOG = process.env.UPSTREAM_LOG;

const log = (entry) => {
  if (LOG) appendFileSync(LOG, `${JSON.stringify(entry)}\n`);
};

function rawg(url) {
  const authorized = url.searchParams.get("key") === process.env.RAWG_API_KEY;
  log({ upstream: "rawg", path: url.pathname, authorized });
  if (!authorized) return Response.json({ error: "bad key" }, { status: 401 });
  // RAWG's paging links carry the caller's key, as the real API's do.
  const next = new URL(url);
  next.searchParams.set("page", "2");
  return Response.json({
    count: 1,
    next: next.href,
    previous: `${url.origin}${url.pathname}?key=${url.searchParams.get("key")}`,
    results: [{ id: 7, name: "Nintendo Switch", slug: "nintendo-switch" }],
  });
}

function wordpress(url) {
  log({ upstream: "wordpress", path: url.pathname });
  return Response.json({
    posts: [
      { ID: 1, title: "Stub Berlin Post", date: "2024-06-01T10:00:00+00:00", URL: "https://pbtw.example/one", featured_image: "" },
    ],
  });
}

globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname === "api.rawg.io") return rawg(url);
  if (url.hostname === "public-api.wordpress.com") return wordpress(url);
  log({ upstream: "refused", url: url.href });
  throw new TypeError(`upstream-stub: refused ${url.href}`);
};
