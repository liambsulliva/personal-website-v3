export const prerender = false;

import type { APIRoute } from "astro";
import { isPublicTag } from "../../../lib/cloudinarySearchPolicy";
import { PUBLIC_CACHE_CONTROL, photoExpression, searchAllPhotos } from "../../../lib/cloudinaryServer";

// Every photo for one chip (`?tag=…`, or none for All), for the gallery to
// shuffle client-side: a chip shows a random set, not the newest photos every
// other chip also starts with. One URL per chip, so the CDN serves it and
// Cloudinary sees about one Search pass per chip per cache window, however
// often it's shuffled.

const JSON_HEADERS = { "Content-Type": "application/json" };

export const GET: APIRoute = async ({ request }) => {
  const tag = new URL(request.url).searchParams.get("tag") || null;
  if (tag !== null && !isPublicTag(tag)) {
    return new Response(JSON.stringify({ error: "Unsupported tag" }), { status: 403, headers: JSON_HEADERS });
  }

  try {
    const { ok, status, resources } = await searchAllPhotos(photoExpression(tag));
    return new Response(JSON.stringify({ resources }), {
      status,
      headers: { ...JSON_HEADERS, "Cache-Control": ok ? PUBLIC_CACHE_CONTROL : "no-store" },
    });
  } catch (error) {
    console.error("Cloudinary tag pool failed", error);
    return new Response(JSON.stringify({ error: "Failed to fetch from Cloudinary" }), { status: 500, headers: JSON_HEADERS });
  }
};
