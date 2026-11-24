// Photos and site images, from the photo index and the resizer on the NAS
// (docs/photo-pipeline-plan.md). URLs are same-origin /img ones (services/img);
// the transform strings are still Cloudinary's.
// Server only: the index is read from disk.
import { indexReader, isLive, tagsOf } from "../../services/lib/index.mjs";
import { photoIndexFile } from "./serverEnv";

const SITE = "https://liambsullivan.com";

type IndexedPhoto = {
  kind: "photo" | "site";
  path: string;
  version: string;
  width: number;
  height: number;
  createdAt: string;
};
export type PhotoIndex = { photos: Record<string, IndexedPhoto>; folders: Record<string, unknown> };
export type IndexPhoto = IndexedPhoto & { id: string; tags: string[] };

const encodeId = (id: string) => id.split("/").map(encodeURIComponent).join("/");

let reader: { file: string; read: () => PhotoIndex | null } | undefined;
/** The index, re-read when it's replaced; the same object until then. Null without one. */
export function readIndex(): PhotoIndex | null {
  const file = photoIndexFile();
  if (reader?.file !== file) reader = { file, read: indexReader(file) };
  return reader.read();
}

/** `compute(index)`, once per version of the index instead of per request. */
export function perIndex<T>(compute: (index: PhotoIndex) => T): () => T | null {
  let last: { index: PhotoIndex; value: T } | undefined;
  return () => {
    const index = readIndex();
    if (!index) return null;
    if (last?.index !== index) last = { index, value: compute(index) };
    return last.value;
  };
}

/** Every published photo, newest upload first; null without an index. */
export const indexedPhotos = perIndex((index): IndexPhoto[] =>
  Object.entries(index.photos)
    .filter(([, photo]) => photo.kind === "photo" && isLive(photo))
    .map(([id, photo]) => ({ ...photo, id, tags: tagsOf(photo) }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
);

/** The part of an image's URL before the transform. Every builder inserts its transform after "/upload/". */
export const IMAGE_BASE = "/img/upload";

/** The URL of an indexed photo at its current version, so it can be cached for good. */
export const versionedUrl = (id: string, version: string) => `${IMAGE_BASE}/v${version}/${encodeId(id)}.webp`;

/** An image's URL before any transform, with its version when there is one to know. */
export function deliveryUrl(id: string): string {
  const photo = readIndex()?.photos[id];
  return photo && isLive(photo) ? versionedUrl(id, photo.version) : `${IMAGE_BASE}/${encodeId(id)}`;
}

/** For link previews, which need a whole URL. */
export const absoluteUrl = (url: string) => (url.startsWith("/") ? SITE + url : url);
