// An album's data URL, shared by the server (albums.ts, api/cloudinary/album)
// and the gallery island, so it imports nothing server-only.

/** A short hash of an album's photo list, in order (FNV-1a, 32-bit). A CMS
 *  publish that adds, removes or reorders photos changes it, so the album's
 *  data URL changes with it. No CDN purges on deploy (Cloudflare doesn't), so
 *  that is what keeps a day-long cache from serving the old album. */
export function albumVersion({ photos }: { photos: readonly string[] }): string {
  let hash = 0x811c9dc5;
  for (const char of photos.join("\n")) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** The island's request for one album's photos (api/cloudinary/album). */
export const albumDataUrl = ({ slug, version }: { slug: string; version: string }): string =>
  `/api/cloudinary/album?slug=${encodeURIComponent(slug)}&v=${version}`;
