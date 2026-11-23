// The same page code over either image backend: URLs, searches and caching.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyIndex, saveIndex } from "../../services/lib/index.mjs";
import { parsePath, resolve, WIDTHS } from "../../services/img/transforms.mjs";
import { toOgImage, toStackPhoto } from "../../src/lib/albums";
import { idsExpression, listPhotoTags, photoExpression, searchAlbumPhotos, searchAllPhotos, searchPhotos } from "../../src/lib/cloudinaryServer";
import { deliveryUrl, imageBase } from "../../src/lib/imageBackend";
import { clearOriginCache } from "../../src/lib/originCache";
import { toGalleryPhoto } from "../../src/lib/photos";

const fetch = vi.fn(async () => Response.json({ resources: [] }));
let dir: string;
const version = "abcdef123456";
const photo = (createdAt: string, fileTags: string[] = [], extra = {}) => ({ path: "A/x.jpg", kind: "photo", hash: version, version, width: 4000, height: 6000, format: "jpeg", fileTags, createdAt, ...extra });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "backend-"));
  vi.stubGlobal("fetch", fetch);
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
  vi.stubEnv("CLOUDINARY_API_KEY", "key");
  vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
  vi.stubEnv("IMAGE_BACKEND", "nas");
  vi.stubEnv("PHOTO_INDEX_FILE", join(dir, "index.json"));
  fetch.mockClear();
  const index = emptyIndex();
  Object.assign(index.photos, {
    old: photo("2024-01-01T00:00:00.000Z", ["music", "featured"]),
    "new.v._1": photo("2026-01-01T00:00:00.000Z", ["sports"], { tagEdits: { sports: false, music: true, _draft: true } }),
    mid: photo("2025-01-01T00:00:00.000Z", ["sports"]),
    gone: photo("2026-02-01T00:00:00.000Z", ["music"], { goneAt: "2026-03-01T00:00:00Z" }),
    "site/me/portrait": photo("2026-02-01T00:00:00.000Z", [], { kind: "site" }),
  });
  await saveIndex(join(dir, "index.json"), index);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearOriginCache();
  rmSync(dir, { recursive: true });
});

const ids = (resources: { public_id: string }[]) => resources.map(({ public_id }) => public_id);

describe("IMAGE_BACKEND=nas", () => {
  it("lists published photos newest first, without calling Cloudinary", async () => {
    const all = await searchAllPhotos(photoExpression());
    expect([ids(all.resources), all.tags]).toEqual([["new.v._1", "mid", "old"], ["music", "sports"]]);
    expect(all.resources[0]).toEqual({ public_id: "new.v._1", secure_url: `/img/upload/v${version}/new.v._1.webp`, width: 4000, height: 6000 });
    expect(await listPhotoTags()).toEqual(["music", "sports"]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("filters by tag with the dashboard's edits applied, and keeps an album's order", async () => {
    expect(ids((await searchAllPhotos(photoExpression("music"))).resources)).toEqual(["new.v._1", "old"]);
    expect(ids((await searchAllPhotos(photoExpression("sports"))).resources)).toEqual(["mid"]);
    expect(ids((await searchAlbumPhotos(["old", "gone", "new.v._1", "site/me/portrait"])).resources)).toEqual(["old", "new.v._1"]);
    expect(idsExpression(["old"])).toContain('public_id="old"');
  });

  it("pages, and refuses what it can't answer", async () => {
    const first = await searchPhotos({ expression: "resource_type:image", max_results: 2 });
    expect([ids(first.data.resources), first.data.next_cursor, "tags" in first.data]).toEqual([["new.v._1", "mid"], "2", false]);
    const second = await searchPhotos({ expression: "resource_type:image", max_results: 2, next_cursor: "2" });
    expect([ids(second.data.resources), second.data.next_cursor]).toEqual([["old"], undefined]);
    for (const body of [{ expression: "folder:site/*", max_results: 1 }, { expression: "resource_type:image", max_results: 1, next_cursor: "x" }, { expression: "resource_type:image AND tags=a OR b", max_results: 1 }]) {
      expect((await searchPhotos(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("says so when there's no index, and recovers when there is", async () => {
    vi.stubEnv("PHOTO_INDEX_FILE", join(dir, "later.json"));
    expect(await searchAllPhotos(photoExpression())).toMatchObject({ ok: false, status: 503, resources: [] });
    vi.stubEnv("PHOTO_INDEX_FILE", join(dir, "index.json"));
    expect((await searchAllPhotos(photoExpression())).ok).toBe(true);
  });

  it("builds URLs the resizer serves, at widths it doesn't have to snap", async () => {
    const [resource] = (await searchAllPhotos(photoExpression())).resources;
    const gallery = toGalleryPhoto(resource);
    const urls = [gallery.src, ...gallery.lightboxSrcSet.map(({ src }) => src), ...gallery.previewSrcSet.split(", ").map((part) => part.split(" ")[0]), toStackPhoto("new.v._1").src];
    for (const url of urls) {
      const request = parsePath(url);
      expect(request, url).toMatchObject({ id: "new.v._1", version });
      const spec = resolve(request!.transform, resource)!;
      if (spec.crop === "limit") expect([url, spec.width]).toEqual([url, request!.transform.width]);
    }
    expect(gallery.lightboxSrcSet.map(({ width }) => width)).toEqual([480, 640, 800, 960, 1200, 1280, 1920, 2560, 3840]);
    expect(gallery.lightboxSrcSet.every(({ width }) => WIDTHS.includes(width))).toBe(true);
  });

  it("gives link previews a whole URL, and site images an unversioned one", () => {
    expect(toOgImage("old")).toBe(`https://liambsullivan.com/img/upload/c_fill,g_auto,w_1200,h_630,f_jpg,q_auto/v${version}/old.webp`);
    expect(imageBase()).toBe("/img/upload");
    expect(deliveryUrl("nope/x y")).toBe("/img/upload/nope/x%20y");
  });

  it("caches an album's data briefly", async () => {
    const { GET } = await import("../../src/pages/api/cloudinary/album");
    const { listAlbums } = await import("../../src/lib/albums");
    const { albumVersion } = await import("../../src/lib/albumData");
    const [album] = await listAlbums();
    const call = async () => (await GET({ request: new Request(`https://x/api?slug=${album.slug}&v=${albumVersion(album)}`) } as any)).headers.get("cache-control");
    expect(await call()).toContain("s-maxage=300");
    vi.stubEnv("IMAGE_BACKEND", "");
    expect(await call()).toContain("s-maxage=86400");
  });
});

describe("IMAGE_BACKEND unset", () => {
  it("is Cloudinary, unchanged", async () => {
    vi.stubEnv("IMAGE_BACKEND", "");
    expect(deliveryUrl("a/b", "demo")).toBe("https://res.cloudinary.com/demo/image/upload/a/b");
    expect(toStackPhoto("a", "demo").src).toBe("https://res.cloudinary.com/demo/image/upload/c_fill,w_352,h_440,f_auto,q_auto/a");
    expect(toOgImage("a", "demo")).toBe("https://res.cloudinary.com/demo/image/upload/c_fill,g_auto,w_1200,h_630,f_jpg,q_auto/a");
    await searchAllPhotos(photoExpression());
    expect(fetch).toHaveBeenCalledOnce();
    expect(String((fetch.mock.calls as unknown[][])[0][0])).toContain("api.cloudinary.com/v1_1/demo/");
  });
});
