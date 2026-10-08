// A disk-backed stand-in for `astro:content`, for the CMS contract tests.
//
// Astro's real content layer serves a data store that doesn't see files
// edited during a Vitest run, so the contract runner reads src/content on
// every call instead. Entries are validated by the real collection schemas
// from src/content.config.ts, ids follow the glob loader's (path without the
// extension), and YAML is parsed with js-yaml as Astro does — so a page sees
// exactly what it would after a rebuild. `render()` returns an empty Content:
// write-up bodies are checked separately (MDX compile + TOC).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import yaml from "js-yaml";
import { z } from "astro/zod";
import { createComponent, render as html } from "astro/runtime/server/index.js";

export const ROOT = join(import.meta.dirname, "../..");
export const CONTENT = join(ROOT, "src/content");

const EXTENSIONS: Record<string, RegExp> = {
  entries: /\.mdx?$/,
  sections: /\.ya?ml$/,
  career: /\.(ya?ml|md)$/,
  albums: /\.ya?ml$/,
};

type Entry = { id: string; collection: string; data: Record<string, unknown>; body?: string; filePath: string };
type CollectionConfig = { schema: z.ZodTypeAny };

let config: Record<string, CollectionConfig> | null = null;
async function collections() {
  config ??= (await import("../../src/content.config")).collections as unknown as Record<string, CollectionConfig>;
  return config;
}

const walk = (dir: string): string[] =>
  readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

function parse(text: string, path: string) {
  if (/\.mdx?$/.test(path)) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    return { data: (m ? yaml.load(m[1]!) : {}) as Record<string, unknown>, body: m ? m[2]! : text };
  }
  return { data: (yaml.load(text) ?? {}) as Record<string, unknown>, body: undefined };
}

export async function getCollection(name: string, filter?: (entry: Entry) => unknown) {
  const cfg = (await collections())[name];
  if (!cfg) throw new Error(`Unknown collection ${name}`);
  const dir = join(CONTENT, name);
  const entries = walk(dir)
    .filter((path) => EXTENSIONS[name]!.test(path) && !relative(dir, path).split("/").some((s) => s.startsWith(".")))
    .map((path) => {
      const id = relative(dir, path).replace(EXTENSIONS[name]!, "");
      const { data, body } = parse(readFileSync(path, "utf8"), path);
      const parsed = cfg.schema.safeParse(data);
      if (!parsed.success) throw new Error(`${name} → ${id} doesn't match the schema: ${parsed.error.message}`);
      return { id, collection: name, data: parsed.data as Record<string, unknown>, body, filePath: relative(ROOT, path) };
    });
  return filter ? entries.filter(filter) : entries;
}

export async function getEntry(name: string, id: string) {
  return (await getCollection(name)).find((entry) => entry.id === id);
}

const EmptyContent = createComponent(() => html`<div data-cms-content></div>`);

export async function render() {
  return { Content: EmptyContent, headings: [], remarkPluginFrontmatter: {} };
}

export const defineCollection = <T>(c: T) => c;
export { z };
