export const prerender = false;

import type { APIRoute } from "astro";
import { isPublicTag } from "../../../lib/cloudinarySearchPolicy";
import { FRESH, listPhotos } from "../../../lib/photoSearch";

// Every photo for one chip (`?tag=…`, or none for All), for the gallery to
// shuffle client-side: a chip shows a random set, not the newest photos every
// other chip also starts with.

const headers = { "Content-Type": "application/json", "Cache-Control": FRESH };

export const GET: APIRoute = ({ request }) => {
  const tag = new URL(request.url).searchParams.get("tag") || null;
  if (tag !== null && !isPublicTag(tag)) return new Response(JSON.stringify({ error: "Unsupported tag" }), { status: 403, headers });
  const { status, resources } = listPhotos(tag);
  return new Response(JSON.stringify({ resources }), { status, headers });
};
