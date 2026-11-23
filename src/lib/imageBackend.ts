// Where photos and site images come from (docs/photo-pipeline-plan.md):
//
//   cloudinary  (default) res.cloudinary.com URLs, Cloudinary Search
//   nas         same-origin /img URLs (services/img), the photo index
//
// Prerendered pages take it from the build's environment and SSR routes from
// the server's, so switching both takes a rebuild with the same value set.
// Server only: the index is read from disk.
import { indexReader, isLive, tagsOf } from "../../services/lib/index.mjs";
import { cloudName, imageBackend, photoIndexFile } from "./serverEnv";

const SITE = "https://liambsullivan.com";

type IndexedPhoto = {
  kind: "photo" | "site";
  version: string;
  width: number;
  height: number;
  createdAt: string;
};
export type IndexPhoto = IndexedPhoto & { id: string; tags: string[] };

const encodeId = (id: string) => id.split("/").map(encodeURIComponent).join("/");

let reader: { file: string; read: () => { photos: Record<string, IndexedPhoto> } | null } | undefined;
function readIndex() {
  const file = photoIndexFile();
  if (reader?.file !== file) reader = { file, read: indexReader(file) };
  return reader.read();
}

// Sorting and tag merging once per version of the index, not per request.
let listed: { index: object; photos: IndexPhoto[] } | undefined;

/** Every published photo, newest upload first, as Cloudinary Search sorted them; null without an index. */
export function indexedPhotos(): IndexPhoto[] | null {
  const index = readIndex();
  if (!index) return null;
  if (listed?.index !== index) {
    const photos = Object.entries(index.photos)
      .filter(([, photo]) => photo.kind === "photo" && isLive(photo))
      .map(([id, photo]) => ({ ...photo, id, tags: tagsOf(photo) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    listed = { index, photos };
  }
  return listed.photos;
}

/** The part of a delivery URL before the transform. Every builder inserts its transform after "/upload/". */
export const imageBase = (cloud = cloudName()) => (imageBackend() === "nas" ? "/img/upload" : `https://res.cloudinary.com/${cloud}/image/upload`);

/** The URL of an indexed photo at its current version, so it can be cached for good. */
export const versionedUrl = (id: string, version: string) => `/img/upload/v${version}/${encodeId(id)}.webp`;

/** An image's delivery URL before any transform, with its version when there is one to know. */
export function deliveryUrl(id: string, cloud?: string): string {
  if (imageBackend() !== "nas") return `${imageBase(cloud)}/${id}`;
  const photo = readIndex()?.photos[id];
  return photo && isLive(photo) ? versionedUrl(id, photo.version) : `${imageBase()}/${encodeId(id)}`;
}

/** For link previews, which need a whole URL. */
export const absoluteUrl = (url: string) => (url.startsWith("/") ? SITE + url : url);
