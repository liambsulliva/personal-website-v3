// Content that only fails at runtime (a skeleton where a photo should be, a
// dead PDF link, a TOC link that scrolls nowhere) checked straight from the
// source files. No network: Cloudinary ids are checked against the manifest
// that `npm run cloudinary:seed` writes after uploading.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "../../src/data/cloudinary-manifest.json";

const ROOT = join(import.meta.dirname, "../..");
const SRC = join(ROOT, "src");
const PUBLIC = join(ROOT, "public");

// Reserved slots in scripts/cloudinary-map.mjs that still need an upload.
// The page shows the skeleton until then; remove an id once it's seeded.
const PENDING_UPLOADS = new Set<string>([]);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const sources = walk(SRC).filter((path) =>
  /\.(astro|tsx?|mdx|ya?ml)$/.test(path),
);
const read = (path: string) => readFileSync(path, "utf8");

describe("Cloudinary site imagery", () => {
  const referenced = new Map<string, string>();
  for (const path of sources) {
    // Quoted in code and MDX props, bare in YAML/frontmatter values.
    for (const [, id] of read(path).matchAll(
      /(?:["'`]|:\s+)(site\/[A-Za-z0-9_./-]+)/g,
    )) {
      // Template prefixes like `site/projects/${slug}` end in a slash.
      if (!id.endsWith("/")) referenced.set(id, relative(ROOT, path));
    }
  }

  it("finds the ids it is meant to check", () => {
    expect(referenced.size).toBeGreaterThan(40);
  });

  it("every referenced public_id has been seeded", () => {
    const missing = [...referenced]
      .filter(([id]) => !(id in manifest) && !PENDING_UPLOADS.has(id))
      .map(([id, file]) => `${id} (${file})`);
    expect(missing).toEqual([]);
  });

  it("the pending-upload list only holds ids that are still missing", () => {
    expect([...PENDING_UPLOADS].filter((id) => id in manifest)).toEqual([]);
  });
});

describe("local links in content", () => {
  const content = walk(join(SRC, "content"));
  const writeups = new Set(
    walk(join(SRC, "content/entries"))
      .filter((path) => read(path).split(/^---$/m)[2]?.trim())
      .map((path) => {
        const wing = read(path).match(/^wing:\s*(\w+)/m)?.[1];
        return `/${wing}/${path
          .split("/")
          .pop()!
          .replace(/\.mdx?$/, "")}`;
      }),
  );
  const routes = new Set([
    "/",
    "/me",
    "/career",
    "/engineering",
    "/design",
    "/photography",
    "/writing",
    ...writeups,
  ]);

  const links: { href: string; file: string }[] = [];
  for (const path of content) {
    const text = read(path);
    const patterns = [
      /^href:\s*["']?(\/[^"'\s#]*)/gm,
      /(?:href|src)=["'](\/[^"'#]*)/g,
      /\]\((\/[^)#\s]*)/g,
    ];
    for (const pattern of patterns) {
      for (const [, href] of text.matchAll(pattern))
        links.push({ href, file: relative(ROOT, path) });
    }
  }

  it("finds the PDFs and pages it is meant to check", () => {
    expect(links.some((link) => link.href.endsWith(".pdf"))).toBe(true);
  });

  it("every same-site href is a public file or a page", () => {
    const broken = links.filter(({ href }) => {
      const path = decodeURIComponent(href).replace(/\/$/, "") || "/";
      return !routes.has(path) && !existsSync(join(PUBLIC, path));
    });
    expect(broken).toEqual([]);
  });
});

describe("sections", () => {
  const sections = Object.fromEntries(
    walk(join(SRC, "content/sections")).map((path) => {
      const wing = path.split("/").pop()!.replace(/\.ya?ml$/, "");
      const keys = [...read(path).matchAll(/^\s+- key:\s*(\S+)/gm)].map(([, key]) => key);
      return [wing, keys];
    }),
  );

  it("every wing has a sections file", () => {
    expect(Object.keys(sections).sort()).toEqual(["design", "engineering", "writing"]);
  });

  it("every entry sits in a section of its own wing", () => {
    const stray = walk(join(SRC, "content/entries"))
      .map((path) => {
        const text = read(path);
        const wing = text.match(/^wing:\s*(\w+)/m)?.[1] ?? "";
        const section = text.match(/^section:\s*["']?([\w-]+)/m)?.[1] ?? "";
        return { file: relative(ROOT, path), wing, section };
      })
      .filter(({ wing, section }) => !sections[wing]?.includes(section));
    expect(stray).toEqual([]);
  });
});

describe("write-up TOC anchors", () => {
  for (const path of walk(join(SRC, "content/entries")).filter((p) =>
    p.endsWith(".mdx"),
  )) {
    const ids = [
      ...read(path).matchAll(/<SectionHeading\b[^>]*\bid="([^"]+)"/g),
    ].map(([, id]) => id);
    if (ids.length === 0) continue;
    it(`${relative(ROOT, path)} has unique heading ids`, () => {
      expect(ids.length).toBe(new Set(ids).size);
    });
  }
});
