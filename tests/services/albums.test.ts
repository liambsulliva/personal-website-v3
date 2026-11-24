// Albums worked out from the index: what's shown, in which order, at which address.
import { describe, expect, it } from "vitest";
import { albumOf, ancestry, assignLinks, buildAlbums, linkFor, parseFolder, resolveLink, slugify } from "../../services/lib/albums.mjs";
import { emptyIndex } from "../../services/lib/index.mjs";

/** An index from paths: "Folder/name.jpg", or [path, takenAt]. Ids are the paths. */
function indexOf(paths: Array<string | [string, string]>, folders: Record<string, any> = {}): any {
  const index: any = { ...emptyIndex(), folders };
  for (const entry of paths) {
    const [path, takenAt] = typeof entry === "string" ? [entry, null] : entry;
    index.photos[path] = { path, kind: "photo", takenAt, createdAt: "2026-05-01T00:00:00.000Z" };
  }
  return index;
}
const many = (folder: string, n: number, from = 1) => Array.from({ length: n }, (_, i) => `${folder}/${i + from}.jpg`);
const titles = (albums: any[]) => albums.map(({ title }) => title);
const linked = (index: any) => (assignLinks(index), buildAlbums(index));

describe("folders", () => {
  it("reads title and date from the name", () => {
    expect(parseFolder("Bigelow Bash 4-11")).toEqual({ title: "Bigelow Bash", month: 4, day: 11, suffix: " 4-11" });
    expect(parseFolder("Haven - Feb 2025")).toMatchObject({ title: "Haven - Feb 2025", month: null, suffix: "" });
    expect(parseFolder("Score 20-45")).toMatchObject({ title: "Score 20-45", month: null });
    expect(parseFolder("4-11")).toMatchObject({ title: "4-11", month: null });
  });

  it("puts a photo in its own folder's album, or none", () => {
    expect(["a.jpg", "A/a.jpg", "A/B/a.jpg", "_unsorted/a.jpg", "A/_extras/a.jpg", "A/_extras/B/a.jpg", "A/.x/a.jpg"].map(albumOf)).toEqual([null, "A", "A/B", null, null, null, null]);
  });

  it("keeps photos in no album out of every count", () => {
    const { all } = buildAlbums(indexOf([...many("A", 2), "A/_extras/x.jpg", "_unsorted/y.jpg", "z.jpg"]));
    expect([...all.keys()]).toEqual(["A"]);
    expect(all.get("A")).toMatchObject({ count: 2, shown: false });
  });
});

describe("what is shown", () => {
  it("needs five photos with no sub-album, at any depth", () => {
    const { all } = buildAlbums(indexOf([...many("Four", 4), ...many("Five", 5), ...many("Deep/Four", 4), ...many("Deep/Five", 5)]));
    expect([...all.values()].filter(({ shown }) => shown).map(({ folder }) => folder).sort()).toEqual(["Deep", "Deep/Five", "Five"]);
  });

  it("exempts a folder with a sub-album, even a hidden one, unless it opens to nothing", () => {
    const { all } = buildAlbums(indexOf([...many("One", 1), ...many("One/Hidden", 2), ...many("Empty/Hidden", 4)], { Bare: {}, "Bare/Sub": {} }));
    expect(["One", "One/Hidden", "Empty", "Empty/Hidden", "Bare"].map((folder) => all.get(folder).shown)).toEqual([true, false, false, false, false]);
  });

  it("counts everything beneath, and opens to its own photos only", () => {
    const { all } = buildAlbums(indexOf([...many("P", 2), ...many("P/A", 5), ...many("P/A/B", 3), ...many("P/C", 1)]));
    expect(all.get("P")).toMatchObject({ count: 11, photos: ["P/1.jpg", "P/2.jpg"] });
    expect(titles(all.get("P").subs)).toEqual(["A"]);
    expect(titles(all.get("P").children).sort()).toEqual(["A", "C"]);
  });

  it("takes its cover from its first sub-album when it has no photos", () => {
    const { all } = buildAlbums(indexOf([...many("P/A", 5), ...many("P/B", 5)], { P: { order: ["B"] } }));
    expect(all.get("P").cover).toEqual(["P/B/1.jpg", "P/B/2.jpg", "P/B/3.jpg"]);
    expect(buildAlbums(indexOf([...many("P", 1), ...many("P/A", 5)])).all.get("P").cover).toEqual(["P/1.jpg"]);
  });

  it("leaves out removed photos and site images", () => {
    const index = indexOf(many("A", 6));
    index.photos["A/1.jpg"].goneAt = "2026-06-01T00:00:00Z";
    index.photos["A/2.jpg"].kind = "site";
    expect(buildAlbums(index).all.get("A")).toMatchObject({ count: 4, shown: false });
  });
});

describe("order and date", () => {
  it("puts listed photos first, the rest by capture time then name", () => {
    const index = indexOf([["A/10.jpg", "2026-04-11T12:00:00"], ["A/9.jpg", "2026-04-11T12:00:00"], ["A/z.jpg", "2026-04-11T09:00:00"], "A/none.jpg", "A/é.jpg"], {
      A: { order: ["é.jpg", "gone.jpg", "none.jpg"] },
    });
    expect(buildAlbums(index).all.get("A").photos).toEqual(["A/é.jpg", "A/none.jpg", "A/z.jpg", "A/9.jpg", "A/10.jpg"]);
  });

  it("puts listed sub-albums first, the rest newest first", () => {
    const index = indexOf([...many("P/Day 1", 5), ...many("P/Day 2", 5), ...many("P/Last", 5)], { P: { order: ["Last"] }, "P/Day 1": { date: "2026-07-31" }, "P/Day 2": { date: "2026-08-01" } });
    expect(titles(buildAlbums(index).all.get("P").subs)).toEqual(["Last", "Day 2", "Day 1"]);
  });

  it("dates an album from album.yaml, then its photos, then its folder, else shows the year", () => {
    const taken = (folder: string): [string, string] => [`${folder}/a.jpg`, "2025-04-12T10:00:00"];
    const { all } = buildAlbums(indexOf([taken("Set 4-11"), taken("Taken 4-11"), taken("P/Sub"), "Named 4-11/a.jpg", "Bare/a.jpg"], { "Set 4-11": { date: "2019-01-02" } }));
    expect(["Set 4-11", "Taken 4-11", "P", "Named 4-11", "Bare"].map((folder) => [all.get(folder).date, all.get(folder).year])).toEqual([
      ["2019-01-02", 2019],
      ["2025-04-12", 2025],
      ["2025-04-12", 2025],
      ["2026-04-11", 2026],
      [null, 2026],
    ]);
  });

  it("lists top-level albums newest first, undated ones as January 1st, then by title", () => {
    const dates: Record<string, string> = { Zed: "2026-01-01", Charlie: "2026-01-02", Old: "2019-05-05" };
    const index = indexOf(["Zed", "Charlie", "Alpha", "Old"].flatMap((folder) => many(folder, 5)), Object.fromEntries(Object.entries(dates).map(([folder, date]) => [folder, { date }])));
    expect(titles(linked(index).top)).toEqual(["Charlie", "Alpha", "Zed", "Old"]);
  });
});

describe("links", () => {
  it("makes top-level segments from year, title and day, sub-albums' from the title", () => {
    expect(linkFor({ parent: null, title: "Puli's Car Show", year: 2026, date: "2026-04-11" } as any, new Set())).toBe("2026-pulis-car-show-0411");
    expect(linkFor({ parent: null, title: "Berlin", year: 2024, date: null } as any, new Set(["2024-berlin"]))).toBe("2024-berlin-2");
    expect(linkFor({ parent: "P", title: "Day 1", year: 2026, date: "2026-04-11" } as any, new Set())).toBe("day-1");
    expect(linkFor({ parent: "P", title: "!!!", year: 2026, date: null } as any, new Set())).toBe("album");
    expect(slugify("Café Été & Co.")).toBe("cafe-ete-co");
  });

  it("gives a link once an album is shown, and never changes it", () => {
    const index = indexOf(many("Bash", 4));
    expect(assignLinks(index)).toEqual([]);
    Object.assign(index.photos, indexOf(many("Bash", 1, 5)).photos);
    expect(assignLinks(index)).toEqual(["Bash"]);
    expect(index.folders.Bash.link).toBe("2026-bash");
    index.folders.Bash.date = "2020-02-03";
    expect(assignLinks(index)).toEqual([]);
    expect(buildAlbums(index).byPath.get("2026-bash")).toMatchObject({ folder: "Bash", date: "2020-02-03" });
  });

  it("adds -2 on a clash with a sibling, hidden ones included, and not across parents", () => {
    const index = indexOf([...many("P/Day 1", 5), ...many("P/Day  1!", 5), ...many("Q/Day 1", 5), ...many("P/was", 1)], { "P/was": { link: "day-1" } });
    const { byPath } = linked(index);
    expect([...byPath.keys()].sort()).toEqual(["2026-p", "2026-p/day-1-2", "2026-p/day-1-3", "2026-q", "2026-q/day-1"]);
  });

  it("keeps an old album's address from the index until the copy has run", () => {
    const index = indexOf(many("Puli 4-11", 5));
    index.albums = { "2026-puli-s-car-show-0411": { folder: "Puli 4-11", known: [] } };
    expect(assignLinks(index)).toEqual([]);
    expect([...buildAlbums(index).byPath.keys()]).toEqual(["2026-puli-s-car-show-0411"]);
  });

  it("has no path under a parent without one", () => {
    const index = indexOf(many("P/A", 5), { "P/A": { link: "a" } });
    expect(buildAlbums(index)).toMatchObject({ top: [], byPath: new Map() });
    expect(ancestry(linked(index), buildAlbums(index).all.get("P/A")).map(({ path }) => path)).toEqual(["2026-p", "2026-p/a"]);
  });
});

describe("old links", () => {
  const shown = (folders: Record<string, any>) => buildAlbums(indexOf(Object.keys(folders).flatMap((folder) => many(folder, 5)), folders));
  const at = (folders: Record<string, any>, link: string) => resolveLink(shown(folders), link)?.folder ?? null;

  it("opens the album that moved away", () => {
    expect(at({ A: { link: "a" }, "B": { link: "b", was: ["a/b"] } }, "a/b")).toBe("B");
  });

  it("follows a moved parent to its sub-albums, through several moves", () => {
    const folders = { Y: { link: "y" }, "Y/A": { link: "a", was: ["x/a"] }, "Y/A/Day 1": { link: "day-1" } };
    expect(at(folders, "x/a/day-1")).toBe("Y/A/Day 1");
    expect(at(folders, "x/a/nope")).toBeNull();
    const twice = { Y: { link: "y" }, "Y/A": { link: "a", was: ["x/a"] }, Out: { link: "day-1", was: ["y/a/day-1"] } };
    expect(at(twice, "x/a/day-1")).toBe("Out");
  });

  it("lets a current link win, and gives a twice-claimed one to neither", () => {
    expect(at({ A: { link: "a" }, B: { link: "b", was: ["a"] } }, "a")).toBe("A");
    expect(at({ B: { link: "b", was: ["a"] }, C: { link: "c", was: ["a"] } }, "a")).toBeNull();
    expect(at({ A: { link: "a" }, B: { link: "b", was: ["a"] } }, "a/day-1")).toBeNull();
  });

  it("finds nothing for a hidden album, and survives a loop", () => {
    const index = indexOf(many("A", 4), { A: { link: "a" } });
    expect(resolveLink(buildAlbums(index), "a")).toBeNull();
    expect(at({ A: { link: "b", was: ["c"] }, B: { link: "x", was: ["b/y"] } }, "c/y/z")).toBeNull();
  });
});
