import { describe, expect, it } from "vitest";
import { topOf } from "../../src/lib/albumData";
import { ALL, parentHref, photographyCrumbs, photographyTitle, sameSource, shareHref, sourceFromHref, sourceFromUrl, tagLabel, type GallerySource } from "../../src/lib/photoShare";

const CURRENT: Record<string, string> = {
  "2026-otakon": "2026-otakon",
  "2026-otakon/day-1": "2026-otakon/day-1",
  "old/day-1": "2026-otakon/day-1", // it moved
};
const read = (path: string, query = "") => sourceFromUrl(path, new URLSearchParams(query), { current: (link) => (Object.hasOwn(CURRENT, link) ? CURRENT[link] : null), tags: ["music", "street art"] });
const album = (path: string): GallerySource => ({ kind: "album", path });
const ok = (source: GallerySource) => ({ source, missing: null, redirect: null });

describe("photography addresses", () => {
  it("opens an album or sub-album by its path, slash or not", () => {
    expect(read("2026-otakon")).toEqual(ok(album("2026-otakon")));
    expect(read("2026-otakon/day-1")).toEqual(ok(album("2026-otakon/day-1")));
    expect(read("2026-otakon/")).toEqual(ok(album("2026-otakon")));
  });

  it("opens a tag, or everything", () => {
    expect(read("", "tag=street%20art")).toEqual(ok({ kind: "tag", tag: "street art" }));
    expect(read("")).toEqual(ok(ALL));
    expect(read("", "album=&tag=")).toEqual(ok(ALL));
  });

  it("redirects ?album= links and links an album had before it moved", () => {
    expect(read("", "album=2026-otakon").redirect).toBe("/photography/2026-otakon");
    expect(read("", "album=2026-otakon&tag=music&ref=x").redirect).toBe("/photography/2026-otakon?ref=x");
    expect(read("old/day-1").redirect).toBe("/photography/2026-otakon/day-1");
    expect(read("", "album=old/day-1").redirect).toBe("/photography/2026-otakon/day-1");
    expect(read("2026-otakon", "album=x").redirect).toBe("/photography/2026-otakon");
  });

  it("opens the full gallery, and says so, for a link to nothing shown", () => {
    expect(read("gone")).toEqual({ source: ALL, missing: "album", redirect: null });
    expect(read("2026-otakon/gone")).toEqual({ source: ALL, missing: "album", redirect: null });
    expect(read("", "album=gone")).toEqual({ source: ALL, missing: "album", redirect: null });
    expect(read("", "album=gone&tag=music")).toEqual({ source: { kind: "tag", tag: "music" }, missing: "album", redirect: null });
    expect(read("", "tag=gone")).toEqual({ source: ALL, missing: "tag", redirect: null });
  });

  it("writes the address the share button copies, and reads it back", () => {
    const here = new URL("https://x.test/photography?tag=music&ref=a#top");
    expect(shareHref(album("2026-otakon/day-1"), here)).toBe("https://x.test/photography/2026-otakon/day-1?ref=a#top");
    expect(shareHref({ kind: "tag", tag: "street art" }, new URL("https://x.test/photography/2026-otakon?album=y"))).toBe("https://x.test/photography?tag=street+art");
    expect(shareHref(ALL, here)).toBe("https://x.test/photography?ref=a#top");
    for (const source of [album("2026-otakon"), album("2026-otakon/day-1"), ALL, { kind: "tag", tag: "street art" } as GallerySource]) {
      expect(sourceFromHref(new URL(shareHref(source, here)))).toEqual(source);
    }
    expect(sourceFromHref(new URL("https://x.test/photography/"))).toEqual(ALL);
  });

  it("compares sources", () => {
    expect([sameSource(album("a"), album("a")), sameSource(album("a"), album("b")), sameSource(ALL, { kind: "tag", tag: "" }), sameSource(album(""), ALL)]).toEqual([true, false, true, false]);
  });

  it("gives every level a crumb, and the back button its parent", () => {
    expect(photographyCrumbs([{ path: "2026-otakon", title: "Otakon 2026" }, { path: "2026-otakon/day-1", title: "Day 1" }])).toEqual([
      { label: "Photography", href: "/photography" },
      { label: "Otakon 2026", href: "/photography/2026-otakon" },
      { label: "Day 1", href: "/photography/2026-otakon/day-1" },
    ]);
    expect(["a/b/c", "a/b", "a"].map(parentHref)).toEqual(["/photography/a/b", "/photography/a", "/photography"]);
    expect(topOf("a/b/c")).toBe("a");
  });

  it("titles the document after what's open", () => {
    expect(photographyTitle(album("a"), "Day 1")).toBe("Day 1 - Liam Sullivan");
    expect(photographyTitle(album("a"))).toBe("Photography - Liam Sullivan");
    expect(photographyTitle({ kind: "tag", tag: "street art" })).toBe("Street Art Photos - Liam Sullivan");
    expect(photographyTitle(ALL)).toBe("Photography - Liam Sullivan");
    expect(tagLabel("street art")).toBe("Street Art");
  });
});
