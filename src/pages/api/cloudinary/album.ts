export const prerender = false;

import type { APIRoute } from "astro";
import { findAlbum, toAlbumView } from "../../../lib/albums";
import { FRESH, photosById } from "../../../lib/photoSearch";

// One album (`?slug=<path>`, an old link included): its place and sub-albums,
// and its own photos in order.

const headers = { "Content-Type": "application/json", "Cache-Control": FRESH };

export const GET: APIRoute = ({ request }) => {
  const album = findAlbum(new URL(request.url).searchParams.get("slug") ?? "");
  if (!album) return new Response(JSON.stringify({ error: "Unknown album" }), { status: 404, headers });
  const { status, resources } = photosById(album.photos);
  return new Response(JSON.stringify({ album: toAlbumView(album), resources }), { status, headers });
};
