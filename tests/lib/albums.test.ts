import { describe, expect, it } from "vitest";
import realFolders from "../../scripts/album-folders.json";
import {
  MIN_ALBUM_PHOTOS,
  flickrIdOf,
  flickrTaken,
  photoName,
  cameraStem,
  shootOf,
  captureDay,
  hintTags,
  parseFolderName,
  parseFolders,
  proposeAlbums,
  siteAlbums,
  albumYaml,
} from "../../scripts/lib/albums.mjs";
import { albumDetails, toAlbumCard, type Album } from "../../src/lib/albums";
import { idsExpression } from "../../src/lib/cloudinaryServer";

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

const CLOUD = "demo";
const previewOf = (id: string) => ({ public_id: id, secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/${id}` });

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
    ).toMatchObject([
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
      // URL-safe: the album route takes the slug as `?slug=`.
      for (const slug of slugs) expect(slug).toMatch(/^\d{4}-[a-z0-9-]+$/);
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
    // After 5am it's a new day: only the day-off fallback takes it, flagged.
    expect(assigned(proposal)).toEqual({
      late: "2026-thievery-corporation-0329 dated",
      morning: "2026-thievery-corporation-0329 nearby",
    });
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
  const album = (slug: string, title: string, year: number, date: string | null, photoIds: string[], how = "dated") => ({
    slug,
    title,
    folder: title,
    year,
    date,
    photos: photoIds.map((id) => ({ id, how })),
  });

  const proposal = {
    albums: [
      album("2026-nala-0425", "Nala", 2026, "2026-04-25", ids("nala", 5)),
      album("2024-berlin", "Berlin", 2024, null, ids("berlin", 5)),
      album("2024-roma", "Roma", 2024, null, ids("roma", 5)),
      album("2025-tiny-0101", "Tiny", 2025, "2025-01-01", ids("tiny", 4)),
      // Ambiguous placements wait for review, so this one has none kept.
      album("2025-maybe-0301", "Maybe", 2025, "2025-03-01", ids("maybe", 6), "ambiguous"),
    ],
    unassigned: [],
  };
  const taken: Record<string, string | null> = {
    berlin0: "2024:07:03 10:00:00",
    berlin1: "2024:06:30 10:00:00",
    berlin2: "0000:00:00 00:00:00",
  };

  it("hides albums under five kept photos", () => {
    expect(MIN_ALBUM_PHOTOS).toBe(5);
    const slugs = siteAlbums(proposal, taken, CLOUD).map((a) => a.slug);
    expect(slugs).not.toContain("2025-tiny-0101");
    expect(slugs).not.toContain("2025-maybe-0301");
  });

  it("dates by folder, then earliest capture, then nothing; newest first", () => {
    expect(siteAlbums(proposal, taken, CLOUD).map(({ slug, date, count }) => [slug, date, count])).toEqual([
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
      {},
      CLOUD,
    );
    expect(albums.map((a) => a.title)).toEqual(["Charlie", "Alpha", "Zed"]);
  });

  it("keeps photo ids in capture order, undated last", () => {
    const berlin = siteAlbums(proposal, taken, CLOUD).find((a) => a.slug === "2024-berlin");
    expect(berlin?.photos).toEqual(["berlin1", "berlin0", "berlin2", "berlin3", "berlin4"]);
  });

  it("previews the first three photos as delivery URLs", () => {
    const [nala] = siteAlbums(proposal, taken, CLOUD);
    expect(nala.preview).toEqual(ids("nala", 3).map(previewOf));
  });

  it("writes each album as content-collection YAML", () => {
    const [nala] = siteAlbums(proposal, taken, CLOUD);
    expect(albumYaml(nala)).toBe(
      [
        "# Generated by `npm run photos:albums -- build` from scripts/album-proposal.json.",
        'title: "Nala"',
        "year: 2026",
        "date: 2026-04-25",
        "count: 5",
        "photos:",
        ...nala.photos.map((id) => `  - "${id}"`),
        "",
      ].join("\n"),
    );
    // Quotes survive (JSON strings are YAML scalars); undated albums say null.
    const odd = albumYaml({ ...nala, title: 'Is Phat\'s "Closing"?', date: null });
    expect(odd).toContain(`title: ${JSON.stringify('Is Phat\'s "Closing"?')}`);
    expect(odd).toContain("date: null");
  });
});

describe("album labels", () => {
  it("formats stack details", () => {
    expect(albumDetails({ date: "2026-05-30", year: 2026, count: 24 })).toBe("May 2026 · 24 photos");
    expect(albumDetails({ date: "2017-12-03", year: 2017, count: 5 })).toBe("Dec 2017 · 5 photos");
    expect(albumDetails({ date: null, year: 2024, count: 12 })).toBe("2024 · 12 photos");
    expect(albumDetails({ date: "2026-01-02", year: 2026, count: 1 })).toBe("Jan 2026 · 1 photo");
  });

  it("looks an album's photos up by exact public_id", () => {
    expect(idsExpression(["PulisCarShow-1_gt3ca3", "abc"])).toBe(
      'resource_type:image AND (public_id="PulisCarShow-1_gt3ca3" OR public_id="abc")',
    );
  });

  it("shapes an album card", () => {
    const album: Album = {
      slug: "2026-nala-0425",
      title: "Nala",
      date: "2026-04-25",
      year: 2026,
      count: 7,
      photos: ["a", "b", "c", "d", "e", "f", "g"],
    };
    const card = toAlbumCard(album);
    expect(card).toMatchObject({ slug: "2026-nala-0425", title: "Nala", details: "Apr 2026 · 7 photos" });
    expect(card.previews.map((p) => p.key)).toEqual(["a", "b", "c"]);
    // One 2× center crop per card, no srcset; the photo ids stay on the server.
    expect(card.previews[0].src).toContain("/upload/c_fill,w_352,h_440,f_auto,q_auto/");
    expect(Object.keys(card.previews[0]).sort()).toEqual(["key", "src"]);
    expect(card).not.toHaveProperty("photos");
  });
});

describe("Flickr originals", () => {
  it("reads the Flickr id off an original's filename", () => {
    expect(flickrIdOf("_a730157jpg_53598923131_o")).toBe("53598923131");
    expect(flickrIdOf("pitt-volleyball-v-oregon_54200994529_o")).toBe("54200994529");
    expect(flickrIdOf("DSC01234")).toBeNull();
    expect(flickrIdOf(null)).toBeNull();
  });

  it("turns Flickr's date taken into the EXIF form, unless it's only the upload date", () => {
    expect(flickrTaken("2024-02-03 15:25:36", "0")).toBe("2024:02:03 15:25:36");
    expect(flickrTaken("2024-02-03 15:25:36", "1")).toBeNull();
    expect(flickrTaken(undefined)).toBeNull();
  });
});

describe("photo names", () => {
  it("keys descriptive public_ids and titled Flickr originals, not camera names or random ids", () => {
    expect(photoName("PulisCarShow-10_iww7ra")).toBe("puliscarshow");
    expect(photoName("hpumont4aodhmxbh6rsl", "pitt-volleyball-v-oregon_54200994529_o")).toBe("pittvolleyballvoregon");
    expect(photoName("fub3coia8qrcg5jlanrt", "_a730157jpg_53598923131_o")).toBeNull();
    expect(photoName("IMG_1234")).toBeNull();
  });

  it("puts a named photo in its folder ahead of any date match", () => {
    const folders = parseFolders({ 2026: ["Bigelow Bash 4-11", "Puli's Car Show 4-11"] });
    const { albums } = proposeAlbums(folders, [
      { public_id: "PulisCarShow-3_abc123", tags: ["music"], created_at: "2026-08-07T10:00:00Z", taken: "2026:04:11 20:00:00", file: null },
    ]);
    const puli = albums.find((album) => album.slug === "2026-puli-s-car-show-0411");
    expect(puli?.photos).toEqual([{ id: "PulisCarShow-3_abc123", how: "named" }]);
  });
});

describe("ambiguous names", () => {
  it("flags a name that fits several folders when no date settles it", () => {
    const folders = parseFolders({ 2019: ["Amelia Harn 1-6", "Amelia Harn Skatepark 6-11"] });
    const { albums } = proposeAlbums(folders, [
      { public_id: "x1", tags: [], created_at: "2019-01-01T00:00:00Z", taken: null, file: "amelia-harn_46679040221_o" },
      { public_id: "x2", tags: [], created_at: "2019-01-02T00:00:00Z", taken: "2019:06:11 12:00:00", file: "amelia-harn_46679040222_o" },
    ]);
    const how = Object.fromEntries(albums.flatMap((album) => album.photos.map((photo) => [photo.id, [album.slug, photo.how]])));
    expect(how.x1[1]).toBe("ambiguous");
    expect(how.x2).toEqual(["2019-amelia-harn-skatepark-0611", "named"]);
  });
});

describe("nearby dates", () => {
  it("falls back to a folder dated a day off, flagged", () => {
    const folders = parseFolders({ 2021: ["Kai Watkins 4-25"] });
    const { albums } = proposeAlbums(folders, [
      { public_id: "k1", tags: [], created_at: "2021-05-01T00:00:00Z", taken: "2021:04:24 15:00:00", file: null },
    ]);
    expect(albums[0].photos).toEqual([{ id: "k1", how: "nearby" }]);
  });
});

describe("NAS shoot folders", () => {
  it("reads the camera filename off a Flickr original", () => {
    expect(cameraStem("_a730157jpg_53598923131_o")).toBe("_A730157");
    expect(cameraStem("_a734651-enhanced-nrjpg_53599231464_o")).toBe("_A734651");
    expect(cameraStem("pitt-volleyball-v-oregon_54200994529_o")).toBeNull();
  });

  it("files anything nested in a shoot folder under that one shoot", () => {
    expect(shootOf("/PhotoDrive/2017 Photos/Isabelle and Dean Grimes 12-23/JPEG/_D201700.jpg")).toBe("2017 Photos/Isabelle and Dean Grimes 12-23");
    expect(shootOf("/PhotoDrive/2024 Photos/PG Church Show 1/_A731632.ARW")).toBe("2024 Photos/PG Church Show 1");
    expect(shootOf("/PhotoDrive/TPN Sophomore Year/BRIGID 2-3/_A730157.ARW")).toBe("TPN Sophomore Year/BRIGID 2-3");
    expect(shootOf("/PhotoDrive/TPN Sophomore Year/_A734490.ARW")).toBeNull();
  });

  const folders = parseFolders({
    2024: [{ name: "PG Church Show 1", imported: "2024-02-04" }, "Pitt v. UVA 11-9", "Eclipse 4-8"],
    2017: ["Isabelle and Dean Grimes 12-23", "Erin Hopewell and Shay Monty 12-23"],
  });
  const photo = (id: string, file: string, taken: string | null) => ({ public_id: id, tags: [], created_at: "", taken, file });

  it("places a camera file in the shoot whose date fits, across rolled-over counters", () => {
    const nasHits = {
      _A731632: ["/PhotoDrive/2024 Photos/PG Church Show 1/_A731632.ARW", "/PhotoDrive/2024 Photos/Pitt v. UVA 11-9/_A731632.ARW"],
      _D201700: ["/PhotoDrive/2017 Photos/Isabelle and Dean Grimes 12-23/JPEG/_D201700.jpg"],
    };
    const proposal = proposeAlbums(
      folders,
      [photo("a", "_a731632jpg_53599262389_o", "2024:02:03 15:00:00"), photo("b", "_d201700jpg_38079546434_o", "2017:12:23 12:00:00")],
      { nasHits },
    );
    expect(assigned(proposal)).toEqual({ a: "2024-pg-church-show-1 nas", b: "2017-isabelle-and-dean-grimes-1223 nas" });
  });

  it("leaves a file found only outside the known shoots unassigned, with no date guess", () => {
    const nasHits = { _A730157: ["/PhotoDrive/2024 Photos/Pitt v. UVA 11-9/_A730157.ARW", "/PhotoDrive/Other Stuff/BRIGID 2-3/_A730157.ARW"] };
    const proposal = proposeAlbums(folders, [photo("c", "_a730157jpg_53598923131_o", "2024:02:03 15:25:36")], { nasHits });
    expect(proposal.unassigned).toEqual(["c"]);
  });

  it("dates an undated folder by its NAS import, for days no dated folder claims", () => {
    const proposal = proposeAlbums(folders, [photo("d", "x_1_o", "2024:01:28 12:00:00"), photo("e", "y_2_o", "2024:04:08 12:00:00")]);
    expect(assigned(proposal)).toEqual({ d: "2024-pg-church-show-1 nearby", e: "2024-eclipse-0408 dated" });
  });
});

describe("secondary roots", () => {
  const folders = parseFolders({
    2024: [{ name: "BRIGID 2-3", root: "TPN Sophomore Year" }, { name: "Bigelow Bash 4-7", root: "TPN Sophomore Year" }],
    2026: ["Bigelow Bash 4-11"],
  });

  it("maps NAS hits under a secondary root to its shoot", () => {
    const nasHits = { _A730157: ["/PhotoDrive/TPN Sophomore Year/BRIGID 2-3/_A730157.ARW"] };
    const proposal = proposeAlbums(folders, [
      { public_id: "c", tags: [], created_at: "", taken: "2024:02:03 15:25:36", file: "_a730157jpg_53598923131_o" },
    ], { nasHits });
    expect(assigned(proposal)).toEqual({ c: "2024-brigid-0203 nas" });
  });

  it("gives same-named undated photos to the year folder's shoot", () => {
    const proposal = proposeAlbums(folders, [{ public_id: "BigelowBash-10_tmapjv", tags: [], created_at: "", taken: null, file: null }]);
    expect(assigned(proposal)).toEqual({ "BigelowBash-10_tmapjv": "2026-bigelow-bash-0411 named" });
  });
});

describe("undated folders", () => {
  it("date an album by its earliest photo, not its import window", () => {
    const folders = parseFolders({ 2024: [{ name: "PG Church Show 1", imported: "2024-02-04" }] });
    const photos = ["a", "b", "c", "d", "e"].map((id) => ({ public_id: id, tags: [], created_at: "", taken: "2024:02:03 15:00:00", file: null }));
    const proposal = proposeAlbums(folders, photos);
    expect(proposal.albums[0].date).toBeNull();
    const taken = Object.fromEntries(photos.map((photo) => [photo.public_id, photo.taken]));
    expect(siteAlbums(proposal, taken, "demo")[0].date).toBe("2024-02-03");
  });
});
