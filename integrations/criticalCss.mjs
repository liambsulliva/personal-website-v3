// Inlines each prerendered page's critical CSS and defers the full
// stylesheet (Lighthouse: render-blocking requests). Beasties keeps the rules
// whose selectors match the page's static HTML, so state the RootLayout and
// lobby head scripts set on <html> before first paint (theme, motion, the
// typer's hidden hero) never matches and would land in the deferred sheet:
// a light flash for dark visitors, the hero flashing in before it types.
// Those rules are always kept. SSR pages (/photography, /writing) are never
// on disk at build time and keep their blocking stylesheets.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Beasties from "beasties";

/** Pre-paint state: html.dark/.js/.typing, [data-theme], [data-reduced-motion],
 *  plus what scripts set on load, before the sheet can arrive: the typer's
 *  [data-shown] and the writeup TOC's [aria-current]. */
export const PRE_PAINT_STATE =
  /\.(dark|js|typing)\b|\[(data-theme|data-reduced-motion|data-shown|aria-current)\b/;

async function* htmlFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

export default function criticalCss() {
  return {
    name: "critical-css",
    hooks: {
      "astro:build:done": async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const beasties = new Beasties({
          path: root,
          preload: "media",
          // Astro's inlined component <style>s hold JS-only states too;
          // pruning them would drop those rules outright, not defer them.
          reduceInlineStyles: false,
          // font-family comes through var(--font-sans), which Beasties
          // can't resolve; RootLayout preloads and declares the faces instead.
          fonts: false,
          allowRules: [PRE_PAINT_STATE],
          logLevel: "warn",
        });
        let pages = 0;
        for await (const file of htmlFiles(root)) {
          const html = await readFile(file, "utf8");
          // Only Astro pages; public/ apps (switch-menu) bring their own CSS.
          if (!html.includes('href="/_astro/')) continue;
          await writeFile(file, await beasties.process(html));
          pages++;
        }
        logger.info(`inlined critical CSS in ${pages} pages`);
      },
    },
  };
}
