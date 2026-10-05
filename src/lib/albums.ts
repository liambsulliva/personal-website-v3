// Photography albums: one per shoot folder on the photo drive. Membership is
// the hidden Cloudinary tag `_album-<slug>`; titles, dates and the three
// preview photos are generated into src/data/albums.ts by
// `npm run photos:albums -- apply`.
import { cloudinaryTransform } from "./cloudinaryImage";
import type { PhotoResource } from "./photos";

export type Album = {
  slug: string;
  title: string;
  /** `YYYY-MM-DD`, or null when nothing in the album is dated (label shows the year). */
  date: string | null;
  year: number;
  count: number;
  preview: PhotoResource[];
};

export const ALBUM_TAG_PREFIX = "_album-";
export const albumTag = (slug: string) => `${ALBUM_TAG_PREFIX}${slug}`;
export const albumExpression = (slug: string) => `resource_type:image AND tags=${slug}`; // DEV FIXTURE: revert to albumTag(slug)

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Stack label: `May 2026 · 24 photos`, or `2024 · 12 photos` when undated. */
export function albumDetails({ date, year, count }: Pick<Album, "date" | "year" | "count">): string {
  const when = date ? `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` : String(year);
  return `${when} · ${count} ${count === 1 ? "photo" : "photos"}`;
}

/** One stack card's photo: a single crop at 2× the 176×220 card. The
 *  carousel can hold every album, so a card costs one ~20KB image and a URL,
 *  not a srcset. Center crop, the same framing as the explode flyer's
 *  object-fit: cover, so the photo doesn't jump as the card leaves. */
export type StackPhoto = { key: string; src: string };

const STACK_CARD_TRANSFORM = "c_fill,w_352,h_440,f_auto,q_auto";

export const toStackPhoto = (resource: PhotoResource): StackPhoto => ({
  key: resource.public_id,
  src: cloudinaryTransform(resource.secure_url, STACK_CARD_TRANSFORM),
});

/** What the album carousel island receives: label text and the stack's card
 *  photos, computed on the server. `previews[0]` is the top card. */
export type AlbumCard = {
  slug: string;
  title: string;
  details: string;
  previews: StackPhoto[];
};

export const toAlbumCard = (album: Album): AlbumCard => ({
  slug: album.slug,
  title: album.title,
  details: albumDetails(album),
  previews: album.preview.map(toStackPhoto),
});
