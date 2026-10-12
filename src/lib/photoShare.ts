// Shareable /photography URLs: `?album=<slug>` or `?tag=<tag>` name what fills
// the gallery; neither means All. The page reads them on the server, and the
// island keeps them in step with the selection (history.replaceState), so
// the address bar is always the link the share button copies.

/** What fills the gallery: a tag ("" = All) or an album. */
export type GallerySource = { kind: "tag"; tag: string } | { kind: "album"; slug: string };

export const ALL: GallerySource = { kind: "tag", tag: "" };

/** A chip's label: `street art` → `Street Art`. */
export const tagLabel = (tag: string) =>
  tag
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/** The source a URL asks for, checked against what the page shows (shown
 *  albums' slugs, chip tags), so a hidden album or tag never resolves.
 *  `missing` names a param that matched nothing (deleted, renamed, hidden);
 *  the gallery then shows All, or the URL's tag when only the album missed.
 *  Both valid: the album wins. */
export function sourceFromParams(
  params: URLSearchParams,
  shown: { albums: readonly string[]; tags: readonly string[] },
): { source: GallerySource; missing: "album" | "tag" | null } {
  const album = params.get("album") || null;
  const tag = params.get("tag") || null;
  if (album !== null && shown.albums.includes(album)) return { source: { kind: "album", slug: album }, missing: null };
  const tagSource: GallerySource | null = tag !== null && shown.tags.includes(tag) ? { kind: "tag", tag } : null;
  return {
    source: tagSource ?? ALL,
    missing: album !== null ? "album" : tag !== null && !tagSource ? "tag" : null,
  };
}

/** `current` with its album/tag params set to `source`; anything else in the
 *  URL (other params, the hash) is kept. */
export function shareHref(source: GallerySource, current: URL): string {
  const url = new URL(current);
  url.searchParams.delete("album");
  url.searchParams.delete("tag");
  if (source.kind === "album") url.searchParams.set("album", source.slug);
  else if (source.tag) url.searchParams.set("tag", source.tag);
  return url.href;
}

export const PHOTOGRAPHY_TITLE = "Photography - Liam Sullivan";

/** The document title for a source: the album's or tag's name, else the page's. */
export function photographyTitle(source: GallerySource, albums: ReadonlyArray<{ slug: string; title: string }>): string {
  if (source.kind === "album") {
    const album = albums.find(({ slug }) => slug === source.slug);
    return album ? `${album.title} - Liam Sullivan` : PHOTOGRAPHY_TITLE;
  }
  return source.tag ? `${tagLabel(source.tag)} Photos - Liam Sullivan` : PHOTOGRAPHY_TITLE;
}
