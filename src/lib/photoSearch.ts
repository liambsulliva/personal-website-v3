// The photo lists /photography and its JSON routes show, answered from the
// photo index in memory (lib/photoIndex).
import { indexedPhotos, versionedUrl, type IndexPhoto } from "./photoIndex";
import type { PhotoResource } from "./photos";

/** Nothing here is kept by Cloudflare, and a browser asks again: a photo shows as soon as the index has it. */
export const FRESH = "private, no-cache";

export type PhotoList = { ok: boolean; status: number; resources: PhotoResource[]; tags: string[] };

const toResource = ({ id, version, width, height }: IndexPhoto): PhotoResource => ({ public_id: id, secure_url: versionedUrl(id, version), width, height });

const list = (photos: IndexPhoto[] | null | undefined): PhotoList =>
  photos
    ? { ok: true, status: 200, resources: photos.map(toResource), tags: publicTags(photos.flatMap(({ tags }) => tags)) }
    : { ok: false, status: 503, resources: [], tags: [] };

/** Every published photo, or the ones with `tag`, newest upload first. */
export const listPhotos = (tag?: string | null): PhotoList => list(indexedPhotos()?.filter(({ tags }) => !tag || tags.includes(tag)));

/** These photos, in this order; ones that aren't published are left out. */
export function photosById(ids: readonly string[]): PhotoList {
  const photos = indexedPhotos();
  if (!photos) return list(null);
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  return list(ids.flatMap((id) => byId.get(id) ?? []));
}

/** Tags for the chip row: the ones on published photos, so a chip never filters to an empty grid. */
export const listPhotoTags = (): string[] => listPhotos().tags;

/** Chip-row tags: `featured` is editorial and `_`-prefixed tags are internal. */
export const publicTags = (tags: Iterable<string>) =>
  [...new Set(tags)].filter((tag) => tag !== "featured" && !tag.startsWith("_")).sort();

const EXPRESSION = /^resource_type:image(?: AND tags=([A-Za-z0-9_.:-]+))?$/;

/** One page, for /api/cloudinary/search: `expression` is all photos or one tag's. */
export function searchPhotos({ expression, max_results, next_cursor }: { expression: string; max_results: number; next_cursor?: string }) {
  const match = EXPRESSION.exec(expression);
  const start = next_cursor === undefined ? 0 : Number(next_cursor);
  if (!match || !Number.isSafeInteger(start) || start < 0) return { ok: false, status: 400, data: { resources: [] as PhotoResource[] } };
  const { ok, status, resources } = listPhotos(match[1]);
  const end = start + max_results;
  return { ok, status, data: { resources: resources.slice(start, end), ...(end < resources.length ? { next_cursor: String(end) } : {}) } };
}
