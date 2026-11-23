import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { cloudinaryTransform } from "../../src/lib/cloudinaryImage";
import { cldTransform } from "../../src/lib/cloudinary";
import { toGalleryPhoto } from "../../src/lib/photos";
import { DiskCache } from "../../services/img/cache.mjs";
import { render } from "../../services/img/render.mjs";
import { createImgServer, pool } from "../../services/img/server.mjs";
import { parsePath, parseTransform, resolve, WIDTHS } from "../../services/img/transforms.mjs";

const spec = (transform: string, natural = { width: 4000, height: 6000 }) => {
  const parsed = parseTransform(transform.split("/"));
  return parsed && resolve(parsed, natural);
};

describe("transforms", () => {
  it("reads id, version and transform, with or without each", () => {
    expect(parsePath("/img/upload/c_limit,w_480/vabcdef123456/some_photo-1.jpg")).toMatchObject({ id: "some_photo-1", version: "abcdef123456", transform: { width: 480 } });
    expect(parsePath("/img/upload/site/projects/x.png")).toMatchObject({ id: "site/projects/x", version: null });
    expect(parsePath("/img/upload/f_auto,q_auto,c_limit,w_48/e_blur:600/site/me/portrait")).toMatchObject({ id: "site/me/portrait", transform: { blur: true, width: 48 } });
    expect(parsePath("/img/upload/WBB_v._Syracuse-4_fiqqho.jpg")).toMatchObject({ id: "WBB_v._Syracuse-4_fiqqho" });
  });

  it("refuses paths that climb, and transforms it doesn't know", () => {
    for (const path of ["/img/upload/../x", "/img/upload/a/%2e%2e/b", "/img/upload/a%2Fb", "/img/upload/a%00", "/img/upload/%zz", "/img/upload/", "/img/other/x"]) {
      expect(parsePath(path), path).toBeNull();
    }
    for (const transform of ["w_0", "w_99999", "q_100", "e_sepia", "c_scale", "ar_7:3", "f_gif", "w_480,w_640", "e_blur:1"]) {
      expect(parseTransform([transform]), transform).toBeNull();
    }
  });

  it("serves every transform the site and the dashboard build", () => {
    const aspects = ["4:5", "16:9", "40:21", "15:7"];
    const site = [
      cldTransform({ width: 960 }),
      ...aspects.map((aspect) => cldTransform({ width: 1200, aspect })),
      cldTransform({ width: 960, aspect: "4:5", gravity: "face" }),
      cldTransform({ width: 48, aspect: "16:9", quality: "auto:low", blur: 600 }),
      "c_fill,w_352,h_440,f_auto,q_auto",
      "c_fill,g_auto,w_1200,h_630,f_jpg,q_auto",
    ];
    const dashboard = ["c_limit,w_800,f_auto,q_auto", "c_fill,g_auto,w_320,h_320,f_auto,q_auto", "c_fill,g_auto,ar_40:21,w_760,f_auto,q_auto", "c_limit,w_880,h_920,f_auto,q_auto", "c_fill,g_auto,w_264,h_330,f_auto,q_auto", "c_fill,g_auto,w_280,h_350,f_auto,q_auto", "c_pad,w_96,h_96,f_auto,q_auto"];
    const gallery = toGalleryPhoto({ public_id: "x", secure_url: "https://h/upload/v1/x.jpg", width: 4000, height: 6000 });
    const ladder = [gallery.src, ...gallery.lightboxSrcSet.map(({ src }) => src)].map((src) => /\/upload\/(.+)\/v1\//.exec(src)![1]);
    for (const transform of [...site, ...dashboard, ...ladder]) expect(spec(transform), transform).not.toBeNull();
  });

  it("keeps the number of outputs per photo bounded", () => {
    const keys = new Set<string>();
    for (let w = 1; w <= 3840; w++) keys.add(spec(`c_limit,w_${w}`)!.key);
    expect(keys.size).toBe(WIDTHS.length);
    for (let h = 1; h <= 3840; h++) keys.add(spec(`c_limit,w_3840,h_${h}`)!.key);
    expect(keys.size).toBe(WIDTHS.length);
  });

  it("never enlarges, and crops keep their ratio", () => {
    expect(spec("c_limit,w_1200", { width: 1024, height: 683 })).toMatchObject({ width: 1024 });
    expect(spec("c_fill,ar_16:9,w_2000", { width: 1024, height: 683 })).toMatchObject({ width: 1024, height: 576 });
    expect(spec("c_fill,w_352,h_440")).toMatchObject({ width: 352, height: 440 });
    expect(spec("c_fill,w_1200,h_630")).toMatchObject({ width: 1200, height: 630 });
    expect(spec("c_fill,w_500")).toBeNull();
    expect(spec("c_limit,q_auto:best", { width: 6000, height: 4000 })).toMatchObject({ width: 3840 });
  });

  it("sends a JPEG when the image is too tall for WebP", async () => {
    const natural = { width: 1242, height: 40275 };
    expect(spec("c_limit,f_auto,w_320", natural)!.format).toBe("webp");
    expect(spec("c_limit,f_auto,w_540", natural)!.format).toBe("jpeg");
    const strip = await sharp({ create: { width: 10, height: 17000, channels: 3, background: "#777" } }).png().toBuffer();
    const meta = await sharp(await render(strip, spec("c_limit,f_auto", { width: 10, height: 17000 })!)).metadata();
    expect([meta.format, meta.height]).toEqual(["jpeg", 17000]);
  });

  it("keeps the upper part of tall photos, and sharp's pick otherwise", () => {
    const focus = (transform: string, width: number, height: number) => spec(transform, { width, height })!.gravity;
    expect(focus("c_fill,g_auto,w_1200,h_630", 4000, 6000)).toBe("upper");
    expect(focus("c_fill,g_auto,w_320,h_320", 4000, 6000)).toBe("upper");
    expect(focus("c_fill,g_face,ar_4:5,w_960", 4000, 6000)).toBe("upper");
    expect(focus("c_fill,g_auto,w_1200,h_630", 6000, 4000)).toBe("auto");
    expect(focus("c_fill,w_352,h_440", 4000, 6000)).toBe("center");
  });

  it("keeps the URL builders working: the transform goes in after /upload/", () => {
    const url = new URL(cloudinaryTransform("https://liambsullivan.com/img/upload/vabcdef123456/site/a/b.jpg", "c_limit,w_480"));
    expect(parsePath(url.pathname)).toMatchObject({ id: "site/a/b", version: "abcdef123456", transform: { width: 480 } });
  });
});

describe("pool", () => {
  it("runs at most `jobs` at once and refuses past the queue", async () => {
    const work = pool(2, 3);
    let running = 0;
    let most = 0;
    const job = () =>
      work.run(async () => {
        most = Math.max(most, ++running);
        await new Promise((done) => setTimeout(done, 10));
        running--;
      });
    const jobs = [job(), job(), job(), job(), job()];
    await expect(job()).rejects.toMatchObject({ code: "BUSY" });
    await Promise.all(jobs);
    expect(most).toBe(2);
    await job();
  });

  it("goes on after a job fails", async () => {
    const work = pool(1, 5);
    await expect(work.run(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await work.run(async () => 1)).toBe(1);
  });
});

describe("img server", () => {
  const dir = mkdtempSync(join(tmpdir(), "img-"));
  const published = join(dir, "published");
  const cacheDir = join(dir, "cache");
  let server: ReturnType<typeof createImgServer>;
  let origin: string;
  const version = "abcdef123456";
  const record = (path: string, width: number, height: number, extra = {}) => ({ path, kind: "photo", hash: version, version, width, height, format: "jpeg", ...extra });

  beforeAll(async () => {
    mkdirSync(join(published, "Shoot"), { recursive: true });
    mkdirSync(join(published, "_site"));
    const base = sharp({ create: { width: 1200, height: 800, channels: 3, background: "#a33" } });
    // Stored sideways (orientation 6) with GPS: both must be gone from what's served.
    await base
      .clone()
      .withExif({ IFD0: { Copyright: "SECRETCOPY" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 0/1" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(join(published, "Shoot", "a.jpg"));
    await sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(join(published, "_site", "logo.png"));
    await sharp({ create: { width: 20, height: 10, channels: 3, background: "#123" } }).gif().toFile(join(published, "_site", "anim.gif"));
    writeFileSync(join(published, "Shoot", "broken.jpg"), "not an image");
    writeFileSync(join(dir, "outside.jpg"), await base.clone().jpeg().toBuffer());
    symlinkSync(join(dir, "outside.jpg"), join(published, "Shoot", "link.jpg"));
    const photos = {
      aaa: record("Shoot/a.jpg", 800, 1200),
      "site/logo": record("_site/logo.png", 200, 100, { kind: "site", format: "png" }),
      "site/anim": record("_site/anim.gif", 20, 10, { kind: "site", format: "gif" }),
      broken: record("Shoot/broken.jpg", 10, 10),
      moved: record("Shoot/nowhere.jpg", 10, 10),
      link: record("Shoot/link.jpg", 1200, 800),
      climb: record("../outside.jpg", 1200, 800),
      gone: record("Shoot/a.jpg", 800, 1200, { goneAt: "2026-01-01T00:00:00Z" }),
    };
    writeFileSync(join(dir, "index.json"), JSON.stringify({ indexVersion: 1, photos, albums: {} }));
    server = createImgServer({ indexFile: join(dir, "index.json"), publishedDir: published, cacheDir, cacheMaxBytes: 1e9 });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true });
  });
  const get = (path: string, init?: RequestInit) => fetch(origin + path, init);

  it("serves an upright WebP with no metadata, cacheable for good under its own version", async () => {
    const source = await sharp(join(published, "Shoot", "a.jpg")).metadata();
    expect([source.orientation, source.exif?.includes("SECRETCOPY"), source.width]).toEqual([6, true, 1200]);
    const res = await get(`/img/upload/c_limit,f_auto,q_auto,w_480/v${version}/aaa.jpg`);
    expect([res.status, res.headers.get("content-type"), res.headers.get("cache-control")]).toEqual([200, "image/webp", "public, max-age=31536000, s-maxage=86400, immutable"]);
    const body = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(body).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 480, 720]);
    expect([meta.exif, meta.xmp, meta.iptc, meta.orientation]).toEqual([undefined, undefined, undefined, undefined]);
    expect(body.includes("SECRETCOPY")).toBe(false);
  });

  it("caches briefly without a version, or with an old one", async () => {
    for (const path of ["/img/upload/c_limit,w_480/aaa", "/img/upload/c_limit,w_480/v1786117728/aaa.jpg"]) {
      expect((await get(path)).headers.get("cache-control"), path).toMatch(/max-age=3600\b/);
    }
  });

  it("crops, and sends JPEG for link previews", async () => {
    const res = await get("/img/upload/c_fill,g_auto,w_1200,h_630,f_jpg,q_auto/aaa");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([800, 420]); // the source is 800 wide
    const card = await sharp(Buffer.from(await (await get("/img/upload/c_fill,w_352,h_440,f_auto,q_auto/aaa")).arrayBuffer())).metadata();
    expect([card.width, card.height]).toEqual([352, 440]);
  });

  it("crops a tall photo a fifth of the way down", async () => {
    // Rows of rising brightness, so the crop's first row says where it started.
    const rows = await sharp(Buffer.from(Array.from({ length: 200 * 400 }, (_, i) => Math.floor(i / 200 / 2))), { raw: { width: 200, height: 400, channels: 1 } }).png().toBuffer();
    const { data } = await sharp(await render(rows, { ...spec("c_fill,g_auto,ar_16:9,w_200,f_png", { width: 200, height: 400 }) })).greyscale().raw().toBuffer({ resolveWithObject: true });
    expect(Math.abs(data[0] * 2 - (400 - 113) * 0.2)).toBeLessThan(4);
  });

  it("keeps transparency, pads, blurs, and reads GIFs", async () => {
    const pad = await sharp(Buffer.from(await (await get("/img/upload/c_pad,w_96,h_96,f_auto,q_auto/site/logo")).arrayBuffer())).metadata();
    expect([pad.width, pad.height, pad.hasAlpha]).toEqual([96, 96, true]);
    expect((await get("/img/upload/f_auto,q_auto:low,c_limit,w_48/e_blur:600/site/logo")).status).toBe(200);
    expect((await get("/img/upload/f_auto,q_auto,c_limit,w_960/site/anim")).status).toBe(200);
  });

  it("renders once for the same output, then serves the disk copy", async () => {
    const shards = () => readdirSync(cacheDir).reduce((sum, shard) => sum + readdirSync(join(cacheDir, shard)).length, 0);
    const before = shards();
    const all = await Promise.all(Array.from({ length: 8 }, (_, i) => get(`/img/upload/c_limit,w_${601 + i}/v${version}/aaa`)));
    expect(all.every((res) => res.status === 200)).toBe(true);
    expect(shards() - before).toBe(1);
  });

  it("renders one output once for simultaneous requests", async () => {
    let renders = 0;
    const counted = createImgServer({
      indexFile: join(dir, "index.json"),
      publishedDir: published,
      cacheDir: join(dir, "cache2"),
      cacheMaxBytes: 1e9,
      renderImage: async () => {
        renders++;
        await new Promise((done) => setTimeout(done, 50));
        return Buffer.from("x");
      },
    });
    await new Promise<void>((done) => counted.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(counted.address() as AddressInfo).port}`;
    const fetchIt = () => fetch(`${base}/img/upload/c_limit,w_480/aaa`).then((res) => res.text());
    expect(await Promise.all(Array.from({ length: 6 }, fetchIt))).toEqual(Array(6).fill("x"));
    await fetchIt();
    expect(renders).toBe(1);
    counted.close();
  });

  it("answers 304 for the ETag it gave, and HEAD without a body", async () => {
    const path = `/img/upload/c_limit,w_240/v${version}/aaa`;
    const etag = (await get(path)).headers.get("etag")!;
    expect((await get(path, { headers: { "if-none-match": etag } })).status).toBe(304);
    const head = await get(path, { method: "HEAD" });
    expect([head.status, (await head.arrayBuffer()).byteLength]).toEqual([200, 0]);
  });

  it("never serves what isn't published", async () => {
    for (const id of ["gone", "nope", "moved", "link", "climb", "toString", "__proto__"]) {
      const res = await get(`/img/upload/c_limit,w_480/${id}`);
      expect([id, res.status, res.headers.get("cache-control")]).toEqual([id, 404, "no-store"]);
    }
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("/img/upload/c_limit,w_480/broken")).status).toBe(500);
    errors.mockRestore();
    expect((await get("/img/upload/c_limit,w_480/aaa", { method: "POST" })).status).toBe(405);
  });

  it("is healthy only with an index", async () => {
    expect(await (await get("/healthz")).json()).toMatchObject({ ok: true, photos: 8 });
    const bare = createImgServer({ indexFile: join(dir, "none.json"), publishedDir: published, cacheDir, cacheMaxBytes: 1e9 });
    await new Promise<void>((done) => bare.listen(0, "127.0.0.1", done));
    const base = `http://127.0.0.1:${(bare.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/healthz`)).status).toBe(503);
    expect((await fetch(`${base}/img/upload/aaa`)).status).toBe(503);
    bare.close();
  });
});

describe("disk cache", () => {
  it("drops the least recently used past its cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cache-"));
    const cache = new DiskCache(dir, { maxBytes: 1e9 });
    const { utimesSync } = await import("node:fs");
    const names = ["a", "b", "c", "d"].map((key) => cache.name(key, "webp"));
    for (const [i, name] of names.entries()) {
      await cache.put(name, Buffer.alloc(100));
      utimesSync(name, 1000 + i, 1000 + i);
    }
    cache.maxBytes = 250;
    await cache.sweep();
    expect(await Promise.all(names.map(async (name) => Boolean(await cache.get(name))))).toEqual([false, false, true, true]);
    expect(cache.bytes).toBe(200);
    rmSync(dir, { recursive: true });
  });
});
