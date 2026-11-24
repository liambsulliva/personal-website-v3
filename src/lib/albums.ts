// Photography albums, worked out from the folders in Published (the photo
// index; docs/folder-albums-plan.md). Server only.
import { ancestry, buildAlbums, resolveLink } from "../../services/lib/albums.mjs";
import { cloudinaryTransform } from "./cloudinaryImage";
import { absoluteUrl, deliveryUrl, perIndex } from "./photoIndex";
import type { AlbumCard, AlbumView, StackPhoto } from "./albumData";

export type Album = {
  folder: string;
  title: string;
  /** The full link: "2026-otakon-2026/day-1". */
  path: string;
  /** `YYYY-MM-DD`, or null when nothing in the album is dated (label shows the year). */
  date: string | null;
  year: number;
  /** Photos in it and everything beneath it. */
  count: number;
  /** Its own photos' ids, in order. */
  photos: string[];
  /** Up to three ids, from its first sub-album when it has no photos. */
  cover: string[];
  /** Shown sub-albums, in order. */
  subs: Album[];
};

const albums = perIndex(buildAlbums);

/** The top-level albums that are shown, newest first. */
export const listAlbums = (): Album[] => albums()?.top ?? [];

/** The shown album a link means today, old links included. */
export function findAlbum(link: string): Album | null {
  const all = albums();
  return all ? resolveLink(all, link) : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Stack label: `May 2026 · 24 photos`, or `2024 · 12 photos` when undated. */
export function albumDetails({ date, year, count }: Pick<Album, "date" | "year" | "count">): string {
  const when = date ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : String(year);
  return `${when} · ${count} ${count === 1 ? "photo" : "photos"}`;
}

const STACK_CARD_TRANSFORM = "c_fill,w_352,h_440,f_auto,q_auto";

export const toStackPhoto = (publicId: string): StackPhoto => ({
  key: publicId,
  src: cloudinaryTransform(deliveryUrl(publicId), STACK_CARD_TRANSFORM),
});

export const toAlbumCard = (album: Album): AlbumCard => ({
  path: album.path,
  title: album.title,
  details: albumDetails(album),
  previews: album.cover.map((id) => toStackPhoto(id)),
});

/** What the gallery needs to show an album, besides its photos. */
export const toAlbumView = (album: Album): AlbumView => ({
  path: album.path,
  title: album.title,
  crumbs: ancestry(albums()!, album).map(({ path, title }: Album) => ({ path, title })),
  tiles: album.subs.map(toAlbumCard),
});

/** A shared album link's preview image: the cover, cropped to the 1200×630
 *  Open Graph card. JPEG, since link scrapers don't all take WebP/AVIF. */
export const toOgImage = (publicId: string): string =>
  absoluteUrl(cloudinaryTransform(deliveryUrl(publicId), "c_fill,g_auto,w_1200,h_630,f_jpg,q_auto"));
