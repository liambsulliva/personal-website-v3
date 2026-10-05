import { describe, expect, it } from "vitest";
import realFolders from "../../scripts/album-folders.json";
import {
  MIN_ALBUM_PHOTOS,
  albumTag as scriptAlbumTag,
  captureDay,
  hintTags,
  parseFolderName,
  parseFolders,
  proposeAlbums,
  siteAlbums,
  toAlbumsModule,
} from "../../scripts/lib/albums.mjs";
import { albumDetails, albumExpression, albumTag, toAlbumCard, type Album } from "../../src/lib/albums";

type Photo = { public_id: string; tags: string[]; created_at: string; taken: string | null };

const photo = (public_id: string, taken: string | null, tags: string[] = [], created_at = "2026-05-01T00:00:00Z"): Photo => ({
  public_id,
  tags,
  created_at,
  taken,
});

const resource = (public_id: string) => ({
  public_id,
  secure_url: `https://res.cloudinary.com/demo/image/upload/v1/${public_id}.jpg`,
  width: 3000,
  height: 2000,
  tags: ["extra"],
});

const previewOf = (id: string) => {
  const { public_id, secure_url, width, height } = resource(id);
  return { public_id, secure_url, width, height };
};

const assigned = (proposal: ReturnType<typeof proposeAlbums>) =>
  Object.fromEntries(proposal.albums.flatMap((album) => album.photos.map(({ id, how }) => [id, `${album.slug} ${how}`])));

describe("parseFolderName", () => {
  it.each([
    ["Amelia Harn Bookstore 5-30", 2026, "Amelia Harn Bookstore", "2026-05-30"],
    ["Ava Acosta Cottagecore 6-01", 2026, "Ava Acosta Cottagecore", "2026-06-01"],
    ["Sex and Love Cover Photoshoot 2-8", 2026, "Sex and Love Cover Photoshoot", "2026-02-08"],
    ["Drag Me To Bingo! 11-9", 2025, "Drag Me To Bingo!", "2025-11-09"],
    ["VETO Project 2025 4-5", 2025, "VETO Project 2025", "2025-04-05"],
    ["Social Psych of Reality TV 9□3", 2024, "Social Psych of Reality TV", "2024-09-03"],
  ])("reads M-DD: %s", (raw, year, title, day) => {
    expect(parseFolderName(raw, year)).toEqual({ title, start: day, end: day });
  });

  it("reads an M-DD-YY year suffix", () => {
    expect(parseFolderName("International Night 2-18-22", 2022)).toEqual({
      title: "International Night",
      start: "2022-02-18",
      end: "2022-02-18",
    });
    expect(parseFolderName("MJ 10-3-21", 2021)).toMatchObject({ title: "MJ", start: "2021-10-03" });
  });

  it("reads M-D-D as a day range", () => {
    expect(parseFolderName("Moab 3-3-9", 2023)).toEqual({ title: "Moab", start: "2023-03-03", end: "2023-03-09" });
  });

  it("reads an M-DD to M-DD range", () => {
    expect(parseFolderName("Game Jam 10-18 to 10-20", 2024)).toEqual({
      title: "Game Jam",
      start: "2024-10-18",
      end: "2024-10-20",
    });
  });

  it("reads an MMDDYY_ prefix", () => {
    expect(parseFolderName("050722_WTW_Prom", 2022)).toEqual({ title: "WTW Prom", start: "2022-05-07", end: "2022-05-07" });
  });

  it("reads dates in parens and strips file notes", () => {
    expect(parseFolderName("Ava Bass and Ella Stamerra !(9-25)(JPEG ONLY)", 2017)).toEqual({
      title: "Ava Bass and Ella Stamerra",
      start: "2017-09-25",
      end: "2017-09-25",
    });
    expect(parseFolderName("Arlington Magazine Shoot RAWS", 2018)).toEqual({
      title: "Arlington Magazine Shoot",
      start: null,
      end: null,
    });
  });

  it("keeps (Digital)", () => {
    expect(parseFolderName("Erin Hopewell Studio 9-17 (Digital)", 2018)).toMatchObject({
      title: "Erin Hopewell Studio (Digital)",
      start: "2018-09-17",
    });
    expect(parseFolderName("Forrest Nottingham (Digital) 3-10", 2019)).toMatchObject({
      title: "Forrest Nottingham (Digital)",
      start: "2019-03-10",
    });
  });

  it("treats a cut-off date as undated", () => {
    expect(parseFolderName("Christopher Maverick Silhouette 3-...", 2026)).toEqual({
      title: "Christopher Maverick Silhouette...",
      start: null,
      end: null,
    });
    expect(parseFolderName("Arlington Magazine - Pizza Shoot 1...", 2019)).toEqual({
      title: "Arlington Magazine - Pizza Shoot...",
      start: null,
      end: null,
    });
  });

  it("keeps a complete first date before a cut-off", () => {
    expect(parseFolderName("Jocelyn Pham Senior Portraits 3-6-...", 2022)).toEqual({
      title: "Jocelyn Pham Senior Portraits...",
      start: "2022-03-06",
      end: "2022-03-06",
    });
  });

  it("opens a cut-off range for two weeks", () => {
    expect(parseFolderName("Yosemite and San Francisco 8-14 t...", 2019)).toEqual({
      title: "Yosemite and San Francisco...",
      start: "2019-08-14",
      end: "2019-08-28",
      loose: true,
    });
  });

  it("normalises the … ellipsis", () => {
    expect(parseFolderName("Heinz Chapel - Women in the Wind…", 2025)).toEqual({
      title: "Heinz Chapel - Women in the Wind...",
      start: null,
      end: null,
    });
  });

  it.each([
    ["Berlin", 2024],
    ["Otakon 2025", 2025],
    ["Steelhacks XII", 2025],
    ["PG Church Show 1", 2024],
    ["Hang 5 Headshots", 2019],
    ["Grad Photos - By Jon Guo", 2026],
    ["Forrest and MJ March idk", 2018],
  ])("leaves undated %s alone", (raw, year) => {
    expect(parseFolderName(raw, year)).toEqual({ title: raw, start: null, end: null });
  });

  it("ignores impossible dates", () => {
    expect(parseFolderName("Odd 13-40", 2024)).toEqual({ title: "Odd 13-40", start: null, end: null });
    expect(parseFolderName("050722_WTW_Prom", 2023)).toEqual({ title: "WTW Prom", start: null, end: null });
  });
});

describe("parseFolders", () => {
  it("builds slugs, years and hint tags", () => {
    expect(
      parseFolders({
        2026: ["Bigelow Bash 4-11", { name: "Nala 4-25", tags: ["pets"] }, "Iceland 2026"],
        2023: ["Moab 3-3-9"],
      }),
    ).toEqual([
      {
        slug: "2023-moab-0303",
        folder: "Moab 3-3-9",
        title: "Moab",
        year: 2023,
        start: "2023-03-03",
        end: "2023-03-09",
        loose: false,
        tags: [],
      },
      {
        slug: "2026-bigelow-bash-0411",
        folder: "Bigelow Bash 4-11",
        title: "Bigelow Bash",
        year: 2026,
        start: "2026-04-11",
        end: "2026-04-11",
        loose: false,
        tags: ["music"],
      },
      {
        slug: "2026-nala-0425",
        folder: "Nala 4-25",
        title: "Nala",
        year: 2026,
        start: "2026-04-25",
        end: "2026-04-25",
        loose: false,
        tags: ["pets"],
      },
      {
        slug: "2026-iceland-2026",
        folder: "Iceland 2026",
        title: "Iceland 2026",
        year: 2026,
        start: null,
        end: null,
        loose: false,
        tags: [],
      },
    ]);
  });

  it("kebabs punctuation, & and accents", () => {
    const slugs = parseFolders({ 2024: ["Is Phat's Closing? 9-5", "Tariffs & Coffee 11-5", "Café Été"] }).map((f) => f.slug);
    expect(slugs).toEqual(["2024-is-phat-s-closing-0905", "2024-tariffs-and-coffee-1105", "2024-cafe-ete"]);
  });

  it("suffixes duplicates", () => {
    const slugs = parseFolders({
      2024: ["Pitt Volleyball NCAA Championship...", "Pitt Volleyball NCAA Championship..."],
    }).map((f) => f.slug);
    expect(slugs).toEqual(["2024-pitt-volleyball-ncaa-championship", "2024-pitt-volleyball-ncaa-championship-2"]);
  });

  it("keeps a -2 suffix from colliding with a real title ending in 2", () => {
    const slugs = parseFolders({ 2024: ["Foo", "Foo", "Foo 2"] }).map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("marks cut-off ranges loose", () => {
    const [yosemite] = parseFolders({ 2019: ["Yosemite and San Francisco 8-14 t..."] });
    expect(yosemite).toMatchObject({ slug: "2019-yosemite-and-san-francisco-0814", loose: true, end: "2019-08-28" });
  });

  describe("real album-folders.json", () => {
    const folders = parseFolders(realFolders);

    it("parses every folder", () => {
      expect(folders.length).toBe(Object.values(realFolders).flat().length);
      expect(folders.length).toBeGreaterThan(200);
    });

    it("gives unique, tag-safe slugs", () => {
      const slugs = folders.map((f) => f.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
      for (const slug of slugs) expect(scriptAlbumTag(slug)).toMatch(/^_album-\d{4}-[a-z0-9-]+$/);
    });

    it("gives every folder a title", () => {
      for (const folder of folders) expect(folder.title.replace(/\.\.\.$/, "").trim(), folder.folder).not.toBe("");
    });

    it("dates folders inside their own year, on real days", () => {
      for (const { folder, year, start, end } of folders) {
        if (!start) {
          expect(end, folder).toBeNull();
          continue;
        }
        expect(start.slice(0, 4), folder).toBe(String(year));
        expect(start <= end!, folder).toBe(true);
        expect(new Date(`${start}T00:00:00Z`).toISOString().slice(0, 10), folder).toBe(start);
        expect(new Date(`${end}T00:00:00Z`).toISOString().slice(0, 10), folder).toBe(end);
      }
    });

    it("tells the two 2026-04-11 folders apart by tag", () => {
      const sameDay = folders.filter((f) => f.start === "2026-04-11");
      expect(sameDay.map((f) => [f.title, f.tags])).toEqual([
        ["Bigelow Bash", ["music"]],
        ["Puli's Car Show", ["cars"]],
      ]);
    });
  });
});

describe("hintTags", () => {
  it.each([
    ["Puli's Car Show", ["cars"]],
    ["Bigelow Bash", ["music"]],
    ["FB v. Notre Dame", ["football"]],
    ["NFL Draft", ["football"]],
    ["WBB v. Syracuse", ["basketball"]],
    ["VB v. Notre Dame", ["volleyball"]],
    ["MSOC v. UVA", ["soccer"]],
    ["WLAX v. Virginia", ["sports"]],
    ["Otakon 2025", ["cosplay"]],
    ["DNID Game Jam", ["esports"]],
    ["KTP Headshots", ["portraits"]],
    ["Clay Coast Concert Shoot", ["music", "portraits"]],
    ["Woodson Ice Hockey Photoshoot", ["sports", "portraits"]],
    ["Nala", []],
  ])("%s → %j", (title, tags) => {
    expect(hintTags(title)).toEqual(tags);
  });

  it("matches whole words only", () => {
    expect(hintTags("Scarface")).toEqual([]);
    expect(hintTags("Bashful")).toEqual([]);
  });
});

describe("captureDay", () => {
  it("reads EXIF dates", () => {
    expect(captureDay("2026:04:11 21:14:03")).toBe("2026-04-11");
    expect(captureDay("2017:09:25")).toBe("2017-09-25");
  });

  it.each([null, undefined, "", "garbage", "0000:00:00 00:00:00", "2026-04-11 21:14:03", "2026:13:01 00:00:00", "1970:01:01 00:00:00", 20260411])(
    "rejects %j",
    (taken) => {
      expect(captureDay(taken)).toBeNull();
    },
  );
});

describe("proposeAlbums", () => {
  const folders = parseFolders({
    2026: ["Bigelow Bash 4-11", "Puli's Car Show 4-11", "Nala 4-25", "Thievery Corporation 3-29", "Iceland 2026"],
    2023: ["Moab 3-3-9"],
    2019: ["Yosemite and San Francisco 8-14 t...", "Elle Levi 8-20"],
  });

  it("matches capture days to folder dates", () => {
    const proposal = proposeAlbums(folders, [
      photo("nala", "2026:04:25 15:00:00"),
      photo("moab", "2023:03:06 09:00:00"),
      photo("moab-end", "2023:03:09 18:00:00"),
      photo("nowhere", "2026:01:01 12:00:00"),
    ]);
    expect(assigned(proposal)).toEqual({
      nala: "2026-nala-0425 dated",
      moab: "2023-moab-0303 dated",
      "moab-end": "2023-moab-0303 dated",
    });
    expect(proposal.unassigned).toEqual(["nowhere"]);
  });

  it("sends photos before 5am to the previous day's folder", () => {
    const proposal = proposeAlbums(folders, [
      photo("late", "2026:03:30 01:45:00"),
      photo("morning", "2026:03:30 05:00:00"),
    ]);
    expect(assigned(proposal)).toEqual({ late: "2026-thievery-corporation-0329 dated" });
    expect(proposal.unassigned).toEqual(["morning"]);
  });

  it("crosses the year boundary for late shows", () => {
    const nye = parseFolders({ 2018: ["NYE 12-31"] });
    expect(assigned(proposeAlbums(nye, [photo("a", "2019:01:01 02:00:00")]))).toEqual({ a: "2018-nye-1231 dated" });
  });

  it("splits same-day folders by tag", () => {
    const proposal = proposeAlbums(folders, [
      photo("band", "2026:04:11 21:00:00", ["music", "featured"]),
      photo("car", "2026:04:11 13:00:00", ["cars"]),
      photo("both", "2026:04:11 18:00:00", ["cars", "music"]),
      photo("neither", "2026:04:11 18:00:00", ["featured"]),
    ]);
    expect(assigned(proposal)).toEqual({
      band: "2026-bigelow-bash-0411 dated",
      car: "2026-puli-s-car-show-0411 dated",
      both: "2026-bigelow-bash-0411 ambiguous",
      neither: "2026-bigelow-bash-0411 ambiguous",
    });
    expect(proposal.unassigned).toEqual([]);
  });

  it("lets loose ranges catch only unclaimed days", () => {
    const proposal = proposeAlbums(folders, [
      photo("trip", "2019:08:16 12:00:00"),
      photo("shoot", "2019:08:20 12:00:00"),
      photo("trip-end", "2019:08:28 12:00:00"),
      photo("after", "2019:08:29 12:00:00"),
    ]);
    expect(assigned(proposal)).toEqual({
      trip: "2019-yosemite-and-san-francisco-0814 dated",
      shoot: "2019-elle-levi-0820 dated",
      "trip-end": "2019-yosemite-and-san-francisco-0814 dated",
    });
    expect(proposal.unassigned).toEqual(["after"]);
  });

  it("prefers the previous night's exact folder over a loose range", () => {
    const proposal = proposeAlbums(folders, [photo("encore", "2019:08:21 01:30:00")]);
    expect(assigned(proposal)).toEqual({ encore: "2019-elle-levi-0820 dated" });
  });

  it("infers undated photos sandwiched in one album", () => {
    const at = (minute: number) => `2026-05-01T10:${String(minute).padStart(2, "0")}:00Z`;
    const proposal = proposeAlbums(folders, [
      photo("n1", "2026:04:25 15:00:00", ["pets"], at(1)),
      photo("x1", null, ["pets"], at(2)),
      photo("x2", "0000:00:00 00:00:00", ["pets"], at(3)),
      photo("n2", "2026:04:25 15:05:00", ["pets"], at(4)),
      photo("x3", null, ["landscape"], at(5)),
      photo("n3", "2026:04:25 15:10:00", ["pets"], at(6)),
      photo("x4", null, ["pets"], at(7)),
    ]);
    expect(assigned(proposal)).toEqual({
      n1: "2026-nala-0425 dated",
      x1: "2026-nala-0425 inferred",
      x2: "2026-nala-0425 inferred",
      n2: "2026-nala-0425 dated",
      n3: "2026-nala-0425 dated",
    });
    expect(proposal.unassigned).toEqual(["x3", "x4"]);
  });

  it("leaves photos between two albums unassigned", () => {
    const proposal = proposeAlbums(folders, [
      photo("n", "2026:04:25 15:00:00", ["music"], "2026-05-01T10:00:00Z"),
      photo("x", null, ["music"], "2026-05-01T10:01:00Z"),
      photo("t", "2026:03:29 21:00:00", ["music"], "2026-05-01T10:02:00Z"),
    ]);
    expect(proposal.unassigned).toEqual(["x"]);
  });

  it("doesn't anchor inference on ambiguous photos", () => {
    const proposal = proposeAlbums(folders, [
      photo("a", "2026:04:11 18:00:00", [], "2026-05-01T10:00:00Z"),
      photo("x", null, [], "2026-05-01T10:01:00Z"),
      photo("b", "2026:04:11 18:01:00", [], "2026-05-01T10:02:00Z"),
    ]);
    expect(proposal.unassigned).toEqual(["x"]);
  });

  it("orders photos by upload time and albums by size", () => {
    const proposal = proposeAlbums(folders, [
      photo("b", "2026:04:25 15:00:00", [], "2026-05-02T00:00:00Z"),
      photo("a", "2026:04:25 15:00:00", [], "2026-05-01T00:00:00Z"),
      photo("m", "2023:03:04 12:00:00", [], "2026-05-03T00:00:00Z"),
    ]);
    expect(proposal.albums[0]).toMatchObject({
      slug: "2026-nala-0425",
      title: "Nala",
      folder: "Nala 4-25",
      year: 2026,
      date: "2026-04-25",
      photos: [
        { id: "a", how: "dated" },
        { id: "b", how: "dated" },
      ],
    });
    expect(proposal.albums[1].slug).toBe("2023-moab-0303");
    expect(proposal.albums).toHaveLength(folders.length);
    expect(proposal.albums.find((album) => album.slug === "2026-iceland-2026")).toMatchObject({ date: null, photos: [] });
  });
});

describe("siteAlbums", () => {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const album = (slug: string, title: string, year: number, date: string | null, photoIds: string[]) => ({
    slug,
    title,
    folder: title,
    year,
    date,
    photos: photoIds.map((id) => ({ id, how: "dated" })),
  });

  const proposal = {
    albums: [
      album("2026-nala-0425", "Nala", 2026, "2026-04-25", ids("nala", 5)),
      album("2024-berlin", "Berlin", 2024, null, ids("berlin", 5)),
      album("2024-roma", "Roma", 2024, null, ids("roma", 5)),
      album("2025-tiny-0101", "Tiny", 2025, "2025-01-01", ids("tiny", 4)),
      album("2025-ghosts-0301", "Ghosts", 2025, "2025-03-01", [...ids("ghost", 4), "missing"]),
    ],
    unassigned: [],
  };
  const all = proposal.albums.flatMap((a) => a.photos.map(({ id }) => id)).filter((id) => id !== "missing");
  const byId = new Map(all.map((id) => [id, resource(id)]));
  const exif: Record<string, string> = {
    berlin0: "2024:07:03 10:00:00",
    berlin1: "2024:06:30 10:00:00",
    berlin2: "0000:00:00 00:00:00",
  };

  it("hides small albums, counting only existing photos", () => {
    expect(MIN_ALBUM_PHOTOS).toBe(5);
    const slugs = siteAlbums(proposal, byId, exif).map((a) => a.slug);
    expect(slugs).not.toContain("2025-tiny-0101");
    expect(slugs).not.toContain("2025-ghosts-0301");
  });

  it("dates by folder, then earliest capture, then nothing; newest first", () => {
    expect(siteAlbums(proposal, byId, exif).map(({ slug, date, count }) => [slug, date, count])).toEqual([
      ["2026-nala-0425", "2026-04-25", 5],
      ["2024-berlin", "2024-06-30", 5],
      ["2024-roma", null, 5],
    ]);
  });

  it("sorts undated albums as January 1st, then by title", () => {
    const albums = siteAlbums(
      {
        albums: [
          album("2024-z-0101", "Zed", 2024, "2024-01-01", ids("roma", 5)),
          album("2024-a", "Alpha", 2024, null, ids("berlin", 5)),
          album("2024-c-0102", "Charlie", 2024, "2024-01-02", ids("nala", 5)),
        ],
        unassigned: [],
      },
      byId,
      {},
    );
    expect(albums.map((a) => a.title)).toEqual(["Charlie", "Alpha", "Zed"]);
  });

  it("previews the first three photos", () => {
    const [nala] = siteAlbums(proposal, byId, exif);
    expect(nala.preview).toEqual(ids("nala", 3).map(previewOf));
  });

  it("generates a typed module", () => {
    const source = toAlbumsModule(proposal, byId, exif);
    expect(source).toContain('import type { Album } from "../lib/albums";');
    const json = source.slice(source.indexOf("= ") + 2).trim().replace(/;$/, "");
    expect(JSON.parse(json)).toEqual(siteAlbums(proposal, byId, exif));
  });
});

describe("album labels and tags", () => {
  it("formats stack details", () => {
    expect(albumDetails({ date: "2026-05-30", year: 2026, count: 24 })).toBe("May 2026 · 24 photos");
    expect(albumDetails({ date: "2017-12-03", year: 2017, count: 5 })).toBe("Dec 2017 · 5 photos");
    expect(albumDetails({ date: null, year: 2024, count: 12 })).toBe("2024 · 12 photos");
    expect(albumDetails({ date: "2026-01-02", year: 2026, count: 1 })).toBe("Jan 2026 · 1 photo");
  });

  it("builds the Cloudinary tag and expression", () => {
    expect(albumTag("2026-nala-0425")).toBe("_album-2026-nala-0425");
    expect(scriptAlbumTag("2026-nala-0425")).toBe(albumTag("2026-nala-0425"));
    expect(albumExpression("2026-nala-0425")).toBe("resource_type:image AND tags=_album-2026-nala-0425");
  });

  it("shapes an album card", () => {
    const album: Album = {
      slug: "2026-nala-0425",
      title: "Nala",
      date: "2026-04-25",
      year: 2026,
      count: 7,
      preview: ["a", "b", "c"].map(previewOf),
    };
    const card = toAlbumCard(album);
    expect(card).toMatchObject({ slug: "2026-nala-0425", title: "Nala", details: "Apr 2026 · 7 photos" });
    expect(card.previews.map((p) => p.key)).toEqual(["a", "b", "c"]);
    // One 2× center crop per card, no srcset.
    expect(card.previews[0].src).toContain("/upload/c_fill,w_352,h_440,f_auto,q_auto/");
    expect(Object.keys(card.previews[0]).sort()).toEqual(["key", "src"]);
  });
});
