// What the page and the album route make of the albums in the index.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer as reactRenderer } from "@astrojs/react";
import { emptyIndex, saveIndex } from "../../services/lib/index.mjs";
import { albumDetails, findAlbum, listAlbums, toAlbumCard, toAlbumView } from "../../src/lib/albums";

let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "site-albums-"));
  vi.stubEnv("PHOTO_INDEX_FILE", join(dir, "index.json"));
  const index: any = emptyIndex();
  const add = (folder: string, n: number) => {
    for (let i = 1; i <= n; i++) index.photos[`${folder.replace(/\W+/g, "")}${i}`] = { path: `${folder}/${i}.jpg`, kind: "photo", version: "abcdef123456", width: 3000, height: 2000, takenAt: null, createdAt: "2026-08-01T00:00:00Z", fileTags: ["music"] };
  };
  add("Otakon 2026", 1);
  add("Otakon 2026/Day 1", 5);
  add("Otakon 2026/Small", 2);
  add("Bash 4-11", 5);
  add("Hidden", 4);
  add("_unsorted", 1);
  index.folders = {
    "Otakon 2026": { link: "2026-otakon-2026", date: "2026-07-31" },
    "Otakon 2026/Day 1": { link: "day-1", was: ["2026-day-1-0731"] },
    "Bash 4-11": { link: "2026-bash-0411", order: ["3.jpg"] },
    Hidden: { link: "2026-hidden" },
  };
  await saveIndex(join(dir, "index.json"), index);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true });
});

describe("album labels", () => {
  it("formats stack details", () => {
    expect(albumDetails({ date: "2026-05-30", year: 2026, count: 24 })).toBe("May 2026 · 24 photos");
    expect(albumDetails({ date: "2017-12-03", year: 2017, count: 5 })).toBe("Dec 2017 · 5 photos");
    expect(albumDetails({ date: null, year: 2024, count: 12 })).toBe("2024 · 12 photos");
    expect(albumDetails({ date: "2026-01-02", year: 2026, count: 1 })).toBe("Jan 2026 · 1 photo");
  });
});

describe("albums on the page", () => {
  it("lists top-level albums as cards, counting everything beneath", () => {
    expect(listAlbums().map(toAlbumCard).map(({ path, title, details }) => [path, title, details])).toEqual([
      ["2026-otakon-2026", "Otakon 2026", "Jul 2026 · 8 photos"],
      ["2026-bash-0411", "Bash", "Apr 2026 · 5 photos"],
    ]);
    const card = toAlbumCard(findAlbum("2026-bash-0411")!);
    // One 2× center crop per card, no srcset; the photo ids stay on the server.
    expect(card.previews.map(({ key }) => key)).toEqual(["Bash4113", "Bash4111", "Bash4112"]);
    expect(card.previews[0].src).toBe("/img/upload/c_fill,w_352,h_440,f_auto,q_auto/vabcdef123456/Bash4113.webp");
    expect(Object.keys(card).sort()).toEqual(["details", "path", "previews", "title"]);
  });

  it("gives an open album its way down and its shown sub-albums", () => {
    expect(toAlbumView(findAlbum("2026-otakon-2026/day-1")!)).toEqual({
      path: "2026-otakon-2026/day-1",
      title: "Day 1",
      crumbs: [{ path: "2026-otakon-2026", title: "Otakon 2026" }, { path: "2026-otakon-2026/day-1", title: "Day 1" }],
      tiles: [],
    });
    expect(toAlbumView(findAlbum("2026-otakon-2026")!).tiles).toMatchObject([{ path: "2026-otakon-2026/day-1", title: "Day 1", details: "2026 · 5 photos" }]);
    expect(findAlbum("2026-day-1-0731")?.path).toBe("2026-otakon-2026/day-1");
    expect([findAlbum("2026-hidden"), findAlbum(""), findAlbum("__proto__")]).toEqual([null, null, null]);
  });
});

describe("the album route", () => {
  const get = async (slug: string) => {
    const { GET } = await import("../../src/pages/api/cloudinary/album");
    const res = (await GET({ request: new Request(`https://x/api?slug=${encodeURIComponent(slug)}`) } as never)) as Response;
    return { status: res.status, body: await res.json() };
  };
  it("answers with the album's own photos in order, and its sub-albums", async () => {
    const { status, body } = await get("2026-otakon-2026");
    expect([status, body.resources.map((photo: any) => photo.public_id), body.album.tiles.length]).toEqual([200, ["Otakon20261"], 1]);
    expect((await get("2026-bash-0411")).body.resources.map((photo: any) => photo.public_id)).toEqual(["Bash4113", "Bash4111", "Bash4112", "Bash4114", "Bash4115"]);
    expect((await get("2026-day-1-0731")).body.album.path).toBe("2026-otakon-2026/day-1");
    for (const slug of ["", "nope", "2026-hidden", "2026-otakon-2026/small"]) expect((await get(slug)).status).toBe(404);
  });
});

describe("the page", () => {
  const page = async (path: string) => {
    const url = new URL(path, "https://liambsullivan.com");
    const container = await AstroContainer.create({ renderers: await loadRenderers([reactRenderer()]) });
    const Page = (await import("../../src/pages/photography/[...path].astro")).default;
    const rest = url.pathname.replace(/^\/photography\/?/, "");
    const res = await container.renderToResponse(Page as never, { params: { path: rest || undefined }, request: new Request(url) });
    return { status: res.status, location: res.headers.get("location"), cache: res.headers.get("cache-control"), html: await res.text() };
  };
  const crumbs = (html: string) => [...html.matchAll(/<a href="(\/photography[^"]*)" class="breadcrumb__link[^>]*>\s*([^<]*?)\s*<\/a>/g)].map(([, href, label]) => [href, label]);

  it("renders an album's level: title, trail, photos, sub-albums and the way back", async () => {
    const { status, html, cache } = await page("/photography/2026-otakon-2026");
    expect([status, cache]).toEqual([200, "private, no-cache"]);
    expect(html).toContain("<title>Otakon 2026 - Liam Sullivan</title>");
    expect(crumbs(html)).toEqual([["/photography", "Photography"], ["/photography/2026-otakon-2026", "Otakon 2026"]]);
    expect(html).toContain('property="og:url" content="https://liambsullivan.com/photography/2026-otakon-2026"');
    expect(html.indexOf('data-album-stack="2026-otakon-2026/day-1"')).toBeLessThan(html.indexOf("data-photo-index"));
    // In the masonry with the photos, whose own numbers (the lightbox's) don't count it.
    expect(html.indexOf("react-photo-album--masonry")).toBeLessThan(html.indexOf('data-album-stack="2026-otakon-2026/day-1"'));
    expect(html.match(/data-photo-index="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Open photo 1"');
    expect(html).toMatch(/<a href="\/photography" aria-label="Back to all photos"/);
    const sub = (await page("/photography/2026-otakon-2026/day-1")).html;
    expect(sub).toMatch(/<a href="\/photography\/2026-otakon-2026" aria-label="Back to Otakon 2026"/);
    expect(crumbs(sub).map(([, label]) => label)).toEqual(["Photography", "Otakon 2026", "Day 1"]);
    expect(sub.match(/data-photo-index/g)).toHaveLength(5);
  });

  it("redirects old links, and renders everything for a link to nothing", async () => {
    expect(await page("/photography?album=2026-bash-0411")).toMatchObject({ status: 301, location: "/photography/2026-bash-0411", cache: "private, no-cache" });
    expect(await page("/photography/2026-day-1-0731")).toMatchObject({ status: 301, location: "/photography/2026-otakon-2026/day-1" });
    for (const path of ["/photography/nope", "/photography/2026-hidden", "/photography?album=nope"]) {
      const { status, html } = await page(path);
      expect([path, status, html.includes('rel="canonical" href="https://liambsullivan.com/photography"')]).toEqual([path, 200, true]);
      expect(crumbs(html)).toEqual([["/photography", "Photography"]]);
      expect(html).toContain("missing&quot;:[0,&quot;album&quot;]");
    }
    expect((await page("/photography?tag=music")).html).toContain("<title>Music Photos - Liam Sullivan</title>");
  });
});
