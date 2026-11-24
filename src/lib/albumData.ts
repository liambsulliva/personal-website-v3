// The shapes the server and the gallery island share, so it imports nothing
// server-only.

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
};

export type Crumb = { path: string; title: string };

/** An open album: its way down from the top, and its sub-albums. */
export type AlbumView = { path: string; title: string; crumbs: Crumb[]; tiles: AlbumCard[] };

/** The island's request for one album (api/cloudinary/album). */
export const albumDataUrl = (path: string): string => `/api/cloudinary/album?slug=${encodeURIComponent(path)}`;

/** The top-level album a link is in. */
export const topOf = (path: string): string => path.split("/", 1)[0];
