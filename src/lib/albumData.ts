// The shapes the server (albums.ts, api/cloudinary/album) and the gallery
// island share, so it imports nothing server-only.

/** One stack card's photo: a single crop at 2× the 176×220 card. The
 *  carousel can hold every album, so a card costs one ~20KB image and a URL,
 *  not a srcset. Center crop, the same framing as the explode flyer's
 *  object-fit: cover, so the photo doesn't jump as the card leaves. */
export type StackPhoto = { key: string; src: string };

/** A stack in the carousel, or a sub-album's tile: label text and the stack's
 *  card photos. `previews[0]` is the top card. */
export type AlbumCard = {
  /** Its link under /photography: "2026-otakon-2026/day-1". */
  path: string;
  title: string;
  details: string;
  previews: StackPhoto[];
  /** Names what the album's data URL returns (hashOf). */
  version: string;
};

export type Crumb = { path: string; title: string };

/** An open album: its way down from the top, and its sub-albums. */
export type AlbumView = { path: string; title: string; crumbs: Crumb[]; tiles: AlbumCard[] };

/** A short hash (FNV-1a, 32-bit). An album's version hashes its view and its
 *  photo list, so a CMS publish that changes either changes its data URL. No
 *  CDN purges on deploy (Cloudflare doesn't), so that is what keeps a day-long
 *  cache from serving the old album. */
export function hashOf(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The island's request for one album (api/cloudinary/album). Without a
 *  version (an album no card on the page named) it's cached for minutes, not a day. */
export const albumDataUrl = (path: string, version?: string): string =>
  `/api/cloudinary/album?slug=${encodeURIComponent(path)}${version ? `&v=${version}` : ""}`;

/** The top-level album a link is in. */
export const topOf = (path: string): string => path.split("/", 1)[0];
