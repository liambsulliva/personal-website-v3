// Deploy checks against the Vercel Build Output that `astro build` writes.
// Run `npm run test:build` (builds first); plain `npm test` skips these when
// there is no build to read.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SWITCH_MENU_PROJECT_URL } from "../../src/lib/switchMenuEmbed";

const OUTPUT = join(import.meta.dirname, "../../.vercel/output");
const CONFIG = join(OUTPUT, "config.json");
const built = existsSync(CONFIG);

type Route = { src?: string; dest?: string; status?: number; headers?: Record<string, string>; handle?: string };

const entryFile = (id: string) => join(import.meta.dirname, "../../src/content/entries", `${id}.mdx`);

/** Frontmatter of an entry file, split the same way Astro splits `---`. */
const entryParts = (file: string) => {
  const [, frontmatter = "", body = ""] = readFileSync(file, "utf8").split(/^---\s*$/m);
  return { frontmatter, body };
};

/** `hidden: true` stays in the repo and has no card, write-up, or sitemap URL. */
const isHidden = (frontmatter: string) => /^hidden:\s*true\s*$/m.test(frontmatter);

/** Every published write-up as its static page, e.g. "engineering/<id>/index.html". */
const writeupPages = () => {
  const dir = join(import.meta.dirname, "../../src/content/entries");
  return readdirSync(dir)
    .filter((file) => /\.mdx?$/.test(file))
    .map((file) => {
      const { frontmatter, body } = entryParts(join(dir, file));
      return {
        id: file.replace(/\.mdx?$/, ""),
        wing: frontmatter.match(/^wing:\s*(\S+)/m)?.[1],
        hidden: isHidden(frontmatter),
        body,
      };
    })
    .filter((entry) => entry.wing && !entry.hidden && entry.body.trim())
    .map((entry) => `${entry.wing}/${entry.id}/index.html`);
};
const FIRST_WRITEUP = writeupPages()[0] ?? "index.html";

describe.skipIf(!built)("Vercel build output", () => {
  const routes: Route[] = built ? JSON.parse(readFileSync(CONFIG, "utf8")).routes : [];
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
      // A target is a write-up page, or a published entry whose card links out.
      // A hidden entry has neither, so its file does not count.
      const id = target.split("/")[2];
      const page = existsSync(join(OUTPUT, "static", target, "index.html"));
      const file = id ? entryFile(id) : "";
      const card = Boolean(file && existsSync(file) && !isHidden(entryParts(file).frontmatter));
      expect(page || card, target).toBe(true);
    });
  }

  it("does not route a dashboard", () => {
    for (const path of ["/dashboard", "/dashboard/"]) {
      expect(resolve(path)?.status).toBe(404);
      expect(existsSync(join(OUTPUT, "static/dashboard"))).toBe(false);
    }
  });

  it("serves the SSR wings and APIs from the function", () => {
    for (const path of ["/photography", "/writing/", "/api/cloudinary/search", "/api/rawg/games"]) {
      expect(resolve(path)?.dest, path).toBe("_render");
    }
  });

  it("prerenders every static page", () => {
    for (const page of [
      "index.html",
      "404.html",
      "me/index.html",
      "career/index.html",
      "engineering/index.html",
      "design/index.html",
    ]) {
      expect(existsSync(join(OUTPUT, "static", page)), page).toBe(true);
    }
  });

  it("prerenders a page for every write-up in the content", () => {
    // Derived from the content, so editing or adding write-ups never changes this test.
    const pages = writeupPages();
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect(existsSync(join(OUTPUT, "static", page)), page).toBe(true);
  });

  it("ships robots.txt pointing at the sitemap and no switch-menu source maps", () => {
    const robots = readFileSync(join(OUTPUT, "static/robots.txt"), "utf8");
    expect(robots).toMatch(/Sitemap: https:\/\/[^\s]+\/sitemap\.xml/);
    expect(robots).toMatch(/Disallow: \/api\//);
    const assets = join(OUTPUT, "static/switch-menu/assets");
    expect(readdirSync(assets).filter((file) => file.endsWith(".map"))).toEqual([]);
    expect(readFileSync(join(OUTPUT, "static/switch-menu/index.html"), "utf8")).toContain(SWITCH_MENU_PROJECT_URL);
  });

  it("inlines critical CSS and defers the stylesheets on prerendered pages", () => {
    for (const page of ["index.html", "me/index.html", FIRST_WRITEUP]) {
      const html = readFileSync(join(OUTPUT, "static", page), "utf8");
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
    const html = readFileSync(join(OUTPUT, "static/index.html"), "utf8");
    const css = readdirSync(join(OUTPUT, "static/_astro"))
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFileSync(join(OUTPUT, "static/_astro", file), "utf8"))
      .join("");
    const preloads = [...html.matchAll(/<link rel="preload" as="font"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(preloads).toHaveLength(3);
    // Same hashed file as the @font-face src, or the font downloads twice.
    for (const href of preloads) expect(css).toContain(href);
  });

  it("caches hashed assets immutably from vercel.json", () => {
    // The adapter's own /_astro header route sits after `handle: filesystem`,
    // so Vercel never applies it to the static files it matches.
    const vercel = JSON.parse(readFileSync(join(import.meta.dirname, "../../vercel.json"), "utf8"));
    const astro = vercel.headers.find((rule: { source: string }) => rule.source === "/_astro/(.*)");
    expect(astro?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  });

  it("ships no React on the lobby", () => {
    const html = readFileSync(join(OUTPUT, "static/index.html"), "utf8");
    expect(html).not.toContain("<astro-island");
    expect(html).toContain("data-timer");
  });

  it("ships Motion flourishes only as one lazy chunk", () => {
    const chunks = readdirSync(join(OUTPUT, "static/_astro")).filter((file) => /^flourishes\.[\w-]+\.js$/.test(file));
    // Which pages use a flourish is content: with none on the site there is no chunk to check.
    expect(chunks.length).toBeLessThanOrEqual(1);
    expect(existsSync(join(OUTPUT, "static/_astro/preload-helper"))).toBe(false);
    if (!chunks.length) return;
    for (const page of ["index.html", "me/index.html", "404.html"]) {
      const html = readFileSync(join(OUTPUT, "static", page), "utf8");
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
      const html = readFileSync(join(OUTPUT, "static", page), "utf8");
      if (!/<template data-motion-hero[^>]*>/.test(html)) continue;
      const outside = html.replace(/<template data-motion-hero[^>]*>.*?<\/template>/gs, "");
      expect(outside, page).not.toContain("<astro-island");
      expect(outside, page).not.toContain("<iframe");
      expect(outside, page).toContain('class="cld');
    }
  });

  it("gives every page an absolute canonical and share image", () => {
    const html = readFileSync(join(OUTPUT, "static/me/index.html"), "utf8");
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/[^"]+\/me\/"/);
    expect(html).toMatch(/property="og:image" content="https:\/\/[^"]+\/banner\.jpg"/);
  });
});
