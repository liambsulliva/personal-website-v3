// What the build tests read: which target was built, where its static files
// are, and the published write-ups (derived from the content, so editing or
// adding entries never changes a test).
//
//   DEPLOY_TARGET=node   dist/client + the server in dist/server (server.mjs)
//   (unset) / vercel     .vercel/output/static + .vercel/output/config.json
//
// SITE_DIST=<dir> points the Node checks at another build's dist/, and
// SITE_ENTRY=<file> starts that file instead of server.mjs. Both exist to
// show a regression test failing against a build without its fix.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = join(import.meta.dirname, "../..");
export const TARGET = process.env.DEPLOY_TARGET === "node" ? "node" : "vercel";

export const DIST = resolve(ROOT, process.env.SITE_DIST ?? "dist");
export const VERCEL_OUTPUT = join(ROOT, ".vercel/output");
export const ENTRY = resolve(ROOT, process.env.SITE_ENTRY ?? "server.mjs");

/** The prerendered files for the target that was built. */
export const STATIC = TARGET === "node" ? join(DIST, "client") : join(VERCEL_OUTPUT, "static");
export const BUILT =
  TARGET === "node" ? existsSync(join(DIST, "server/entry.mjs")) : existsSync(join(VERCEL_OUTPUT, "config.json"));

const ENTRIES = join(ROOT, "src/content/entries");
export const entryFile = (id: string) => join(ENTRIES, `${id}.mdx`);

/** Frontmatter of an entry file, split the same way Astro splits `---`. */
export const entryParts = (file: string) => {
  const [, frontmatter = "", body = ""] = readFileSync(file, "utf8").split(/^---\s*$/m);
  return { frontmatter, body };
};

/** `hidden: true` stays in the repo and has no card, write-up, or sitemap URL. */
export const isHidden = (frontmatter: string) => /^hidden:\s*true\s*$/m.test(frontmatter);

/** Every published write-up as its static page, e.g. "engineering/<id>/index.html". */
export const writeupPages = () =>
  readdirSync(ENTRIES)
    .filter((file) => /\.mdx?$/.test(file))
    .map((file) => {
      const { frontmatter, body } = entryParts(join(ENTRIES, file));
      return {
        id: file.replace(/\.mdx?$/, ""),
        wing: frontmatter.match(/^wing:\s*(\S+)/m)?.[1],
        hidden: isHidden(frontmatter),
        body,
      };
    })
    .filter((entry) => entry.wing && !entry.hidden && entry.body.trim())
    .map((entry) => `${entry.wing}/${entry.id}/index.html`);

/**
 * A redirect target is real when it is a write-up page, or a published entry
 * whose card links out (a hidden entry has neither, so its file does not count).
 */
export const redirectTargetExists = (target: string) => {
  const id = target.split("/")[2];
  const page = existsSync(join(STATIC, target, "index.html"));
  const file = id ? entryFile(id) : "";
  const card = Boolean(file && existsSync(file) && !isHidden(entryParts(file).frontmatter));
  return page || card;
};
