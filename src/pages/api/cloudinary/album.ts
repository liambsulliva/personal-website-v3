export const prerender = false;

import type { APIRoute } from "astro";
import { albumVersion } from "../../../lib/albumData";
import { listAlbums } from "../../../lib/albums";
import { PUBLIC_CACHE_CONTROL, searchAlbumPhotos } from "../../../lib/cloudinaryServer";
import { imageBackend } from "../../../lib/serverEnv";

// One album's photos, in capture order. Membership is the `albums` content
// collection, so the only input is a known slug (no expression from
// the client). Membership only changes with a deploy, but a deploy doesn't
// clear the CDN (Cloudflare keeps what it has), so the gallery asks for
// `?slug=<slug>&v=<albumVersion>`: a publish that changes the photo list
// changes the URL. Only the current version is kept for a day (about one
// Cloudinary Search call per album per publish and region); a missing or old
// `v` (a page from before the deploy) gets the routes' five minutes. So does
// every answer from the photo index: a re-exported photo keeps its id but not
// its URL, and asking the index again costs nothing.

const JSON_HEADERS = { "Content-Type": "application/json" };
const ALBUM_CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";

export const GET: APIRoute = async ({ request }) => {
  const slug = new URL(request.url).searchParams.get("slug");
  const album = (await listAlbums()).find((candidate) => candidate.slug === slug);
  if (!album) {
    return new Response(JSON.stringify({ error: "Unknown album" }), { status: 404, headers: JSON_HEADERS });
  }

  const current = new URL(request.url).searchParams.get("v") === albumVersion(album);
  try {
    const { ok, status, resources } = await searchAlbumPhotos(album.photos);
    return new Response(JSON.stringify({ resources }), {
      status,
      headers: { ...JSON_HEADERS, "Cache-Control": !ok ? "no-store" : current && imageBackend() === "cloudinary" ? ALBUM_CACHE_CONTROL : PUBLIC_CACHE_CONTROL },
    });
  } catch (error) {
    console.error("Cloudinary album request failed", error);
    return new Response(JSON.stringify({ error: "Failed to fetch from Cloudinary" }), { status: 500, headers: JSON_HEADERS });
  }
};
