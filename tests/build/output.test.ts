// Checks on what `astro build` writes, for whichever target was built
// (tests/build/site.ts). Run `npm run test:build` (builds first), or
// `DEPLOY_TARGET=node npm run test:build` for the Node build; plain `npm test`
// skips these when there is no build to read. The Node server's routing is
// tested against the running server in server.test.ts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SWITCH_MENU_PROJECT_URL } from "../../src/lib/switchMenuEmbed";
import { BUILT, ROOT, STATIC, TARGET, VERCEL_OUTPUT, redirectTargetExists, writeupPages } from "./site";

const CONFIG = join(VERCEL_OUTPUT, "config.json");
const FIRST_WRITEUP = writeupPages()[0] ?? "index.html";

type Route = { src?: string; dest?: string; status?: number; headers?: Record<string, string>; handle?: string };

describe.skipIf(!BUILT || TARGET !== "vercel")("Vercel routing (config.json)", () => {
  const routes: Route[] = BUILT && TARGET === "vercel" ? JSON.parse(readFileSync(CONFIG, "utf8")).routes : [];
  const resolve = (path: string) => {
    for (const route of routes) {
      if (route.handle) continue;
      if (route.src && new RegExp(route.src).test(path)) return route;
    }
    return undefined;
  };

  // Every legacy redirect in the build: each one must send its old path to a page that exists.
  const redirects = routes.filter((route) => route.status === 301);
  it("ships legacy redirects", () => {
    expect(redirects.length).toBeGreaterThan(0);
  });
  for (const redirect of redirects) {
    const from = redirect.src!.replace(/^\^/, "").replace(/\/?\??\$$/, "");
    it(`301s ${from} to a page that exists`, () => {
      const target = redirect.headers!.Location!;
      expect(resolve(from)?.status, from).toBe(301);
      expect(resolve(from)?.headers?.Location, from).toBe(target);
      expect(redirectTargetExists(target), target).toBe(true);
    });
  }

  it("does not route a dashboard", () => {
    for (const path of ["/dashboard", "/dashboard/"]) {
      expect(resolve(path)?.status).toBe(404);
      expect(existsSync(join(STATIC, "dashboard"))).toBe(false);
    }
  });

  it("serves the SSR wings and APIs from the function", () => {
    for (const path of ["/photography", "/photography/an-album", "/photography/an-album/a-sub-album", "/writing/", "/api/cloudinary/search", "/api/rawg/games"]) {
      expect(resolve(path)?.dest, path).toBe("_render");
    }
  });

  it("caches hashed assets immutably from vercel.json", () => {
    // The adapter's own /_astro header route sits after `handle: filesystem`,
    // so Vercel never applies it to the static files it matches.
    const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const astro = vercel.headers.find((rule: { source: string }) => rule.source === "/_astro/(.*)");
    expect(astro?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  });
});

describe.skipIf(!BUILT)(`Prerendered output (${TARGET})`, () => {
  it("prerenders every static page", () => {
    for (const page of [
      "index.html",
      "404.html",
      "me/index.html",
      "career/index.html",
      "engineering/index.html",
      "design/index.html",
    ]) {
      expect(existsSync(join(STATIC, page)), page).toBe(true);
    }
  });

  it("prerenders a page for every write-up in the content", () => {
    // Derived from the content, so editing or adding write-ups never changes this test.
    const pages = writeupPages();
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect(existsSync(join(STATIC, page)), page).toBe(true);
  });

  it("ships robots.txt pointing at the sitemap and no switch-menu source maps", () => {
    const robots = readFileSync(join(STATIC, "robots.txt"), "utf8");
    expect(robots).toMatch(/Sitemap: https:\/\/[^\s]+\/sitemap\.xml/);
    expect(robots).toMatch(/Disallow: \/api\//);
    const assets = join(STATIC, "switch-menu/assets");
    expect(readdirSync(assets).filter((file) => file.endsWith(".map"))).toEqual([]);
    expect(readFileSync(join(STATIC, "switch-menu/index.html"), "utf8")).toContain(SWITCH_MENU_PROJECT_URL);
  });

  it("inlines critical CSS and defers the stylesheets on prerendered pages", () => {
    for (const page of ["index.html", "me/index.html", FIRST_WRITEUP]) {
      const html = readFileSync(join(STATIC, page), "utf8");
      const stylesheets = html.match(/<link rel="stylesheet"[^>]*>/g) ?? [];
      // Every stylesheet outside <noscript> loads as print, then swaps to all.
      const blocking = html
        .replace(/<noscript>.*?<\/noscript>/gs, "")
        .match(/<link rel="stylesheet"(?![^>]*media="print")[^>]*>/g);
      expect(stylesheets.length, page).toBeGreaterThan(0);
      expect(blocking, page).toBeNull();
      const inline = [...html.matchAll(/<style>(.*?)<\/style>/gs)].map((m) => m[1]).join("");
      expect(inline, page).toContain(":root.dark");
    }
  });

  it("preloads the above-the-fold Geist weights the stylesheet uses", () => {
    const html = readFileSync(join(STATIC, "index.html"), "utf8");
    const css = readdirSync(join(STATIC, "_astro"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(join(STATIC, "_astro", file), "utf8"))
      .join("");
    const preloads = [...html.matchAll(/<link rel="preload" as="font"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(preloads).toHaveLength(3);
    // Same hashed file as the @font-face src, or the font downloads twice.
    for (const href of preloads) expect(css).toContain(href);
  });

  it("ships no React on the lobby", () => {
    const html = readFileSync(join(STATIC, "index.html"), "utf8");
    expect(html).not.toContain("<astro-island");
    expect(html).toContain("data-timer");
  });

  it("ships Motion flourishes only as one lazy chunk", () => {
    const chunks = readdirSync(join(STATIC, "_astro")).filter((file) => /^flourishes\.[\w-]+\.js$/.test(file));
    // Which pages use a flourish is content: with none on the site there is no chunk to check.
    expect(chunks.length).toBeLessThanOrEqual(1);
    expect(existsSync(join(STATIC, "_astro/preload-helper"))).toBe(false);
    if (!chunks.length) return;
    for (const page of ["index.html", "me/index.html", "404.html"]) {
      const html = readFileSync(join(STATIC, page), "utf8");
      // Inline loader, no external module scripts on static pages.
      expect(html, page).toContain(`"/_astro/${chunks[0]}"`);
      expect(html, page).not.toMatch(/<script type="module"[^>]*src=/);
      // The Logomark spring stays in the chunk.
      expect(html, page).not.toContain("linear(0, 0.06 6%");
    }
  });

  it("keeps island heroes inert behind the static cover", () => {
    // Every write-up that has an island hero today: the island stays out of the static cover.
    for (const page of writeupPages()) {
      const html = readFileSync(join(STATIC, page), "utf8");
      if (!/<template data-motion-hero[^>]*>/.test(html)) continue;
      const outside = html.replace(/<template data-motion-hero[^>]*>.*?<\/template>/gs, "");
      expect(outside, page).not.toContain("<astro-island");
      expect(outside, page).not.toContain("<iframe");
      expect(outside, page).toContain('class="cld');
    }
  });

  it("gives every page an absolute canonical and share image", () => {
    const html = readFileSync(join(STATIC, "me/index.html"), "utf8");
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/[^"]+\/me\/"/);
    expect(html).toMatch(/property="og:image" content="https:\/\/[^"]+\/banner\.jpg"/);
  });
});
