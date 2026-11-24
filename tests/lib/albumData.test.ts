// An album's data URL names its state, so a CDN that keeps the album route for
// a day (and isn't purged on deploy) can't serve an old album.
import { describe, expect, it } from "vitest";
import { albumDataUrl, hashOf, topOf } from "../../src/lib/albumData";

describe("hashOf", () => {
  it("is short and stable, and changes with the text", () => {
    expect(hashOf("a")).toBe(hashOf("a"));
    expect(hashOf("a")).not.toBe(hashOf("b"));
    expect(hashOf("a fairly long piece of text")).toMatch(/^[0-9a-z]{1,7}$/);
  });
});

describe("albumDataUrl", () => {
  it("carries the path and the version", () => {
    expect(albumDataUrl("2024-a&b/day-1", "x1")).toBe("/api/cloudinary/album?slug=2024-a%26b%2Fday-1&v=x1");
  });

  it("asks without a version when the page has no card for the album", () => {
    expect(albumDataUrl("2024-a")).toBe("/api/cloudinary/album?slug=2024-a");
  });
});

describe("topOf", () => {
  it("is the top-level album a link is in", () => {
    expect(["a", "a/b", "a/b/c"].map(topOf)).toEqual(["a", "a", "a"]);
  });
});
