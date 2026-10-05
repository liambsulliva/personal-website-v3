import type { APIRoute } from "astro";
import { isRawgProxyRequestAllowed } from "../../../lib/switchMenuEmbed";

export const prerender = false;

const RAWG_API_BASE = "https://api.rawg.io/api";
const ALLOWED_QUERY_PARAMS = new Set([
  "search",
  "platforms",
  "search_precise",
  "page_size",
]);
const ALLOWED_PATHS = [
  /^platforms$/,
  /^games$/,
  /^games\/[a-z0-9_-]+$/i,
  /^games\/[a-z0-9_-]+\/movies$/i,
];

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function isAllowedPath(path: string): boolean {
  return (
    path.length <= 160 && ALLOWED_PATHS.some((pattern) => pattern.test(path))
  );
}

function copyAllowedQuery(
  source: URLSearchParams,
  target: URLSearchParams,
): boolean {
  for (const [key, value] of source.entries()) {
    if (!ALLOWED_QUERY_PARAMS.has(key)) return false;
    if (value.length > 120) return false;
    target.append(key, value);
  }

  const pageSize = target.get("page_size");
  if (pageSize && (!/^\d{1,2}$/.test(pageSize) || Number(pageSize) > 10)) {
    return false;
  }

  return true;
}

export const GET: APIRoute = async ({ params, request, url }) => {
  if (!isRawgProxyRequestAllowed(request)) {
    return jsonResponse({ detail: "Forbidden" }, 403);
  }

  const apiKey = import.meta.env.RAWG_API_KEY?.trim();
  if (!apiKey) {
    console.error("[RAWG proxy] RAWG_API_KEY is not configured");
    return jsonResponse({ detail: "RAWG proxy not configured" }, 503);
  }

  const path = params.path?.trim() ?? "";
  if (!isAllowedPath(path)) {
    return jsonResponse({ detail: "Unsupported RAWG endpoint" }, 404);
  }

  const target = new URL(`${RAWG_API_BASE}/${path}`);
  if (!copyAllowedQuery(url.searchParams, target.searchParams)) {
    return jsonResponse({ detail: "Unsupported RAWG query" }, 400);
  }
  target.searchParams.set("key", apiKey);

  try {
    const upstream = await fetch(target, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) {
      console.error(`[RAWG proxy] Upstream ${upstream.status} for /${path}`);
      return jsonResponse({ detail: "RAWG request failed" }, upstream.status);
    }

    return new Response(await upstream.text(), {
      status: 200,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") ?? "application/json",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[RAWG proxy] Upstream request failed", error);
    return jsonResponse({ detail: "RAWG request unavailable" }, 502);
  }
};
