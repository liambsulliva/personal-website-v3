// Design direction, checked from source: eyebrows are small Geist in the
// section accent, written as authored (no forced caps, no wide tracking,
// never mono). Mono stays where it is deliberate: breadcrumbs and code.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

/** Declarations of one CSS rule (first match), e.g. `.callout__label`. */
const rule = (css: string, selector: string) => {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`${selector} not found`);
  return css.slice(start, css.indexOf("}", start));
};

describe("eyebrow styles", () => {
  const writeup = read("src/styles/writeup.css");

  for (const selector of [".section-heading__eyebrow", ".callout__label", ".editorial-node__step"]) {
    it(`${selector} is 12px bold Geist in the accent, as written`, () => {
      const body = rule(writeup, selector);
      expect(body).toContain("font-size: 12px");
      expect(body).toContain("font-weight: 700");
      expect(body).toContain("color: var(--wing)");
      expect(body).not.toMatch(/text-transform|letter-spacing|font-family/);
    });
  }

  it("SectionHeading no longer upper-cases its eyebrow", () => {
    expect(read("src/components/writeup/SectionHeading.astro")).not.toContain("toUpperCase");
  });

  it("subpages hand their section accent to in-page eyebrows", () => {
    const layout = read("src/layouts/SubpageLayout.astro");
    expect(layout).toMatch(/--wing:\$\{wing\}/);
  });
});

describe("eyebrow copy in write-ups", () => {
  const ALL_CAPS = /^[^a-z]*[A-Z]{3,}[^a-z]*$/;
  const labels = walk(join(ROOT, "src/content"))
    .filter((path) => /\.(mdx|ya?ml)$/.test(path))
    .flatMap((path) => {
      const text = readFileSync(path, "utf8");
      return [
        ...text.matchAll(/<SectionHeading\b[^>]*\beyebrow="([^"]+)"/g),
        ...text.matchAll(/<Callout\b[^>]*\blabel="([^"]+)"/g),
        ...text.matchAll(/\bstep:\s*"([^"]+)"/g),
      ].map(([, label]) => `${relative(ROOT, path)}: ${label}`);
    });

  it("finds the labels it is meant to check", () => {
    expect(labels.length).toBeGreaterThan(20);
  });

  it("writes eyebrows and callout labels in mixed case, not all caps", () => {
    expect(labels.filter((entry) => ALL_CAPS.test(entry.split(": ")[1]))).toEqual([]);
  });
});

describe("monospace stays deliberate", () => {
  it("keeps Martian Mono loaded and tokenized", () => {
    const global = read("src/styles/global.css");
    expect(global).toContain('@import "@fontsource-variable/martian-mono"');
    expect(global).toMatch(/--font-mono:\s*"Martian Mono Variable"/);
  });

  it("sets code blocks and inline code in mono", () => {
    const writeup = read("src/styles/writeup.css");
    expect(rule(writeup, ".writeup-article pre.astro-code")).toContain("var(--font-mono)");
    expect(writeup).toMatch(/\) code \{\s*font-family: var\(--font-mono\)/);
  });

  it("only uses mono for breadcrumbs, code and key/commit chips", () => {
    const users = walk(join(ROOT, "src"))
      // global.css defines the token; content is prose.
      .filter((path) => !path.includes("/content/") && !path.endsWith("global.css"))
      .filter((path) => /font-mono|--font-mono\)/.test(readFileSync(path, "utf8")))
      .map((path) => relative(ROOT, path))
      .sort();
    expect(users).toEqual([
      "src/components/chrome/Breadcrumb.astro",
      "src/components/islands/BezierPlayground/BezierPlayground.module.css",
      "src/components/writeup/SwitchHud.astro",
      "src/styles/writeup.css",
    ]);
  });
});
