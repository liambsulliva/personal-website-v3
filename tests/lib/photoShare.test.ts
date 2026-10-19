import { describe, expect, it } from "vitest";
import { ALL, PHOTOGRAPHY_TITLE, photographyTitle, shareHref, sourceFromParams, tagLabel } from "../../src/lib/photoShare";

// The site title's suffix (its branding), taken from the site rather than written out here.
const SUFFIX = PHOTOGRAPHY_TITLE.slice(PHOTOGRAPHY_TITLE.indexOf(" - "));

const shown = { albums: ["2026-sample-expo-2026", "2024-sample-expo-0803"], tags: ["basketball", "street-art", "a.b:c-d_e"] };
const parse = (query: string) => sourceFromParams(new URLSearchParams(query), shown);

describe("sourceFromParams (shared /photography links)", () => {
  it("no params is All", () => {
    expect(parse("")).toEqual({ source: ALL, missing: null });
    expect(parse("album=&tag=")).toEqual({ source: ALL, missing: null });
  });

  it("resolves a shown album by slug", () => {
    expect(parse("album=2026-sample-expo-2026")).toEqual({ source: { kind: "album", slug: "2026-sample-expo-2026" }, missing: null });
  });

  it("resolves a chip tag, punctuation included", () => {
    expect(parse("tag=basketball")).toEqual({ source: { kind: "tag", tag: "basketball" }, missing: null });
    expect(parse("tag=a.b%3Ac-d_e")).toEqual({ source: { kind: "tag", tag: "a.b:c-d_e" }, missing: null });
  });

  it("an album wins over a tag", () => {
    expect(parse("tag=basketball&album=2024-sample-expo-0803").source).toEqual({ kind: "album", slug: "2024-sample-expo-0803" });
  });

  it("a slug or tag the page doesn't show falls back to All and says which", () => {
    // Titles aren't slugs; hidden (under 5 photos), deleted and renamed albums aren't shown.
    expect(parse("album=Sample%20Expo%202026")).toEqual({ source: ALL, missing: "album" });
    expect(parse("album=2022-sample-shoot-0212")).toEqual({ source: ALL, missing: "album" });
    // Hidden tags (editorial, `_`-prefixed) never reach the chip list.
    expect(parse("tag=featured")).toEqual({ source: ALL, missing: "tag" });
    expect(parse("tag=_album-2026-x")).toEqual({ source: ALL, missing: "tag" });
    expect(parse("tag=Basketball")).toEqual({ source: ALL, missing: "tag" });
  });

  it("a missing album still shows the link's tag", () => {
    expect(parse("album=gone&tag=basketball")).toEqual({ source: { kind: "tag", tag: "basketball" }, missing: "album" });
  });
});

describe("shareHref", () => {
  const page = new URL("https://example.test/photography?utm_source=x#top");

  it("sets one param, keeping the rest of the URL", () => {
    expect(shareHref({ kind: "album", slug: "2026-sample-expo-2026" }, page)).toBe(
      "https://example.test/photography?utm_source=x&album=2026-sample-expo-2026#top",
    );
    expect(shareHref({ kind: "tag", tag: "basketball" }, new URL("https://example.test/photography?album=old"))).toBe(
      "https://example.test/photography?tag=basketball",
    );
  });

  it("All drops both params", () => {
    expect(shareHref(ALL, new URL("https://example.test/photography?album=a&tag=b"))).toBe("https://example.test/photography");
  });

  it("round-trips through sourceFromParams", () => {
    for (const source of [{ kind: "album", slug: "2024-sample-expo-0803" }, { kind: "tag", tag: "a.b:c-d_e" }, ALL] as const) {
      expect(sourceFromParams(new URL(shareHref(source, page)).searchParams, shown).source).toEqual(source);
    }
  });
});

describe("photographyTitle", () => {
  const albums = [{ slug: "2026-sample-expo-2026", title: "Sample Expo 2026" }];

  it("names the album or tag", () => {
    expect(photographyTitle({ kind: "album", slug: "2026-sample-expo-2026" }, albums)).toBe(`Sample Expo 2026${SUFFIX}`);
    expect(photographyTitle({ kind: "tag", tag: "basketball" }, albums)).toBe(`Basketball Photos${SUFFIX}`);
    expect(photographyTitle(ALL, albums)).toBe(PHOTOGRAPHY_TITLE);
  });

  it("tagLabel matches the chips", () => {
    expect(tagLabel("street art")).toBe("Street Art");
    expect(tagLabel("street-art")).toBe("Street-art");
  });
});
