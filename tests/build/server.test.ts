// The Node build's routing, tested against the real server: server.mjs over
// the built dist/, started on a free port with tests/build/upstream-stub.mjs
// preloaded in place of Cloudinary, RAWG and WordPress. Runs after
// `DEPLOY_TARGET=node npm run test:build`; skipped otherwise.
//
// The cases marked (regression) are the ones a plain adapter swap gets wrong
// (docs/self-host-plan.md, "Things that silently break"); each fails against
// such a build (SITE_DIST / SITE_ENTRY in ./site.ts).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { albumVersion } from "../../src/lib/albumData";
import { listAlbums } from "../../src/lib/albums";
import { LEGACY_REDIRECTS } from "../../src/lib/redirects.mjs";
import { SWITCH_MENU_PROJECT_URL } from "../../src/lib/switchMenuEmbed";
import { BUILT, DIST, ENTRY, ROOT, TARGET, redirectTargetExists, writeupPages } from "./site";

const RUN = BUILT && TARGET === "node";
const HOST = "liambsullivan.com";

// Credentials the server gets at start, never at build: the stub refuses
// any other, so a route that answers proves it read these at runtime.
const SECRETS = {
  CLOUDINARY_API_KEY: "runtime-key-7f3a",
  CLOUDINARY_API_SECRET: "runtime-secret-9c1e",
  RAWG_API_KEY: "runtime-rawg-4b2d",
};

type Reply = { status: number; headers: IncomingHttpHeaders; body: string };
type Call = { upstream: string; path?: string; expression?: string; authorized?: boolean };

let server: ChildProcess | undefined;
let port = 0;
let scratch = "";
let output = "";

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });

/** One request, no redirect following, any Host header. */
function get(path: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<Reply>((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path, method, headers: { host: HOST, ...headers } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/** What the browser sends from behind Cloudflare: https, the real Host. */
const viaTunnel = { "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.7" };

const calls = (): Call[] =>
  existsSync(join(scratch, "upstream.log"))
    ? readFileSync(join(scratch, "upstream.log"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];

const title = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1];

const TEST_SHA = "0123456789abcdef0123456789abcdef01234567";

beforeAll(async () => {
  if (!RUN) return;
  scratch = mkdtempSync(join(tmpdir(), "site-server-"));
  port = await freePort();
  server = spawn(process.execPath, ["--import", join(ROOT, "tests/build/upstream-stub.mjs"), ENTRY], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH,
      HOST: "127.0.0.1",
      PORT: String(port),
      CLOUDINARY_CLOUD_NAME: "stub-cloud",
      SITE_SHA: TEST_SHA,
      ...SECRETS,
      UPSTREAM_LOG: join(scratch, "upstream.log"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout!.on("data", (chunk) => (output += chunk));
  server.stderr!.on("data", (chunk) => (output += chunk));
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`server exited (${server.exitCode}):\n${output}`);
    try {
      // /healthz is server.mjs's; a build without it still has a 404 page.
      if ((await get("/healthz")).status > 0) break;
    } catch {}
    if (Date.now() > deadline) throw new Error(`server did not start:\n${output}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(() => {
  server?.kill("SIGTERM");
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe.skipIf(!RUN)("Node server (server.mjs over dist/)", () => {
  it("answers the health check with the commit it serves", async () => {
    const res = await get("/healthz");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    // scripts/uptime.mjs compares this with main to catch a deploy that failed.
    expect(JSON.parse(res.body)).toEqual({ ok: true, sha: TEST_SHA });
    expect((await get("/healthz", {}, "HEAD")).status).toBe(200);
  });

  // Vercel did these at its edge; behind the tunnel the server must.
  describe("canonical origin", () => {
    it("(regression) sends www to the apex in one 308, path and query kept, with HSTS", async () => {
      const res = await get("/photography?tag=film", { ...viaTunnel, host: `www.${HOST}` });
      expect(res.status).toBe(308);
      expect(res.headers.location).toBe(`https://${HOST}/photography?tag=film`);
      expect(res.headers["strict-transport-security"]).toBe("max-age=63072000");
    });

    it("(regression) sends http to https, www straight to the apex", async () => {
      for (const host of [HOST, `www.${HOST}`]) {
        const res = await get("/writing/?x=1", { "x-forwarded-proto": "http", host });
        expect(res.status, host).toBe(308);
        expect(res.headers.location, host).toBe(`https://${HOST}/writing/?x=1`);
        expect(res.headers["strict-transport-security"], host).toBeUndefined();
      }
    });

    it("(regression) gives every https response Vercel's HSTS header", async () => {
      for (const path of ["/", "/other-work", "/switch-menu/", "/favicon/icon-light.svg", "/nope"]) {
        expect((await get(path, viaTunnel)).headers["strict-transport-security"], path).toBe("max-age=63072000");
      }
    });

    it("leaves a request without X-Forwarded-Proto alone (the healthcheck, deploy.sh's probes)", async () => {
      const res = await get("/");
      expect(res.status).toBe(200);
      expect(res.headers["strict-transport-security"]).toBeUndefined();
    });
  });

  describe("legacy redirects", () => {
    for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
      it(`301s ${from}, with or without a slash, to a page that exists`, async () => {
        for (const path of [from, `${from}/`]) {
          const res = await get(path);
          expect(res.status, path).toBe(301);
          expect(res.headers.location, path).toBe(to);
        }
        expect(redirectTargetExists(to), to).toBe(true);
      });
    }

    it("(regression) keeps the query string, as Vercel does", async () => {
      const res = await get("/other-work/?utm_source=old-link");
      expect(res.status).toBe(301);
      expect(res.headers.location).toBe("/design?utm_source=old-link");
    });

    it("matches case-sensitively and only the exact path", async () => {
      expect((await get("/OTHER-WORK")).status).toBe(404);
      expect((await get("/other-work/extra")).status).toBe(404);
    });
  });

  describe("pages", () => {
    const pages = ["/", "/me/", "/career/", "/engineering/", "/design/", ...writeupPages().map((p) => `/${p.replace(/index\.html$/, "")}`)];
    for (const path of pages) {
      it(`serves ${path} with its canonical`, async () => {
        const res = await get(path);
        expect(res.status, path).toBe(200);
        expect(res.headers["content-type"]).toMatch(/^text\/html/);
        expect(title(res.body), path).toMatch(/Liam Sullivan/);
        expect(res.body).toContain(`<link rel="canonical" href="https://liambsullivan.com${path}"`);
      });
    }

    it("serves a prerendered page without its trailing slash too", async () => {
      const res = await get("/me");
      expect(res.status).toBe(200);
      expect(title(res.body)).toMatch(/Liam Sullivan/);
    });

    it("renders /writing with the Berlin feed", async () => {
      const res = await get("/writing/", viaTunnel);
      expect(res.status).toBe(200);
      expect(res.body).toContain("Stub Berlin Post");
      expect(res.headers["cache-control"]).toBe("public, s-maxage=300, stale-while-revalidate=86400");
    });

    it("returns 404 with the 404 page for unknown paths and the dashboard", async () => {
      const notFound = readFileSync(join(DIST, "client/404.html"), "utf8");
      for (const path of ["/nope", "/dashboard", "/dashboard/", "/engineering/nope/"]) {
        const res = await get(path);
        expect(res.status, path).toBe(404);
        expect(title(res.body), path).toBe(title(notFound));
      }
    });

    it("serves sitemap.xml, robots.txt and the PDFs", async () => {
      const sitemap = await get("/sitemap.xml");
      expect(sitemap.status).toBe(200);
      expect(sitemap.headers["content-type"]).toMatch(/xml/);
      expect(sitemap.body).toContain("<loc>https://liambsullivan.com/photography/</loc>");
      const robots = await get("/robots.txt");
      expect(robots.body).toMatch(/Sitemap: https:\/\/liambsullivan\.com\/sitemap\.xml/);
      for (const pdf of ["/Resume.pdf", "/pitch-deck.pdf"]) {
        const res = await get(pdf);
        expect(res.status, pdf).toBe(200);
        expect(res.headers["content-type"], pdf).toBe("application/pdf");
      }
    });

    it("caches /_astro assets immutably", async () => {
      const asset = readdirSync(join(DIST, "client/_astro")).find((file) => file.endsWith(".css"))!;
      const res = await get(`/_astro/${asset}`);
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    });
  });

  describe("photography and the Cloudinary routes", () => {
    it("(regression) reads the Cloudinary credentials when it starts, not at build", async () => {
      const res = await get("/photography", viaTunnel);
      expect(res.status, output).toBe(200);
      expect(title(res.body)).toBe("Photography - Liam Sullivan");
      expect(res.body).toContain("stub-");
      const searches = calls().filter((call) => call.upstream === "cloudinary");
      expect(searches.length).toBeGreaterThan(0);
      expect(searches.every((call) => call.authorized)).toBe(true);
    });

    it("(regression) a second /photography render makes no upstream call", async () => {
      await get("/photography", viaTunnel);
      const before = calls().length;
      // Precondition: the first render did reach Cloudinary.
      expect(calls().filter((call) => call.upstream === "cloudinary" && call.authorized).length).toBeGreaterThan(0);
      const res = await get("/photography", viaTunnel);
      expect(res.status).toBe(200);
      expect(calls().length).toBe(before);
      expect(res.headers["cache-control"]).toBe("public, s-maxage=300, stale-while-revalidate=86400");
    });

    it("renders a shared album link and a shared tag link as that source", async () => {
      const [album] = await listAlbums();
      const byAlbum = await get(`/photography?album=${album.slug}`, viaTunnel);
      expect(byAlbum.status).toBe(200);
      expect(title(byAlbum.body)).toBe(`${album.title} - Liam Sullivan`);
      expect(byAlbum.body).toMatch(new RegExp(`property="og:url" content="https://liambsullivan\\.com/photography/?\\?album=${album.slug}"`));
      const byTag = await get("/photography?tag=music", viaTunnel);
      expect(title(byTag.body)).toMatch(/^Music Photos - /);
    });

    it("answers the four Cloudinary API routes with their JSON shapes", async () => {
      const [album] = await listAlbums();
      const search = await get("/api/cloudinary/search?expression=resource_type%3Aimage&max_results=5");
      expect(search.status).toBe(200);
      expect(Object.keys(JSON.parse(search.body))).toContain("resources");
      expect(JSON.parse(search.body).resources[0]).toEqual(
        expect.objectContaining({ public_id: expect.any(String), secure_url: expect.any(String), width: 3000, height: 2000 }),
      );
      const tags = JSON.parse((await get("/api/cloudinary/tags")).body);
      expect(tags).toEqual({ tags: ["music", "soccer"] });
      const pool = JSON.parse((await get("/api/cloudinary/pool?tag=music")).body);
      expect(Object.keys(pool)).toEqual(["resources"]);
      expect(pool.resources.length).toBeGreaterThan(0);
      const albumRes = await get(`/api/cloudinary/album?slug=${album.slug}`);
      expect(albumRes.status).toBe(200);
      expect(JSON.parse(albumRes.body).resources.map((r: { public_id: string }) => r.public_id)).toEqual(album.photos);
      expect((await get("/api/cloudinary/pool?tag=_internal")).status).toBe(403);
      expect((await get("/api/cloudinary/album?slug=nope")).status).toBe(404);
    });

    it("(regression) keeps an album for a day only under its current photo list's URL", async () => {
      // Cloudflare isn't purged on deploy, so a CMS publish that changes an
      // album must change the URL the gallery asks for.
      const albums = await listAlbums();
      const page = (await get("/photography", viaTunnel)).body;
      for (const album of albums.slice(0, 3)) {
        const version = albumVersion(album);
        // The island's props carry each album's version ([0, value] is Astro's string encoding).
        expect(page).toContain(`&quot;version&quot;:[0,&quot;${version}&quot;]`);
        const current = await get(`/api/cloudinary/album?slug=${album.slug}&v=${version}`);
        expect(current.status).toBe(200);
        expect(current.headers["cache-control"]).toBe("public, s-maxage=86400, stale-while-revalidate=604800");
        for (const stale of [`/api/cloudinary/album?slug=${album.slug}`, `/api/cloudinary/album?slug=${album.slug}&v=old`]) {
          const res = await get(stale);
          expect(res.status).toBe(200);
          expect(res.headers["cache-control"]).toBe("public, s-maxage=300, stale-while-revalidate=86400");
        }
      }
    });
  });

  describe("Switch menu", () => {
    const frame = {
      "content-security-policy": "frame-ancestors 'self'",
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "same-origin",
    };

    it("(regression) sends the frame headers on the embed and its assets", async () => {
      const asset = readdirSync(join(DIST, "client/switch-menu/assets")).find((file) => file.endsWith(".js"))!;
      for (const path of ["/switch-menu/", "/switch-menu", `/switch-menu/assets/${asset}`]) {
        const res = await get(path);
        expect(res.status, path).toBe(200);
        expect(res.headers, path).toEqual(expect.objectContaining(frame));
      }
    });

    it("sends a direct visit to the write-up", async () => {
      // The document itself redirects when it isn't framed (as on Vercel).
      const res = await get("/switch-menu/");
      expect(res.body).toContain(`window.location.replace("${SWITCH_MENU_PROJECT_URL}")`);
    });

    it("(regression) lets the embed call the RAWG proxy from behind the tunnel", async () => {
      const fromEmbed = { ...viaTunnel, referer: `https://${HOST}/switch-menu/`, "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" };
      const res = await get("/api/rawg/platforms", fromEmbed);
      expect(res.status, res.body).toBe(200);
      expect(JSON.parse(res.body).results[0].name).toBe("Nintendo Switch");
      expect(res.headers["cache-control"]).toBe("private, max-age=300");
      expect(calls().filter((call) => call.upstream === "rawg").every((call) => call.authorized)).toBe(true);
    });

    it("refuses the RAWG proxy without the embed's Referer, or from another host", async () => {
      expect((await get("/api/rawg/platforms", viaTunnel)).status).toBe(403);
      const elsewhere = { ...viaTunnel, referer: "https://evil.example/switch-menu/" };
      expect((await get("/api/rawg/platforms", elsewhere)).status).toBe(403);
      // An unlisted Host is not trusted, so it can't vouch for a matching Referer.
      const spoofed = { ...viaTunnel, host: "evil.example", referer: "https://evil.example/switch-menu/" };
      expect((await get("/api/rawg/platforms", spoofed)).status).toBe(403);
    });
  });

  describe("secrets", () => {
    it("has none of the secrets in the build output", () => {
      const values = [...Object.values(SECRETS)];
      // A developer's own .env is what Astro would inline into the bundle.
      const env = join(ROOT, ".env");
      if (existsSync(env)) {
        for (const line of readFileSync(env, "utf8").split("\n")) {
          const [, key, value] = line.match(/^\s*(CLOUDINARY_API_KEY|CLOUDINARY_API_SECRET|RAWG_API_KEY)\s*=\s*"?([^"\s]+)"?/) ?? [];
          if (key && value) values.push(value);
        }
      }
      const files = (dir: string): string[] =>
        readdirSync(dir).flatMap((name) => {
          const path = join(dir, name);
          return statSync(path).isDirectory() ? files(path) : [path];
        });
      for (const file of files(join(DIST, "server")).filter((f) => /\.m?js$/.test(f))) {
        const code = readFileSync(file, "utf8");
        for (const value of values) expect(code.includes(value), `${value.slice(0, 4)}… in ${file}`).toBe(false);
      }
    });
  });

  it("made no outbound request the stub doesn't know", () => {
    expect(calls().filter((call) => call.upstream === "refused")).toEqual([]);
  });
});
