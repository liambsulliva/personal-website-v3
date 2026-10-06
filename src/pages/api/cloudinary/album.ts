export const prerender = false;

import type { APIRoute } from "astro";
import { listAlbums } from "../../../lib/albums";
import { idsExpression, searchAllPhotos } from "../../../lib/cloudinaryServer";

// One album's photos, in capture order. Membership is the `albums` content
// collection, so the only input is a known slug (no expression from
// the client). It only changes with a deploy, which clears the CDN, so the
// CDN can keep it for a day: about one Cloudinary Search call per album per
// deploy and region.

const JSON_HEADERS = { "Content-Type": "application/json" };
const ALBUM_CACHE_CONTROL = "public, s-maxage=86400, stale-while-revalidate=604800";

export const GET: APIRoute = async ({ request }) => {
  const slug = new URL(request.url).searchParams.get("slug");
  const album = (await listAlbums()).find((candidate) => candidate.slug === slug);
  if (!album) {
    return new Response(JSON.stringify({ error: "Unknown album" }), { status: 404, headers: JSON_HEADERS });
  }

  try {
    const { ok, status, resources } = await searchAllPhotos(idsExpression(album.photos));
    const order = new Map(album.photos.map((id, index) => [id, index]));
    resources.sort((a, b) => (order.get(a.public_id) ?? 0) - (order.get(b.public_id) ?? 0));
    return new Response(JSON.stringify({ resources }), {
      status,
      headers: { ...JSON_HEADERS, "Cache-Control": ok ? ALBUM_CACHE_CONTROL : "no-store" },
    });
  } catch (error) {
    console.error("Cloudinary album request failed", error);
    return new Response(JSON.stringify({ error: "Failed to fetch from Cloudinary" }), { status: 500, headers: JSON_HEADERS });
  }
};
