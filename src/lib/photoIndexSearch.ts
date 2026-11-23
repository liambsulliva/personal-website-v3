// The photo index answering the searches Cloudinary Search answers for this
// site (lib/cloudinaryServer): all photos, one tag, or a list of ids. Same
// result shape, so nothing above it knows which backend it has.
import { indexedPhotos, versionedUrl, type IndexPhoto } from "./imageBackend";

type Body = { expression: string; max_results: number; next_cursor?: string; fields?: string[] };

const PREFIX = "resource_type:image";
const TAG = /^ AND tags=([A-Za-z0-9_.:-]+)$/;
const IDS = /^ AND \(public_id="[^"]*"(?: OR public_id="[^"]*")*\)$/;

/** What an expression matches, or null when it isn't one this site builds. */
function matcher(expression: string): ((photo: IndexPhoto) => boolean) | null {
  if (!expression.startsWith(PREFIX)) return null;
  const rest = expression.slice(PREFIX.length);
  if (!rest) return () => true;
  const tag = TAG.exec(rest)?.[1];
  if (tag) return (photo) => photo.tags.includes(tag);
  if (IDS.test(rest)) {
    const ids = new Set([...rest.matchAll(/public_id="([^"]*)"/g)].map((m) => m[1]));
    return (photo) => ids.has(photo.id);
  }
  return null;
}

export function searchIndex({ expression, max_results, next_cursor, fields }: Body) {
  const matches = matcher(expression);
  const start = next_cursor === undefined ? 0 : Number(next_cursor);
  if (!matches || !Number.isSafeInteger(start) || start < 0) return { ok: false, status: 400, data: { resources: [] } };
  const photos = indexedPhotos();
  if (!photos) return { ok: false, status: 503, data: { resources: [] } };

  const found = photos.filter(matches);
  const page = found.slice(start, start + max_results);
  const end = start + page.length;
  return {
    ok: true,
    status: 200,
    data: {
      resources: page.map(({ id, version, width, height }) => ({ public_id: id, secure_url: versionedUrl(id, version), width, height })),
      ...(fields?.includes("tags") ? { tags: page.map(({ tags }) => tags) } : {}),
      next_cursor: end < found.length ? String(end) : undefined,
    },
  };
}
