// Regression: Oct 2026, production /photography showed no photos and no tag
// chips while dev worked. A Cloudinary search failed (rate limit) during a
// production render, searchAllPhotos turned it into "no photos, no tags", and
// the page was sent with the normal public CDN cache headers, so the CDN kept
// the empty page (and could serve it stale for a day). A failed search must
// never be cached, on the page or on the routes that share the search.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import reactRenderer from "@astrojs/react/server.js";
import { PUBLIC_CACHE_CONTROL, searchAllPhotos, searchCacheControl } from "../../src/lib/cloudinaryServer";
import { GET as poolGET } from "../../src/pages/api/cloudinary/pool";
import { GET as tagsGET } from "../../src/pages/api/cloudinary/tags";
import PhotographyPage from "../../src/pages/photography.astro";

const photo = (id: string, tags: string[]) => ({
  public_id: id,
  secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${id}.jpg`,
  width: 3000,
  height: 2000,
  tags,
});

/** Cloudinary Search, answering each call in turn. */
function stubSearch(...pages: Array<{ status: number; body: unknown } | Error>) {
  const fetchMock = vi.fn(async () => {
    const next = pages.shift();
    if (!next) throw new Error("unexpected extra Cloudinary call");
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const RATE_LIMITED = { status: 420, body: { error: { message: "Rate Limit Exceeded" } } };

beforeEach(() => {
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
  vi.stubEnv("CLOUDINARY_API_KEY", "key");
  vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("searchAllPhotos", () => {
  it("pages through every photo and collects public tags", async () => {
    stubSearch(
      { status: 200, body: { resources: [photo("a", ["cars", "featured"])], next_cursor: "c1" } },
      { status: 200, body: { resources: [photo("b", ["music", "_hidden"])] } },
    );
    const result = await searchAllPhotos("resource_type:image");
    expect(result.ok).toBe(true);
    expect(result.resources.map((r) => r.public_id)).toEqual(["a", "b"]);
    expect(result.tags).toEqual(["cars", "music"]);
  });

  it("reports a rate-limited page as a failure, not as an empty library", async () => {
    stubSearch({ status: 200, body: { resources: [photo("a", ["cars"])], next_cursor: "c1" } }, RATE_LIMITED);
    expect(await searchAllPhotos("resource_type:image")).toEqual({ ok: false, status: 420, resources: [], tags: [] });
  });

  it("reports a network failure as a failure instead of throwing", async () => {
    stubSearch(new TypeError("fetch failed"));
    expect(await searchAllPhotos("resource_type:image")).toMatchObject({ ok: false, status: 502 });
  });

  it("fails without credentials", async () => {
    vi.stubEnv("CLOUDINARY_API_SECRET", "");
    const fetchMock = stubSearch();
    expect(await searchAllPhotos("resource_type:image")).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("cache headers after a Cloudinary search", () => {
  it("caches successes publicly and failures never", () => {
    expect(searchCacheControl(true)).toBe(PUBLIC_CACHE_CONTROL);
    expect(searchCacheControl(false)).toBe("no-store");
  });

  const call = (handler: typeof poolGET, url: string) =>
    handler({ request: new Request(url) } as Parameters<typeof poolGET>[0]) as Promise<Response>;

  it("/api/cloudinary/pool doesn't cache a failed search", async () => {
    stubSearch(RATE_LIMITED);
    const response = await call(poolGET, "http://x/api/cloudinary/pool?tag=cars");
    expect(response.status).toBe(420);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("/api/cloudinary/tags doesn't cache a failed search as an empty tag list", async () => {
    stubSearch(RATE_LIMITED);
    const response = await call(tagsGET, "http://x/api/cloudinary/tags");
    expect(response.status).toBe(420);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).not.toHaveProperty("tags");
  });

  it("/api/cloudinary/tags caches a good tag list", async () => {
    stubSearch({ status: 200, body: { resources: [photo("a", ["cars"])] } });
    const response = await call(tagsGET, "http://x/api/cloudinary/tags");
    expect(response.headers.get("Cache-Control")).toBe(PUBLIC_CACHE_CONTROL);
    expect(await response.json()).toEqual({ tags: ["cars"] });
  });
});

describe("/photography render", () => {
  const render = async () => {
    const container = await AstroContainer.create();
    container.addServerRenderer({ renderer: reactRenderer });
    container.addClientRenderer({ name: "@astrojs/react", entrypoint: "@astrojs/react/client.js" });
    return container.renderToResponse(PhotographyPage);
  };

  it("is never cached when the Cloudinary search fails", async () => {
    stubSearch(RATE_LIMITED);
    const response = await render();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("is cached publicly, with photos and chips, when the search works", async () => {
    stubSearch({ status: 200, body: { resources: [photo("a", ["cars"]), photo("b", ["music"])] } });
    const response = await render();
    expect(response.headers.get("Cache-Control")).toBe(PUBLIC_CACHE_CONTROL);
    const html = await response.text();
    expect(html).toContain("data-photo-index");
    expect(html).toContain("&quot;cars&quot;");
  });
});
