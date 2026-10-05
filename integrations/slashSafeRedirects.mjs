// @astrojs/vercel compiles `redirects` sources as exact matches
// (`^/other-work$`) and ignores trailingSlash: "ignore", so the slashed v2
// URLs that old links and search results still carry (`/other-work/`) fall
// through to the 404. This widens every redirect source to take an optional
// trailing slash once the adapter has written the Build Output config.
// The adapter's hooks run before ours (Astro unshifts the adapter).
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

/** `^/other-work$` → `^/other-work/?$`; anything else passes through. */
export function slashSafeRoute(route) {
  const isRedirect =
    route.status >= 300 && route.status < 400 && route.headers?.Location;
  if (
    !isRedirect ||
    typeof route.src !== "string" ||
    !route.src.endsWith("$") ||
    route.src.endsWith("/?$")
  ) {
    return route;
  }
  return { ...route, src: `${route.src.slice(0, -1)}/?$` };
}

export default function slashSafeRedirects() {
  let root;
  return {
    name: "slash-safe-redirects",
    hooks: {
      "astro:config:done": ({ config }) => {
        root = config.root;
      },
      "astro:build:done": async ({ logger }) => {
        const configUrl = new URL("./.vercel/output/config.json", root);
        if (!existsSync(configUrl)) return;
        const config = JSON.parse(await readFile(configUrl, "utf8"));
        config.routes = (config.routes ?? []).map(slashSafeRoute);
        await writeFile(configUrl, JSON.stringify(config, null, "\t"));
        logger.info("redirect sources accept a trailing slash");
      },
    },
  };
}
