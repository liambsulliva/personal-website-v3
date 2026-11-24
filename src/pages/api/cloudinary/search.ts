export const prerender = false;

import type { APIRoute } from "astro";
import { sanitizePublicCloudinarySearch } from "../../../lib/cloudinarySearchPolicy";
import { FRESH, searchPhotos } from "../../../lib/photoSearch";

// Public, read-only photo search, one page at a time. Only tag expressions
// from cloudinarySearchPolicy pass.

const headers = { "Content-Type": "application/json", "Cache-Control": FRESH };

export const GET: APIRoute = ({ request }) => {
  const url = new URL(request.url);
  const rawMax = url.searchParams.get("max_results");
  const nextCursor = url.searchParams.get("next_cursor");
  const body = sanitizePublicCloudinarySearch({
    expression: url.searchParams.get("expression"),
    max_results: rawMax === null ? 20 : Number(rawMax),
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  });
  if (!body || body.randomize) return new Response(JSON.stringify({ error: "Unsupported search request" }), { status: 403, headers });
  const { status, data } = searchPhotos(body);
  return new Response(JSON.stringify(data), { status, headers });
};
