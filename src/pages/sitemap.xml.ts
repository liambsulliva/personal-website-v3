import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { hasWriteup } from "../lib/content";

// Public HTML routes, trailing-slashed to match the built canonicals. Wings
// are listed by hand; write-ups come from the entries collection so a new
// MDX body shows up here without a second edit.
const WINGS = ["/", "/me/", "/career/", "/engineering/", "/design/", "/photography/", "/writing/"];

export const GET: APIRoute = async ({ site }) => {
  const writeups = (await getCollection("entries"))
    .filter(hasWriteup)
    .map((entry) => `/${entry.data.wing}/${entry.id}/`);

  const base = site ?? new URL("https://liambsullivan.com");
  const urls = [...WINGS, ...writeups]
    .map((path) => `  <url><loc>${new URL(path, base)}</loc></url>`)
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
