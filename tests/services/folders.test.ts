// Album folders on disk and their album.yaml: written once, kept through
// renames and moves, and never trusted when broken.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAlbums, resolveLink } from "../../services/lib/albums.mjs";
import { emptyIndex, loadIndex, saveIndex } from "../../services/lib/index.mjs";
import { editAlbumFile, parseAlbumFile } from "../../services/photos/albumFile.mjs";
import { createWatcher } from "../../services/photos/main.mjs";

let dir: string, root: string;
let log: string[];
let watcher: ReturnType<typeof createWatcher>;
let colour = 0;

const start = () => (watcher = createWatcher({ root, indexFile: join(dir, "index.json"), log: (line: string) => log.push(line) } as any));
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "folders-"));
  root = join(dir, "Published");
  mkdirSync(root);
  log = [];
  await saveIndex(join(dir, "index.json"), emptyIndex());
  start();
});
afterEach(() => rmSync(dir, { recursive: true }));

async function photos(folder: string, n = 5, from = 1) {
  mkdirSync(join(root, folder), { recursive: true });
  for (let i = 0; i < n; i++) {
    const background = `#${(++colour * 4111).toString(16).padStart(6, "0").slice(-6)}`;
    writeFileSync(join(root, folder, `${from + i}.jpg`), await sharp({ create: { width: 30, height: 20, channels: 3, background } }).jpeg().toBuffer());
  }
}
const settle = async (scans = 3) => {
  for (let i = 0; i < scans; i++) await watcher.tick();
};
const yaml = (folder: string) => readFileSync(join(root, folder, "album.yaml"), "utf8");
const fields = (folder: string) => parseAlbumFile(yaml(folder)) as any;
const albums = () => buildAlbums(watcher.index);
const pathOf = (folder: string) => albums().all.get(folder)?.path ?? null;
const opens = (link: string) => resolveLink(albums(), link)?.folder ?? null;

describe("the file", () => {
  it("reads what's there and refuses what it can't use", () => {
    expect(parseAlbumFile("")).toEqual({});
    expect(parseAlbumFile("# only a note\n")).toEqual({});
    expect(parseAlbumFile("link: day-1\ndate: 2026-04-11\norder:\n  - 007\n  - a b.jpg\nwas: [2026-x/day-1]\ntitle: ignored\n")).toEqual({ link: "day-1", date: "2026-04-11", order: ["007", "a b.jpg"], was: ["2026-x/day-1"] });
    expect(parseAlbumFile("link:\ndate:\norder: []\n")).toEqual({});
    for (const bad of ["a: [", "just words", "- a\n", "link: Day 1\n", "link: a/b\n", "date: April\n", "date: 2026-02-30\n", "order: a.jpg\n", "order:\n  - [a]\n", "was: [../x]\n", "link: &a x\ndate: *a\n", "link: a\nlink: b\n"]) {
      expect(() => parseAlbumFile(bad), bad).toThrow();
    }
  });

  it("changes only what it's asked to", () => {
    const text = "# mine\nnote: keep\ndate: 2026-04-11 # shot\norder:\n  - b.jpg\n";
    expect(editAlbumFile(text, { link: "x" })).toBe("# mine\nnote: keep\ndate: 2026-04-11 # shot\norder:\n  - b.jpg\nlink: x\n");
    expect(parseAlbumFile(editAlbumFile(text, { order: undefined, date: "2020-01-02" }))).toEqual({ date: "2020-01-02" });
    const odd = ["2025", "- x.jpg", "a: b.jpg", "#1.jpg", "null", "é'\".jpg"];
    expect(parseAlbumFile(editAlbumFile(null, { link: "x", order: odd }))).toEqual({ link: "x", order: odd });
    expect(parseAlbumFile(editAlbumFile(null, {}))).toEqual({});
    expect(editAlbumFile(editAlbumFile(null, {}), { link: "x" })).toMatch(/^# link: .*\n# date .*\n\nlink: x\n$/);
  });
});

describe("album.yaml", () => {
  it("is written into each album's folder, with its link once it's shown", async () => {
    await photos("Bash 4-11", 4);
    mkdirSync(join(root, "Empty"));
    mkdirSync(join(root, "_unsorted"));
    await settle();
    expect([fields("Bash 4-11"), fields("Empty"), existsSync(join(root, "_unsorted/album.yaml"))]).toEqual([{}, {}, false]);
    await photos("Bash 4-11", 1, 5);
    await settle();
    expect(fields("Bash 4-11")).toEqual({ link: pathOf("Bash 4-11") });
    expect(pathOf("Bash 4-11")).toMatch(/^\d{4}-bash-0411$/);
    expect(readdirSync(join(root, "Bash 4-11")).filter((name) => name.startsWith("."))).toEqual([]);
    const before = yaml("Bash 4-11");
    await settle();
    expect([yaml("Bash 4-11"), ((await watcher.tick()) as any).skipped]).toEqual([before, []]);
    expect(watcher.health().skipped).toBe(0);
  });

  it("is read when it's edited by hand, once it has settled", async () => {
    await photos("Bash");
    await settle();
    const link = pathOf("Bash");
    writeFileSync(join(root, "Bash/album.yaml"), `${yaml("Bash")}date: 2019-03-04\norder:\n  - 4.jpg\n  - 2.jpg\n`);
    await watcher.tick();
    expect(albums().all.get("Bash")!.date).not.toBe("2019-03-04");
    await settle(2);
    const album = albums().all.get("Bash")!;
    expect([album.date, album.path, album.photos.map((id: string) => watcher.index.photos[id].path)]).toEqual(["2019-03-04", link, ["Bash/4.jpg", "Bash/2.jpg", "Bash/1.jpg", "Bash/3.jpg", "Bash/5.jpg"]]);
  });

  it("keeps the last good values when it's broken, says so, and leaves the file alone", async () => {
    await photos("Bash");
    await settle();
    writeFileSync(join(root, "Bash/album.yaml"), `${yaml("Bash")}date: 2019-03-04\n`);
    await settle();
    const link = pathOf("Bash");
    writeFileSync(join(root, "Bash/album.yaml"), "link: [\n");
    await settle();
    expect([albums().all.get("Bash")!.date, pathOf("Bash"), yaml("Bash")]).toEqual(["2019-03-04", link, "link: [\n"]);
    expect(watcher.report().skipped).toMatchObject([{ path: "Bash/album.yaml", album: "Bash", reason: expect.stringContaining("last good values") }]);
    start(); // a restart keeps them too
    await settle();
    expect([albums().all.get("Bash")!.date, watcher.report().skipped.length]).toEqual(["2019-03-04", 1]);
    rmSync(join(root, "Bash/album.yaml"));
    await settle();
    expect([fields("Bash"), watcher.report().skipped]).toEqual([{ link, date: "2019-03-04" }, []]);
  });

  it("is written again when it's deleted, and gets its link back when that's taken out", async () => {
    await photos("Bash");
    await settle();
    const text = yaml("Bash");
    rmSync(join(root, "Bash/album.yaml"));
    await settle();
    expect(yaml("Bash")).toBe(text);
    writeFileSync(join(root, "Bash/album.yaml"), "date: 2019-03-04\n");
    await settle();
    expect(fields("Bash")).toEqual({ date: "2019-03-04", link: (parseAlbumFile(text) as any).link });
  });

  it("waits for the one-time copy before touching an old album", async () => {
    await photos("Puli 4-11");
    const index = loadIndex(join(dir, "index.json"))!;
    index.albums = { "2026-puli-s-car-show-0411": { folder: "Puli 4-11", known: [] } };
    await saveIndex(join(dir, "index.json"), index);
    start();
    await settle(4);
    expect([existsSync(join(root, "Puli 4-11/album.yaml")), pathOf("Puli 4-11")]).toEqual([false, "2026-puli-s-car-show-0411"]);
    expect(watcher.report().skipped).toMatchObject([{ reason: expect.stringContaining("one-time copy") }]);
    writeFileSync(join(root, "Puli 4-11/album.yaml"), "link: 2026-puli-s-car-show-0411\ndate: 2026-04-11\n");
    await settle();
    expect([albums().all.get("Puli 4-11"), watcher.report().skipped]).toMatchObject([{ date: "2026-04-11", path: "2026-puli-s-car-show-0411" }, []]);
    expect(yaml("Puli 4-11")).toBe("link: 2026-puli-s-car-show-0411\ndate: 2026-04-11\n");
  });

  it("keeps the link in the index when the folder can't be written", async () => {
    await photos("Bash");
    mkdirSync(join(root, "Bash/album.yaml")); // in the way
    await settle(4);
    expect(pathOf("Bash")).toMatch(/-bash$/);
    expect(log.filter((line) => line.includes("not written"))).toHaveLength(1);
    rmSync(join(root, "Bash/album.yaml"), { recursive: true });
    await settle();
    expect(fields("Bash").link).toBe(pathOf("Bash"));
  });
});

describe("folders renamed and moved in Finder", () => {
  it("keeps the link through a rename, ids and all", async () => {
    await photos("Bash 4-11");
    await settle();
    const [link, ids] = [pathOf("Bash 4-11"), Object.keys(watcher.index.photos).sort()];
    renameSync(join(root, "Bash 4-11"), join(root, "Bigelow Bash 4-11"));
    await settle(4);
    expect([pathOf("Bigelow Bash 4-11"), Object.keys(watcher.index.photos).sort(), Object.keys(watcher.index.folders)]).toEqual([link, ids, ["Bigelow Bash 4-11"]]);
    expect(fields("Bigelow Bash 4-11")).toEqual({ link });
  });

  it("gives an album moved to another parent its old link in `was`, its sub-albums' following", async () => {
    await photos("X/A/Day 1");
    await photos("Y/Other");
    await settle(4);
    const [x, y] = [pathOf("X"), pathOf("Y")];
    expect(pathOf("X/A/Day 1")).toBe(`${x}/a/day-1`);
    renameSync(join(root, "X/A"), join(root, "Y/A"));
    await settle(4);
    expect([pathOf("Y/A"), fields("Y/A").was, fields("Y/A/Day 1").was]).toEqual([`${y}/a`, [`${x}/a`], undefined]);
    expect([opens(`${x}/a`), opens(`${x}/a/day-1`), opens(`${y}/a/day-1`)]).toEqual(["Y/A", "Y/A/Day 1", "Y/A/Day 1"]);
    // Out to the top, and back: the current link always wins.
    renameSync(join(root, "Y/A"), join(root, "A"));
    await settle(4);
    expect([pathOf("A"), fields("A").was]).toEqual(["a", [`${x}/a`, `${y}/a`]]);
    renameSync(join(root, "A"), join(root, "Y/A"));
    await settle(4);
    expect([pathOf("Y/A"), opens("a"), opens(`${y}/a`)]).toEqual([`${y}/a`, "Y/A", "Y/A"]);
  });

  it("follows a folder that was copied over and then deleted", async () => {
    await photos("X/Day 1");
    await photos("Y/Other");
    await settle(4);
    const { cpSync } = await import("node:fs");
    cpSync(join(root, "X/Day 1"), join(root, "Y/Day 1"), { recursive: true });
    await settle(4);
    // Still two copies: the older one is published, the copy is flagged.
    expect(["X/Day 1", "Y/Day 1"].map((folder) => albums().all.get(folder)!.shown)).toEqual([true, false]);
    expect(watcher.report().skipped.filter((item: any) => item.copyOf)).toHaveLength(5);
    const old = pathOf("X/Day 1")!;
    rmSync(join(root, "X/Day 1"), { recursive: true });
    await settle(5);
    expect([pathOf("Y/Day 1"), opens(old), watcher.report().skipped]).toEqual([`${pathOf("Y")}/day-1`, "Y/Day 1", []]);
  });

  it("gives a moved album another segment when its new parent has that one", async () => {
    await photos("X/Day 1");
    await photos("Y/Day 1 7-31");
    await settle(4);
    const [x, y, old] = [pathOf("X"), pathOf("Y"), pathOf("Y/Day 1 7-31")];
    expect(old).toBe(`${y}/day-1`);
    renameSync(join(root, "X/Day 1"), join(root, "Y/Day 1"));
    await settle(4);
    expect([pathOf("Y/Day 1 7-31"), pathOf("Y/Day 1"), fields("Y/Day 1")]).toEqual([old, `${y}/day-1-2`, { link: "day-1-2", was: [`${x}/day-1`] }]);
  });

  it("doesn't take a new folder for one that was deleted", async () => {
    await photos("Old");
    await photos("Keep", 1);
    await settle();
    const link = pathOf("Old");
    rmSync(join(root, "Old"), { recursive: true });
    await photos("New");
    await settle(5);
    expect([pathOf("New"), pathOf("New") === link, Object.keys(watcher.index.folders).sort()]).toEqual([expect.stringMatching(/-new$/), false, ["Keep", "New"]]);
  });
});
