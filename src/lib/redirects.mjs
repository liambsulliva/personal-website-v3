// Legacy v2 URLs that old links and search results still carry, each sent to
// its v3 page with a 301. One list: astro.config.mjs turns it into Astro
// `redirects` (what the Vercel build and `astro dev` use), and server.mjs
// answers it itself on the Node build, before Astro sees the request.

/** Old path (no trailing slash) → new path. */
export const LEGACY_REDIRECTS = {
  "/other-work": "/design",
  "/projects/kingdra-app": "/engineering/kingdra-app",
  "/projects/herl-app": "/engineering/herl-app",
  "/projects/switch-react-menu": "/engineering/switch-react-menu",
  "/projects/the-invisible-hand-of-ux": "/engineering/the-invisible-hand-of-ux",
  "/ux/kingdra-case-study": "/design/kingdra-case-study",
};

/** Astro's `redirects` config for the list. */
export const astroRedirects = () =>
  Object.fromEntries(
    Object.entries(LEGACY_REDIRECTS).map(([from, to]) => [from, { status: 301, destination: to }]),
  );

/**
 * Location for a legacy URL, or null. The path matches with or without one
 * trailing slash, case-sensitively, and the query string carries over, the
 * way Vercel answers today (`/other-work/?x=1` → `/design?x=1`).
 * @param {string} url request target, e.g. `/other-work/?x=1`
 */
export function legacyRedirect(url) {
  const at = url.search(/[?#]/);
  const path = at === -1 ? url : url.slice(0, at);
  const query = at === -1 || url[at] === "#" ? "" : url.slice(at).replace(/#.*$/, "");
  const key = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const to = Object.hasOwn(LEGACY_REDIRECTS, key) ? LEGACY_REDIRECTS[key] : undefined;
  return to ? to + query : null;
}
