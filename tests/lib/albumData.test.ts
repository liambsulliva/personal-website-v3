// An album's data URL names its photo list, so a CDN that keeps the album
// route for a day (and isn't purged on deploy) can't serve an old album.
import { describe, expect, it } from "vitest";
import { albumDataUrl, albumVersion } from "../../src/lib/albumData";

describe("albumVersion", () => {
  const photos = ["site/a/1", "site/a/2", "site/a/3"];

  it("is stable for the same photo list", () => {
    expect(albumVersion({ photos })).toBe(albumVersion({ photos: [...photos] }));
    expect(albumVersion({ photos })).toMatch(/^[0-9a-z]{1,7}$/);
  });

  it("changes when a publish adds, removes or reorders photos", () => {
    const base = albumVersion({ photos });
    expect(albumVersion({ photos: [...photos, "site/a/4"] })).not.toBe(base);
    expect(albumVersion({ photos: photos.slice(1) })).not.toBe(base);
    expect(albumVersion({ photos: [photos[1], photos[0], photos[2]] })).not.toBe(base);
  });

  it("doesn't confuse where one id ends and the next begins", () => {
    expect(albumVersion({ photos: ["ab", "c"] })).not.toBe(albumVersion({ photos: ["a", "bc"] }));
  });
});

describe("albumDataUrl", () => {
  it("carries the slug and the version", () => {
    expect(albumDataUrl({ slug: "2024-a&b", version: "x1" })).toBe("/api/cloudinary/album?slug=2024-a%26b&v=x1");
  });
});
