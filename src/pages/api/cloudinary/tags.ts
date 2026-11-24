export const prerender = false;

import type { APIRoute } from "astro";
import { FRESH, listPhotoTags } from "../../../lib/photoSearch";

export const GET: APIRoute = () =>
  new Response(JSON.stringify({ tags: listPhotoTags() }), {
    headers: { "Content-Type": "application/json", "Cache-Control": FRESH },
  });
