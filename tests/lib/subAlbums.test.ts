// Sub-albums: a file nested under an album's name in src/content/albums.
import { describe, expect, it } from "vitest";
import { albumVersion, buildAlbums, toAlbumCard, toAlbumView } from "../../src/lib/albums";

const entry = (id: string, n: number, { title = id, date = null, year = 2026 }: { title?: string; date?: string | null; year?: number } = {}) => ({
  id,
  data: { title, year, date: date ? new Date(date) : null, photos: Array.from({ length: n }, (_, i) => `${id}-${i}`) },
});
const paths = (albums: { path: string }[]) => albums.map(({ path }) => path);

describe("buildAlbums", () => {
  it("leaves albums without sub-albums as they were: five photos or more, newest first", () => {
    const { top, byPath } = buildAlbums([
      entry("old", 5, { date: "2024-05-01" }),
      entry("few", 4, { date: "2026-05-01" }),
      entry("undated", 5, { year: 2025 }),
      entry("new", 7, { date: "2025-02-01" }),
    ]);
    expect(paths(top)).toEqual(["new", "undated", "old"]);
    expect([...byPath.keys()].sort()).toEqual(["new", "old", "undated"]);
    expect(top[0]).toMatchObject({ date: "2025-02-01", count: 7, subs: [], cover: ["new-0", "new-1", "new-2"] });
  });

  it("puts nested files under their album, at any depth", () => {
    const { top, byPath } = buildAlbums([
      entry("con/day-1", 5, { date: "2026-08-01" }),
      entry("con/day-2/evening", 6),
      entry("con/day-2", 5, { date: "2026-08-02" }),
      entry("con", 8),
    ]);
    expect(paths(top)).toEqual(["con"]);
    expect(paths(top[0].subs)).toEqual(["con/day-2", "con/day-1"]);
    expect(paths(byPath.get("con/day-2")!.subs)).toEqual(["con/day-2/evening"]);
    expect(top[0].count).toBe(24); // everything beneath
    expect(top[0].photos).toHaveLength(8); // its own
    expect(toAlbumView(byPath.get("con/day-2/evening")!).crumbs.map(({ path }) => path)).toEqual(["con", "con/day-2", "con/day-2/evening"]);
  });

  it("shows an album with sub-albums whatever its own count, and hides a sub-album under five", () => {
    const { top, byPath } = buildAlbums([entry("con", 1), entry("con/big", 5), entry("con/small", 4)]);
    expect(paths(top)).toEqual(["con"]);
    expect(paths(top[0].subs)).toEqual(["con/big"]);
    expect(byPath.has("con/small")).toBe(false);
  });

  it("doesn't show a sub-album whose parent is gone", () => {
    const { top, byPath } = buildAlbums([entry("gone/day-1", 6), entry("gone/a/b", 6), entry("here", 5)]);
    expect(paths(top)).toEqual(["here"]);
    expect([...byPath.keys()]).toEqual(["here"]);
  });
});

describe("albumVersion", () => {
  const con = (over: ReturnType<typeof entry>[]) => albumVersion(buildAlbums(over).byPath.get("con")!);
  const base = [entry("con", 5), entry("con/day-1", 5)];

  it("is the same for the same album, whatever else is published", () => {
    expect(con([...base, entry("other", 9)])).toBe(con(base));
    expect(toAlbumCard(buildAlbums(base).top[0]).version).toBe(con(base));
  });

  it("changes when a photo is added, removed or reordered", () => {
    const photos = base[0].data.photos;
    const withPhotos = (next: string[]) => con([{ id: "con", data: { ...base[0].data, photos: next } }, base[1]]);
    expect(withPhotos([...photos])).toBe(con(base));
    expect(withPhotos([...photos, "x"])).not.toBe(con(base));
    expect(withPhotos(photos.slice(1))).not.toBe(con(base));
    expect(withPhotos(photos.toReversed())).not.toBe(con(base));
    // Past the cover too: the cards don't show those photos.
    expect(withPhotos([...photos.slice(0, 3), photos[4], photos[3]])).not.toBe(con(base));
  });

  it("changes when the album or a sub-album is renamed, or a sub-album changes", () => {
    expect(con([entry("con", 5, { title: "New" }), base[1]])).not.toBe(con(base));
    expect(con([base[0], entry("con/day-1", 5, { title: "New" })])).not.toBe(con(base));
    expect(con([base[0], entry("con/day-1", 6)])).not.toBe(con(base));
    expect(con([base[0]])).not.toBe(con(base));
    expect(con([...base, entry("con/day-1/night", 5)])).not.toBe(con(base));
  });

  it("changes for a sub-album when its parent is renamed (its trail does)", () => {
    const day = (title: string) => albumVersion(buildAlbums([entry("con", 5, { title }), base[1]]).byPath.get("con/day-1")!);
    expect(day("A")).not.toBe(day("B"));
  });
});
