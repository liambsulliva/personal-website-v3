export const prerender = false;

import type { APIRoute } from "astro";
import { listPhotoTags, PUBLIC_CACHE_CONTROL } from "../../../lib/cloudinaryServer";

export const GET: APIRoute = async () => {
  try {
    const tags = await listPhotoTags();
    return new Response(JSON.stringify({ tags }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": PUBLIC_CACHE_CONTROL },
    });
  } catch (error) {
    console.error("Cloudinary tags request failed", error);
    return new Response(JSON.stringify({ error: "Failed to fetch tags from Cloudinary" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
