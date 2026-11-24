import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyIndex, indexReader, loadIndex, saveIndex, tagsOf } from "../../services/lib/index.mjs";
import { buildAlbums } from "../../services/lib/albums.mjs";
import { createWarmer, createWatcher, warmPaths } from "../../services/photos/main.mjs";
import { exifDate, iptcKeywords, readMetadata } from "../../services/photos/metadata.mjs";
import { listPublished, REMOVAL_HOLD, scan } from "../../services/photos/scan.mjs";
import { seed } from "../../services/photos/seed.mjs";
import { parsePath } from "../../services/img/transforms.mjs";

let dir: string;
let root: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "photos-"));
  root = join(dir, "Published");
  mkdirSync(root);
});
afterEach(() => rmSync(dir, { recursive: true }));

const jpeg = (color: string, size = 40) => sharp({ create: { width: size, height: 20, channels: 3, background: color } }).jpeg().toBuffer();
const colorOf = (n: number) => `#${(n * 4111 + 1).toString(16).padStart(6, "0").slice(-6)}`;
let clock = 1_700_000_000;
async function put(path: string, body: Buffer | string | Promise<Buffer>) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), await body);
  clock += 10;
  utimesSync(join(root, path), clock, clock);
}

/** A scanner with its own memory; `run` is one pass, `settle` the two a change needs. */
function scanner(index = emptyIndex()) {
  const memory = { seen: new Map(), rejected: new Map() };
  let current: any = index;
  const run = async (opts = {}) => {
    const result = await scan({ root, index: current, memory, ...opts });
    current = result.index;
    return result;
  };
  return {
    run,
    async settle(opts = {}) {
      const first = await run(opts);
      const second = await run(opts);
      return { ...second, events: [...first.events, ...second.events] };
    },
    get photos(): Record<string, any> {
      return current.photos;
    },
    get live(): string[] {
      return Object.values(current.photos as Record<string, any>).filter((p) => !p.goneAt).map((p) => p.path).sort();
    },
    get index() {
      return current;
    },
  };
}

describe("scan", () => {
  it("publishes a file once it has stopped changing", async () => {
    const s = scanner();
    await put("Shoot/a.jpg", jpeg("red"));
    expect((await s.run()).events).toEqual([]);
    await put("Shoot/a.jpg", jpeg("red", 80)); // still copying
    expect((await s.run()).events).toEqual([]);
    expect((await s.run()).events).toMatchObject([{ type: "added", path: "Shoot/a.jpg" }]);
    const [[id, photo]] = Object.entries(s.photos);
    expect(id).toMatch(/^[a-z0-9]{20}$/);
    expect(photo).toMatchObject({ width: 80, height: 20, format: "jpeg", kind: "photo", path: "Shoot/a.jpg" });
    expect((await s.run()).changed).toBe(false);
  });

  it("waits for a truncated copy instead of publishing half a photo", async () => {
    const s = scanner();
    const noise = await sharp(Buffer.from(Array.from({ length: 300 * 300 * 3 }, (_, i) => (i * 7919) % 251)), { raw: { width: 300, height: 300, channels: 3 } }).jpeg().toBuffer();
    await put("Shoot/a.jpg", noise.subarray(0, noise.length / 2));
    const { events, skipped } = await s.settle();
    expect(events).toEqual([]);
    expect(skipped.some(({ reason }: { reason: string }) => reason.startsWith("doesn't decode"))).toBe(true);
    await put("Shoot/a.jpg", noise);
    expect((await s.settle()).events).toMatchObject([{ type: "added" }]);
  });

  it("ignores what isn't a photo to publish", async () => {
    const s = scanner();
    for (const path of ["@eaDir/a.jpg", ".hidden.jpg", "#recycle/a.jpg", "Shoot/@eaDir/a.jpg", "Shoot/.a.jpg", "Shoot/notes.txt", "Shoot/raw.ARW", "Shoot/x.gif", "Shoot/a.jpg.part", ".site/b.jpg"]) await put(path, jpeg("red"));
    writeFileSync(join(dir, "private.jpg"), await jpeg("blue"));
    symlinkSync(join(dir, "private.jpg"), join(root, "Shoot", "link.jpg"));
    symlinkSync(dir, join(root, "linked"));
    expect((await s.settle()).events).toEqual([]);
  });

  it("keeps the id when a photo is replaced, moved or its folder renamed", async () => {
    const s = scanner();
    await put("Shoot/a.jpg", jpeg("red"));
    await put("Shoot/b.jpg", jpeg("blue"));
    await s.settle();
    const ids = Object.keys(s.photos).sort();
    const before = Object.fromEntries(Object.entries(s.photos).map(([id, p]) => [p.path, { id, version: p.version }]));

    await put("Shoot/a.jpg", jpeg("red", 99));
    expect((await s.settle()).events).toEqual([{ type: "replaced", id: before["Shoot/a.jpg"].id, path: "Shoot/a.jpg" }]);
    expect(s.photos[before["Shoot/a.jpg"].id].version).not.toBe(before["Shoot/a.jpg"].version);

    renameSync(join(root, "Shoot"), join(root, "Renamed"));
    const moved = await s.settle();
    expect(moved.events.map(({ type }: { type: string }) => type)).toEqual(["moved", "moved"]);
    expect([Object.keys(s.photos).sort(), s.live]).toEqual([ids, ["Renamed/a.jpg", "Renamed/b.jpg"]]);
  });

  it("recognises a rename past the removal limit", async () => {
    const s = scanner();
    for (let i = 0; i < 30; i++) await put(`Big/${i}.jpg`, jpeg(colorOf(i)));
    await s.settle();
    const ids = Object.keys(s.photos).sort();
    renameSync(join(root, "Big"), join(root, "Bigger"));
    const { events, blocked } = await s.settle();
    expect([events.length, blocked, Object.keys(s.photos).sort()]).toEqual([30, null, ids]);
  });

  it("doesn't unpublish a moved photo while its copy is still arriving", async () => {
    const s = scanner();
    const body = await jpeg("red");
    await put("A/a.jpg", body);
    for (let i = 0; i < 12; i++) await put(`A/${i}.jpg`, jpeg(colorOf(i)));
    await s.settle();
    const id = Object.keys(s.photos).find((key) => s.photos[key].path === "A/a.jpg")!;
    unlinkSync(join(root, "A/a.jpg"));
    for (let i = 0; i < 4; i++) {
      await put("B/a.jpg", body); // a new mtime each scan
      await s.run();
    }
    expect(s.photos[id].goneAt).toBeUndefined();
    await s.settle();
    expect(s.photos[id]).toMatchObject({ path: "B/a.jpg" });
  });

  it("publishes folders at any depth", async () => {
    const s = scanner();
    for (const [i, path] of ["a.jpg", "A/b.jpg", "A/B/C/c.jpg", "_unsorted/d.jpg", "A/_extras/e.jpg", "A/_site/f.jpg"].entries()) await put(path, jpeg(colorOf(i)));
    await s.settle();
    expect(s.live).toEqual(["A/B/C/c.jpg", "A/_extras/e.jpg", "A/_site/f.jpg", "A/b.jpg", "_unsorted/d.jpg", "a.jpg"]);
    expect(Object.values(s.photos).every(({ kind }) => kind === "photo")).toBe(true);
    const { folders } = await listPublished(root);
    expect(folders.map(({ path }: { path: string }) => path).sort()).toEqual(["A", "A/B", "A/B/C"]);
  });

  it("keeps the older of two files with the same bytes, and says so while the copy is there", async () => {
    const s = scanner();
    const body = await jpeg("red");
    await put("A/a.jpg", body);
    await s.settle();
    const [id] = Object.keys(s.photos);
    await put("B/a.jpg", body);
    const flagged = { path: "B/a.jpg", reason: "same bytes as A/a.jpg", copyOf: "A/a.jpg" };
    for (let i = 0; i < 4; i++) {
      const { events, skipped } = await s.run();
      expect(events).toEqual([]);
      if (i) expect(skipped).toEqual([flagged]);
    }
    expect(s.live).toEqual(["A/a.jpg"]);
    // With the original gone, the copy is the photo: same id.
    unlinkSync(join(root, "A/a.jpg"));
    expect((await s.settle()).events).toMatchObject([{ type: "moved", id, path: "B/a.jpg" }]);
    expect((await s.run()).skipped).toEqual([]);
  });

  it("publishes the older of two new files with the same bytes", async () => {
    const s = scanner();
    const body = await jpeg("red");
    await put("Z/first.jpg", body);
    await put("A/second.jpg", body);
    const { skipped } = await s.settle();
    expect([s.live, skipped.map(({ path }: { path: string }) => path)]).toEqual([["Z/first.jpg"], ["A/second.jpg"]]);
  });

  it("unpublishes after two scans, and restores the same id within 30 days", async () => {
    const s = scanner();
    const body = await jpeg("red");
    await put("A/a.jpg", body);
    await put("A/b.jpg", jpeg("blue"));
    await s.settle();
    const id = Object.keys(s.photos).find((key) => s.photos[key].path === "A/a.jpg")!;
    unlinkSync(join(root, "A/a.jpg"));
    expect((await s.run()).events).toEqual([]);
    expect((await s.run()).events).toEqual([{ type: "removed", id, path: "A/a.jpg" }]);
    await put("A/again.jpg", body);
    expect((await s.settle()).events).toMatchObject([{ type: "restored", id }]);
    unlinkSync(join(root, "A/again.jpg"));
    await s.settle();
    await s.run({ now: new Date(Date.now() + 31 * 86_400_000) });
    expect(s.photos[id]).toBeUndefined();
  });

  describe("photos missing at once", () => {
    /** An index of `n` photos that were in A (and B), with `left` of them on disk. */
    async function library(n: number, left: number) {
      const index: any = emptyIndex();
      for (let i = 0; i < n; i++) {
        const path = `${i % 4 ? "A" : "B"}/${i}.jpg`;
        if (i < left) await put(path, `photo ${i}`);
        const sig = i < left ? `${Buffer.byteLength(`photo ${i}`)}:${clock * 1000}` : "1:1";
        index.photos[`p${i}`] = { path, kind: "photo", sig, hash: `h${i}`, version: `h${i}`, bytes: 999, createdAt: "2026-01-01T00:00:00Z" };
      }
      return scanner(index);
    }

    it("are deleted up to 99", async () => {
      const s = await library(120, 21);
      expect(await s.run()).toMatchObject({ events: [], blocked: null });
      const { events, blocked } = await s.run();
      expect([events.length, blocked, s.live.length]).toEqual([99, null, 21]);
    });

    it("are held from 100, however long it lasts, until exactly those are confirmed", async () => {
      expect(REMOVAL_HOLD).toBe(100);
      const s = await library(120, 20);
      expect((await s.run()).blocked).toBeNull(); // one scan isn't a deletion yet
      for (let i = 0; i < 5; i++) {
        const { blocked, events } = await s.run();
        expect(events).toEqual([]);
        expect(blocked).toMatchObject({ missing: 100, limit: 100, folders: [{ folder: "A", count: 75 }, { folder: "B", count: 25 }] });
      }
      expect((await s.run({ now: new Date(Date.now() + 400 * 86_400_000) })).changed).toBe(false); // no timer, and waiting doesn't rewrite the index
      const { blocked } = await s.run();
      unlinkSync(join(root, "A/1.jpg"));
      await s.run({ confirmed: new Set(blocked.ids.slice(1)) });
      expect(s.live).toHaveLength(21); // the one left out, and the one that went since
      expect((await s.run()).events).toHaveLength(2);
    });

    it("aren't held for a move that's still settling", async () => {
      const s = await library(120, 20);
      writeFileSync(join(root, "A/arriving.jpg"), "x".repeat(999));
      expect(await s.run()).toMatchObject({ blocked: null, events: [] });
    });
  });

  it("never takes an empty folder for a deletion", async () => {
    const s = scanner();
    await put("A/a.jpg", jpeg("red"));
    await s.settle();
    rmSync(join(root, "A"), { recursive: true });
    mkdirSync(join(root, ".site"));
    for (let i = 0; i < 4; i++) await expect(s.run()).rejects.toThrow("Published is empty");
    expect(s.live).toEqual(["A/a.jpg"]);
  });

  it("fails without changing anything when the folder can't be read", async () => {
    const s = scanner();
    await put("A/a.jpg", jpeg("red"));
    await s.settle();
    rmSync(root, { recursive: true });
    await expect(s.run()).rejects.toThrow();
    expect(s.live).toEqual(["A/a.jpg"]);
  });

  it("keeps the last good version while a replacement doesn't decode", async () => {
    const s = scanner();
    await put("A/a.jpg", jpeg("red"));
    await s.settle();
    const [before] = Object.values(s.photos);
    await put("A/a.jpg", "broken");
    expect((await s.settle()).events).toEqual([]);
    expect(Object.values(s.photos)).toEqual([before]);
  });

  it("addresses site imagery by name", async () => {
    const s = scanner();
    await put("_site/projects/herl/book.png", sharp({ create: { width: 9, height: 9, channels: 4, background: "#0000" } }).png().toBuffer());
    await s.settle();
    expect(s.photos["site/projects/herl/book"]).toMatchObject({ kind: "site", format: "png" });
  });
});

describe("metadata", () => {
  it("reads capture time and size the way up it's shown", async () => {
    const body = await sharp({ create: { width: 60, height: 20, channels: 3, background: "red" } })
      .withExif({ IFD2: { DateTimeOriginal: "2026:04:11 14:02:03" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect(await readMetadata(body)).toMatchObject({ width: 20, height: 60, takenAt: "2026-04-11T14:02:03" });
  });

  it("reads keywords from XMP and IPTC", async () => {
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Bag><rdf:li>music</rdf:li><rdf:li>rock &amp; roll</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>';
    const body = await sharp({ create: { width: 9, height: 9, channels: 3, background: "red" } }).withXmp(xmp).jpeg().toBuffer();
    expect((await readMetadata(body)).fileTags).toEqual(["music", "rock & roll"]);
    const record = (text: string) => Buffer.concat([Buffer.from([0x1c, 2, 25, 0, text.length]), Buffer.from(text)]);
    expect(iptcKeywords(Buffer.concat([Buffer.from("8BIM"), record("sports"), record("football")]))).toEqual(["sports", "football"]);
  });

  it("survives malformed EXIF and refuses what isn't a published image type", async () => {
    expect(exifDate(Buffer.from("Exif\0\0II*\0\xff\xff\xff\xff", "latin1"))).toBeNull();
    await expect(readMetadata(Buffer.from("GIF89a"))).rejects.toThrow();
  });

  it("lets the dashboard's tag edits win over the file", () => {
    expect(tagsOf({ fileTags: ["a", "b"], tagEdits: { b: false, c: true } } as any)).toEqual(["a", "c"]);
  });
});

describe("watcher", () => {
  const indexFile = () => join(dir, "index", "index.json");
  const log: string[] = [];
  const make = (opts = {}) => createWatcher({ root, indexFile: indexFile(), log: (line: string) => log.push(line), ...opts } as any);
  beforeEach(() => void (log.length = 0));

  it("won't start without an index, or with a damaged one", async () => {
    expect(() => make()).toThrow(/no index/);
    mkdirSync(dirname(indexFile()));
    writeFileSync(indexFile(), "{");
    expect(() => make()).toThrow();
  });

  it("starts a new host from the share's copy, with every id kept", async () => {
    await saveIndex(indexFile(), emptyIndex());
    const first = make();
    await put("Shoot/a.jpg", jpeg("red"));
    await first.tick();
    await first.tick();
    const ids = Object.keys(loadIndex(indexFile())!.photos);
    rmSync(indexFile());
    const second = make();
    expect(log.some((line) => line.includes("restored the index"))).toBe(true);
    expect(Object.keys(loadIndex(indexFile())!.photos)).toEqual(ids);
    await second.tick();
    await second.tick();
    expect(Object.keys(second.index.photos)).toEqual(ids);
    // A damaged copy is not a reason to start over.
    rmSync(indexFile());
    writeFileSync(join(root, ".site/index.json"), "{");
    expect(() => make()).toThrow();
    expect(existsSync(indexFile())).toBe(false);
  });

  it("saves the index and a copy on the share, and warms what's new", async () => {
    await saveIndex(indexFile(), emptyIndex());
    const warmed: any[] = [];
    const watcher = make({ warm: (photos: any[]) => warmed.push(...photos) });
    expect(watcher.health().ok).toBe(false);
    await put("Shoot/a.jpg", jpeg("red"));
    await watcher.tick();
    await watcher.tick();
    expect(Object.keys(loadIndex(indexFile())!.photos)).toHaveLength(1);
    expect(readFileSync(join(root, ".site/index.json"), "utf8")).toBe(readFileSync(indexFile(), "utf8"));
    expect([warmed.length, watcher.health()]).toMatchObject([1, { ok: true, photos: 1 }]);
    // A restart carries on from the file: no new id.
    const again = make();
    await again.tick();
    await again.tick();
    expect(Object.keys(again.index.photos)).toEqual(Object.keys(watcher.index.photos));
  });

  it("reports a vanished share, and holds a mass removal until it's confirmed by what was shown", async () => {
    const index: any = emptyIndex();
    for (let i = 0; i < 130; i++) index.photos[`p${i}`] = { path: `A/B/${i}.jpg`, kind: "photo", sig: "1:1", hash: `h${i}`, version: `h${i}`, bytes: 999, createdAt: "2026-01-01T00:00:00Z" };
    index.folders["A/B"] = { link: "b" };
    await put("C/keep.jpg", jpeg("red"));
    await saveIndex(indexFile(), index);
    const watcher = make();
    renameSync(root, `${root}-away`);
    mkdirSync(root);
    await watcher.tick();
    expect(watcher.health()).toMatchObject({ ok: false, error: "Published is empty" });
    rmSync(root, { recursive: true });
    renameSync(`${root}-away`, root);
    for (let i = 0; i < 5; i++) await watcher.tick();
    const { blocked } = watcher.health();
    expect(watcher.health()).toMatchObject({ ok: false, photos: 131, blocked: { missing: 130, folders: [{ folder: "A/B", count: 130 }] } });
    expect(watcher.index.folders["A/B"]).toEqual({ link: "b" });
    expect([await watcher.confirmRemoval("other"), await watcher.confirmRemoval(undefined)]).toEqual([null, null]);
    expect(watcher.health().photos).toBe(131);
    expect(await watcher.confirmRemoval(blocked!.key)).toEqual({ confirmed: 130 });
    expect(watcher.health()).toMatchObject({ ok: true, photos: 1, blocked: null });
    await watcher.tick();
    expect(Object.keys(watcher.index.folders)).toEqual(["C"]);
  });

  it("warms URLs the resizer accepts, and keeps going when one fails", async () => {
    const paths = warmPaths("site/a b", { version: "abcdef123456" });
    expect(paths.map((path: string) => parsePath(path)?.id)).toEqual(paths.map(() => "site/a b"));
    const got: string[] = [];
    const warm = createWarmer("http://img", { log: () => {}, fetch: (async (url: string) => {
      got.push(url);
      if (got.length === 1) throw new Error("down");
      return new Response("x");
    }) as any });
    await warm([["id", { kind: "photo", version: "abcdef123456" }]]);
    expect(got).toHaveLength(paths.length);
  });

  it("re-reads the index when it's replaced and keeps the last good one", async () => {
    const file = indexFile();
    const read = indexReader(file, { everyMs: 0 });
    expect(read()).toBeNull();
    await saveIndex(file, emptyIndex());
    expect(read()).toEqual(emptyIndex());
    writeFileSync(file, "{ half");
    expect(read()).toEqual(emptyIndex());
  });
});

describe("seed", () => {
  const md5 = (body: Buffer) => createHash("md5").update(body).digest("hex");
  it("keeps ids, dates, tags and album slugs, and the first scan then changes nothing", async () => {
    const [a, b] = [await jpeg("red"), await jpeg("blue")];
    await put("Bash 4-11/WBB_v._a-1_x.jpg", a);
    await put("_unsorted/b.jpg", b);
    await put("_site/me/portrait.jpg", jpeg("green"));
    const asset = (public_id: string, body: Buffer, tags: string[] = []) => ({ public_id, created_at: "2025-10-31T06:48:58+00:00", etag: md5(body), tags, alt: null });
    const exported = [asset("WBB_v._a-1_x", a, ["sports"]), asset("b", b), asset("site/me/portrait", await jpeg("green"))];
    const albums = [{ slug: "2026-bash-0411", photos: ["WBB_v._a-1_x"] }];
    const { index, problems } = await seed({ exported, root, albums } as any);
    expect(Object.values(problems).flat()).toEqual([]);
    expect(index.photos["WBB_v._a-1_x"]).toMatchObject({ createdAt: "2025-10-31T06:48:58.000Z", tagEdits: { sports: true }, path: "Bash 4-11/WBB_v._a-1_x.jpg" });
    expect(index.albums).toEqual({ "2026-bash-0411": { folder: "Bash 4-11", known: ["WBB_v._a-1_x"] } });
    const s = scanner(index);
    expect([(await s.settle()).changed, buildAlbums(s.index).all.get("Bash 4-11")?.link]).toEqual([false, "2026-bash-0411"]);
  });

  it("names what's missing, different or unaccounted for", async () => {
    await put("A/a.jpg", jpeg("red"));
    await put("A/extra.jpg", jpeg("blue"));
    const exported = [
      { public_id: "a", created_at: "2025-10-31T06:48:58+00:00", etag: "0", tags: ["bad tag"], alt: null },
      { public_id: "lost", created_at: "2025-10-31T06:48:58+00:00", etag: "0", tags: [], alt: null },
    ];
    const { problems } = await seed({ exported, root, albums: [{ slug: "x", photos: ["lost"] }] } as any);
    expect(problems).toMatchObject({ missing: ["lost"], different: ["a"], extra: ["A/extra.jpg"], badTags: ["a: bad tag"] });
    expect(problems.albums).toHaveLength(1);
  });
});
