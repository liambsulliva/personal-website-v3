// Photos from the index: URLs, lists and caching.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyIndex, saveIndex } from "../../services/lib/index.mjs";
import { parsePath, resolve, WIDTHS } from "../../services/img/transforms.mjs";
import { toOgImage, toStackPhoto } from "../../src/lib/albums";
import { deliveryUrl, IMAGE_BASE } from "../../src/lib/photoIndex";
import { listPhotos, listPhotoTags, photosById, searchPhotos } from "../../src/lib/photoSearch";
import { toGalleryPhoto } from "../../src/lib/photos";

let dir: string;
const version = "abcdef123456";
const photo = (createdAt: string, fileTags: string[] = [], extra = {}) => ({ path: "A/x.jpg", kind: "photo", hash: version, version, width: 4000, height: 6000, format: "jpeg", fileTags, createdAt, ...extra });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "backend-"));
  vi.stubEnv("PHOTO_INDEX_FILE", join(dir, "index.json"));
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
  rmSync(dir, { recursive: true });
});

const ids = (resources: { public_id: string }[]) => resources.map(({ public_id }) => public_id);

describe("photos from the index", () => {
  it("lists published photos newest first", () => {
    const all = listPhotos();
    expect([ids(all.resources), all.tags]).toEqual([["new.v._1", "mid", "old"], ["music", "sports"]]);
    expect(all.resources[0]).toEqual({ public_id: "new.v._1", secure_url: `/img/upload/v${version}/new.v._1.webp`, width: 4000, height: 6000 });
    expect(listPhotoTags()).toEqual(["music", "sports"]);
  });

  it("filters by tag with the dashboard's edits applied, and keeps an album's order", () => {
    expect(ids(listPhotos("music").resources)).toEqual(["new.v._1", "old"]);
    expect(ids(listPhotos("sports").resources)).toEqual(["mid"]);
    expect(ids(photosById(["old", "gone", "new.v._1", "site/me/portrait"]).resources)).toEqual(["old", "new.v._1"]);
  });

  it("pages, and refuses what it can't answer", () => {
    const first = searchPhotos({ expression: "resource_type:image", max_results: 2 });
    expect([ids(first.data.resources), first.data.next_cursor]).toEqual([["new.v._1", "mid"], "2"]);
    const second = searchPhotos({ expression: "resource_type:image", max_results: 2, next_cursor: "2" });
    expect([ids(second.data.resources), second.data.next_cursor]).toEqual([["old"], undefined]);
    expect(ids(searchPhotos({ expression: "resource_type:image AND tags=sports", max_results: 5 }).data.resources)).toEqual(["mid"]);
    for (const body of [{ expression: "folder:site/*", max_results: 1 }, { expression: "resource_type:image", max_results: 1, next_cursor: "x" }, { expression: "resource_type:image AND tags=a OR b", max_results: 1 }]) {
      expect(searchPhotos(body).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("says so when there's no index, and recovers when there is", () => {
    vi.stubEnv("PHOTO_INDEX_FILE", join(dir, "later.json"));
    expect(listPhotos()).toMatchObject({ ok: false, status: 503, resources: [] });
    expect(photosById(["old"])).toMatchObject({ ok: false, status: 503 });
    vi.stubEnv("PHOTO_INDEX_FILE", join(dir, "index.json"));
    expect(listPhotos().ok).toBe(true);
  });

  it("builds URLs the resizer serves, at widths it doesn't have to snap", () => {
    const [resource] = listPhotos().resources;
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
    expect(IMAGE_BASE).toBe("/img/upload");
    expect(deliveryUrl("nope/x y")).toBe("/img/upload/nope/x%20y");
  });

  it("is never kept by Cloudflare", async () => {
    const routes = await Promise.all([import("../../src/pages/api/cloudinary/pool"), import("../../src/pages/api/cloudinary/tags"), import("../../src/pages/api/cloudinary/search"), import("../../src/pages/api/cloudinary/album")]);
    for (const { GET } of routes) {
      for (const query of ["", "?tag=music", "?tag=_x", "?slug=nope", "?expression=resource_type%3Aimage"]) {
        const res = await GET({ request: new Request(`https://x/api${query}`) } as never);
        expect(res.headers.get("cache-control")).toBe("private, no-cache");
      }
    }
  });
});
