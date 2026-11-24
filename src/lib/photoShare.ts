// /photography addresses: `/photography/<album path>`, or `?tag=<tag>`, name
// what fills the gallery; neither means All. The page reads them on the
// server, and the island keeps them in step with the selection, so the address
// bar is always the link the share button copies.
import type { Crumb } from "./albumData";

/** What fills the gallery: a tag ("" = All) or an album. */
export type GallerySource = { kind: "tag"; tag: string } | { kind: "album"; path: string };

export const ALL: GallerySource = { kind: "tag", tag: "" };
export const PHOTOGRAPHY = "/photography";

/** A chip's label: `street art` → `Street Art`. */
export const tagLabel = (tag: string) =>
  tag
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export const albumHref = (path: string) => `${PHOTOGRAPHY}/${path}`;

const trimmed = (path: string) => path.replace(/^\/+|\/+$/g, "");

/** The source a URL asks for, checked against what the page shows, so a hidden
 *  album or tag never resolves. `path` is what follows /photography/;
 *  `current(link)` is the path an album link has today, or null.
 *  `redirect`: the album's current address, when the URL is an old one
 *  (`?album=<slug>`, or a link the album had before it moved).
 *  `missing` names what matched nothing (deleted, renamed, hidden); the gallery
 *  then shows All, or the URL's tag when only the album missed.
 *  Both valid: the album wins. */
export function sourceFromUrl(
  path: string,
  params: URLSearchParams,
  { current, tags }: { current: (link: string) => string | null; tags: readonly string[] },
): { source: GallerySource; missing: "album" | "tag" | null; redirect: string | null } {
  const link = trimmed(path);
  const asked = link || trimmed(params.get("album") ?? "");
  const tag = params.get("tag") || null;
  const found = asked ? current(asked) : null;
  if (found) {
    const rest = new URLSearchParams(params);
    rest.delete("album");
    if (!link) rest.delete("tag");
    const query = rest.size ? `?${rest}` : "";
    return { source: { kind: "album", path: found }, missing: null, redirect: link === found && !params.has("album") ? null : albumHref(found) + query };
  }
  const tagSource: GallerySource | null = tag !== null && tags.includes(tag) ? { kind: "tag", tag } : null;
  return {
    source: tagSource ?? ALL,
    missing: asked ? "album" : tag !== null && !tagSource ? "tag" : null,
    redirect: null,
  };
}

/** In the browser (Back, Forward, a breadcrumb): what one of this page's own URLs asks for. */
export function sourceFromHref(url: URL): GallerySource {
  const path = trimmed(url.pathname.slice(PHOTOGRAPHY.length));
  return path ? { kind: "album", path: decodeURIComponent(path) } : { kind: "tag", tag: url.searchParams.get("tag") ?? "" };
}

export const sameSource = (a: GallerySource, b: GallerySource) =>
  a.kind === "album" ? b.kind === "album" && a.path === b.path : b.kind === "tag" && a.tag === b.tag;

/** `current` with its path and tag set to `source`; anything else in the URL
 *  (other params, the hash) is kept. */
export function shareHref(source: GallerySource, current: URL): string {
  const url = new URL(current);
  url.pathname = source.kind === "album" ? albumHref(source.path) : PHOTOGRAPHY;
  url.searchParams.delete("album");
  url.searchParams.delete("tag");
  if (source.kind === "tag" && source.tag) url.searchParams.set("tag", source.tag);
  return url.href;
}

/** The header's trail: Photography, then each album down to the open one. */
export const photographyCrumbs = (crumbs: readonly Crumb[]) => [
  { label: "Photography", href: PHOTOGRAPHY },
  ...crumbs.map(({ path, title }) => ({ label: title, href: albumHref(path) })),
];

/** Where the back button goes: the parent album, or the full gallery. */
export const parentHref = (path: string) => (path.includes("/") ? albumHref(path.slice(0, path.lastIndexOf("/"))) : PHOTOGRAPHY);

export const PHOTOGRAPHY_TITLE = "Photography - Liam Sullivan";

/** The document title for a source: the album's or tag's name, else the page's. */
export function photographyTitle(source: GallerySource, albumTitle?: string): string {
  if (source.kind === "album") return albumTitle ? `${albumTitle} - Liam Sullivan` : PHOTOGRAPHY_TITLE;
  return source.tag ? `${tagLabel(source.tag)} Photos - Liam Sullivan` : PHOTOGRAPHY_TITLE;
}
