export const prerender = false;

import type { APIRoute } from "astro";
import { sanitizePublicCloudinarySearch } from "../../../lib/cloudinarySearchPolicy";
import { PUBLIC_CACHE_CONTROL, searchPhotos } from "../../../lib/cloudinaryServer";

// Public, read-only photo search used by the gallery for pages after the
// SSR'd first page. Only tag expressions from cloudinarySearchPolicy pass.

const JSON_HEADERS = { "Content-Type": "application/json" };

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const rawMax = url.searchParams.get("max_results");
  const nextCursor = url.searchParams.get("next_cursor");
  const body = sanitizePublicCloudinarySearch({
    expression: url.searchParams.get("expression"),
    max_results: rawMax === null ? 20 : Number(rawMax),
    ...(nextCursor ? { next_cursor: nextCursor } : {}),
  });

  if (!body || body.randomize) {
    return jsonError("Unsupported Cloudinary search request", 403);
  }

  try {
    const { ok, status, data } = await searchPhotos({
      expression: body.expression,
      max_results: body.max_results,
      ...(body.next_cursor ? { next_cursor: body.next_cursor } : {}),
    });
    return new Response(JSON.stringify(data), {
      status,
      headers: {
        ...JSON_HEADERS,
        "Cache-Control": ok ? PUBLIC_CACHE_CONTROL : "no-store",
      },
    });
  } catch (error) {
    console.error("Cloudinary search failed", error);
    return jsonError("Failed to fetch from Cloudinary", 500);
  }
};
