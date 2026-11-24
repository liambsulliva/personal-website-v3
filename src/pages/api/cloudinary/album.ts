export const prerender = false;

import type { APIRoute } from "astro";
import { albumsByPath, albumVersion, toAlbumView } from "../../../lib/albums";
import { PUBLIC_CACHE_CONTROL, searchAlbumPhotos } from "../../../lib/cloudinaryServer";

// One album (`?slug=<path>`): its place and sub-albums, and its own photos in
// capture order. Both are the `albums` content collection, so the only input
// is a known path (no expression from the client). They only change with a
// deploy, but a deploy doesn't clear the CDN (Cloudflare keeps what it has),
// so the gallery asks for `?slug=<path>&v=<albumVersion>`: a publish that
// changes the album changes the URL. Only the current version is kept for a
// day; a missing or old `v` (a page from before the deploy) gets the routes'
// five minutes.

const JSON_HEADERS = { "Content-Type": "application/json" };
const ALBUM_CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";

export const GET: APIRoute = async ({ request }) => {
  const params = new URL(request.url).searchParams;
  const album = (await albumsByPath()).get(params.get("slug") ?? "");
  if (!album) {
    return new Response(JSON.stringify({ error: "Unknown album" }), { status: 404, headers: JSON_HEADERS });
  }

  const current = params.get("v") === albumVersion(album);
  try {
    const { ok, status, resources } = await searchAlbumPhotos(album.photos);
    return new Response(JSON.stringify({ album: toAlbumView(album), resources }), {
      status,
      headers: { ...JSON_HEADERS, "Cache-Control": !ok ? "no-store" : current ? ALBUM_CACHE_CONTROL : PUBLIC_CACHE_CONTROL },
    });
  } catch (error) {
    console.error("Cloudinary album request failed", error);
    return new Response(JSON.stringify({ error: "Failed to fetch from Cloudinary" }), { status: 500, headers: JSON_HEADERS });
  }
};
