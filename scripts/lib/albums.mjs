// Pure album logic for scripts/photo-albums.mjs: folder-name parsing, photo
// matching and the generated src/content/albums/*.yaml. No I/O, so it's unit-tested
// in tests/lib/albums.test.ts.

export const MIN_ALBUM_PHOTOS = 5;
// Placements a compiled album keeps. `ambiguous` waits for review.
const KEPT = new Set(["manual", "nas", "named", "dated", "nearby", "inferred"]);

const pad = (n) => String(n).padStart(2, "0");
const isDay = (month, day) => month >= 1 && month <= 12 && day >= 1 && day <= 31;
const iso = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

/** `YYYY:MM:DD HH:MM:SS` (EXIF, camera-local) → `YYYY-MM-DD`, or null. */
export function captureDay(taken) {
  const match = typeof taken === "string" && taken.match(/^(\d{4}):(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return year > 1990 && isDay(month, day) ? iso(year, month, day) : null;
}

/** Flickr original downloads are named `<title>_<flickr id>_o`. */
export function flickrIdOf(file) {
  return typeof file === "string" ? (file.match(/_(\d{8,})_o$/)?.[1] ?? null) : null;
}

/** Flickr's `datetaken` (`YYYY-MM-DD HH:MM:SS`) → the EXIF form captureDay reads,
 *  or null when Flickr only knows the upload date (`datetakenunknown`). */
export function flickrTaken(datetaken, unknown) {
  if (unknown === "1" || unknown === 1 || typeof datetaken !== "string") return null;
  const match = datetaken.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})/);
  return match ? `${match[1]}:${match[2]}:${match[3]} ${match[4]}` : null;
}

const captureHour = (taken) => Number(taken?.match(/ (\d{2}):/)?.[1] ?? 12);

const shiftDay = (day, by) => {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
};

// Notes about the files, not the shoot.
const FILE_NOTES = /\((?:jpe?g only|raws?)\)|\braws\b/gi;

/**
 * One drive folder name → { title, start, end } for a folder in `year`.
 * Handles `M-DD`, `M-DD-YY`, day ranges (`3-3-9`, `10-18 to 10-20`), `MMDDYY_`
 * prefixes and cut-off names (`...`), where only a complete date counts.
 */
export function parseFolderName(raw, year) {
  // \uf022 is a Finder `/` as it comes over SMB (and □ in a screenshot of it):
  // a date separator between digits (`9/3`), a slash anywhere else.
  let name = raw
    .replace(/(?<=\d)[\uf022□](?=\d)/g, "-")
    .replace(/\s*[\uf022□]\s*/g, "/")
    .replace(/…/g, "...")
    .trim();
  const truncated = name.endsWith("...");
  const yy = year % 100;
  let start = null;
  let end = null;
  let token = null;
  // `8-14 t...`: a range whose end was cut off
  const openRange = truncated && /\d\s+to?\s*\.\.\.$/.test(name);

  const tryMatch = (pattern, toDates) => {
    if (start) return;
    const match = name.match(pattern);
    if (!match) return;
    const dates = toDates(match.slice(1).map(Number));
    if (dates) [start, end, token] = [...dates, match[0]];
  };

  // 050722_WTW_Prom
  tryMatch(/^(\d{2})(\d{2})(\d{2})_/, ([m, d, y]) => (y === yy && isDay(m, d) ? [iso(year, m, d), iso(year, m, d)] : null));
  // Game Jam 10-18 to 10-20
  tryMatch(/(?<!\d)(\d{1,2})-(\d{1,2}) to (\d{1,2})-(\d{1,2})(?!\d)/, ([m1, d1, m2, d2]) =>
    isDay(m1, d1) && isDay(m2, d2) ? [iso(year, m1, d1), iso(year, m2, d2)] : null,
  );
  // Yosemite and San Francisco 8-14 to 22
  tryMatch(/(?<!\d)(\d{1,2})-(\d{1,2}) to (\d{1,2})(?![\d-])/, ([m, d1, d2]) =>
    isDay(m, d1) && isDay(m, d2) && d2 > d1 ? [iso(year, m, d1), iso(year, m, d2)] : null,
  );
  // 2-18-22 (date + year) or 3-3-9 (day range)
  tryMatch(/(?<!\d)(\d{1,2})-(\d{1,2})-(\d{1,2})(?![\d-])/, ([m, d, x]) => {
    if (!isDay(m, d)) return null;
    if (x === yy) return [iso(year, m, d), iso(year, m, d)];
    return x > d && isDay(m, x) ? [iso(year, m, d), iso(year, m, x)] : null;
  });
  // 5-30, 6-01, (9-25); a cut-off `3-6-...` keeps its first complete date
  tryMatch(/(?<!\d)(\d{1,2})-(\d{1,2})(?=$|[^\d]|-\.\.\.)/, ([m, d]) => (isDay(m, d) ? [iso(year, m, d), iso(year, m, d)] : null));

  if (token) name = name.replace(token, " ");
  // a cut-off range keeps its first date: `8-14 t...` → drop the dangling `t`
  if (truncated) name = name.replace(/\s*\.\.\.$/, "").replace(/\s+to?$/, "");
  const title =
    name
      .replace(/^\d{6}_/, "")
      .replace(/_/g, " ")
      .replace(FILE_NOTES, " ")
      // a cut-off date fragment: `3-...`, `1...`, `8-14 t...`
      .replace(/\s+\d{1,2}(?:-\d{0,2})*(?:\s+t\w*)?\s*$/, truncated ? "" : "$&")
      .replace(/!?\(\s*\)/g, " ")
      .replace(/\s+!\s*$/, "")
      .replace(/\s+-\s*$/, "")
      .replace(/\s+/g, " ")
      .trim() + (truncated ? "..." : "");
  // An open range matches up to two weeks on, but only where no exact folder does.
  if (openRange && start) return { title, start, end: shiftDay(start, 14), loose: true };
  return { title, start, end };
}

const kebab = (text) =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// Folder title keywords → the photo tags they imply, so same-day folders can
// be told apart. Explicit `tags` in album-folders.json win.
const KEYWORD_TAGS = [
  [/\b(fb|football|nfl)\b/i, ["football"]],
  [/\b(wbb|mbb|basketball)\b/i, ["basketball"]],
  [/\b(vb|volleyball)\b/i, ["volleyball"]],
  [/\b(msoc|wsoc|soccer)\b/i, ["soccer"]],
  [/\b(baseball|sb|wlax|lacrosse|wrestling|gymnastics|swim|run|runners|hockey|mile)\b/i, ["sports"]],
  [/\b(car show|cars?)\b/i, ["cars"]],
  [/\b(concert|music|jazz|choir|showcase|bash|post genre|supernova|blacklodge|clay coast|funky lamp|pitter patter|papercut|bonerama|teddy beats|thievery)\b/i, ["music"]],
  [/\b(otakon|cosplay)\b/i, ["cosplay"]],
  [/\b(game jam|esports)\b/i, ["esports"]],
  [/\b(headshots?|grad|portraits?|senior|photoshoot|silhouettes?|studio|shoot|selfies)\b/i, ["portraits"]],
];

export const hintTags = (title) => [...new Set(KEYWORD_TAGS.flatMap(([pattern, tags]) => (pattern.test(title) ? tags : [])))];

/**
 * Adds a folder entry for every override shoot album-folders.json doesn't
 * list (`2026 Photos/Otakon 2026`, `2022 Photos/2D Design/Photo/Blue 10-13`):
 * your overrides can define albums too. The last path segment is its name and
 * the rest its root; its year is its earliest photo's (`dayOf(id)` → YYYY-MM-DD
 * or null), else the path's `YYYY Photos`, else the current year.
 */
export function withOverrideFolders(json, manual, dayOf) {
  const listed = new Set(
    Object.entries(json).flatMap(([year, entries]) =>
      entries.map((entry) => `${rootOf(Number(year), entry)}/${typeof entry === "string" ? entry : entry.name}`),
    ),
  );
  const out = Object.fromEntries(Object.entries(json).map(([year, entries]) => [year, [...entries]]));
  for (const [shoot, ids] of Object.entries(manual)) {
    if (listed.has(shoot)) continue;
    const cut = shoot.lastIndexOf("/");
    if (cut < 1) throw new Error(`album-overrides.json: "${shoot}" needs a path, like "2026 Photos/Otakon 2026"`);
    const days = ids.map(dayOf).filter(Boolean).sort();
    const year = days[0]?.slice(0, 4) ?? shoot.match(/^(\d{4}) Photos\//)?.[1] ?? String(new Date().getFullYear());
    (out[year] ??= []).push({ name: shoot.slice(cut + 1), root: shoot.slice(0, cut) });
  }
  return out;
}

/**
 * `{ "2026": ["Amelia Harn Bookstore 5-30", { "name": "…", "tags": [...] }], … }`
 * → folders with unique slugs (`2026-amelia-harn-bookstore-0530`).
 */
export function parseFolders(json) {
  const used = new Set();
  return Object.entries(json).flatMap(([yearKey, entries]) => {
    const year = Number(yearKey);
    return entries.map((entry) => {
      const folder = typeof entry === "string" ? entry : entry.name;
      const parsed = parseFolderName(folder, year);
      const { title } = parsed;
      let { start, end, loose = false } = parsed;
      // Undated, but the NAS folder's creation day says roughly when: the two
      // weeks up to that import, only for days no dated folder claims.
      const approx = !start && typeof entry !== "string" && Boolean(entry.imported);
      if (approx) [start, end, loose] = [shiftDay(entry.imported, -14), entry.imported, true];
      let slug = `${year}-${kebab(title.replace(/\.\.\.$/, "")) || "untitled"}${parsed.start ? `-${parsed.start.slice(5).replace("-", "")}` : ""}`;
      // Same-named folders get -2, -3…, skipping any slug already handed out.
      for (let n = 2, base = slug; used.has(slug); n += 1) slug = `${base}-${n}`;
      used.add(slug);
      const tags = typeof entry === "string" || !entry.tags ? hintTags(title) : entry.tags;
      const root = rootOf(year, entry);
      return { slug, folder, title, year, root, primary: root === `${year} Photos`, start, end, loose, approx, tags };
    });
  });
}

const overlap = (a = [], b = []) => a.filter((tag) => b.includes(tag)).length;

/** The camera filename a Flickr original was made from: `_a730157jpg_…_o` and
 *  `_a734651-enhanced-nrjpg_…_o` → `_A730157`, `_A734651`; else null. */
export function cameraStem(file) {
  const title = typeof file === "string" ? file.match(/^(.*)_\d{8,}_o$/)?.[1] : null;
  const stem = title?.match(/^(_?[a-z]{1,4}_?\d{4,})/i)?.[1];
  return stem ? stem.toUpperCase() : null;
}

/** `/PhotoDrive/<root>/<shoot>/…/file` → `<root>/<shoot>`: anything nested in a
 *  shoot folder belongs to that one album. Files loose in a root give null. */
export function shootOf(path) {
  const match = typeof path === "string" ? path.match(/^\/PhotoDrive\/([^/]+)\/([^/]+)\//) : null;
  return match ? `${match[1]}/${match[2]}` : null;
}

// Where a folder lives on the NAS: its year folder, or a secondary root
// (`TPN Sophomore Year`), whose shoots lose ties to the year folders'.
const rootOf = (year, entry) => (typeof entry !== "string" && entry.root) || `${year} Photos`;

const nameKey = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
// Camera and phone names say nothing about the shoot: _A730157.jpg, DSC01234, IMG_1234.
const CAMERA_NAME = /^_?[a-z]{1,4}_?\d{4,}/i;

/**
 * A photo's own name, when it has one, as a match key: a titled Flickr
 * original (`pitt-volleyball-v-oregon_54200994529_o`) or a descriptive
 * public_id (`PulisCarShow-10_iww7ra`). Camera names and Cloudinary's random
 * ids (`fub3coia8qrcg5jlanrt`) give null.
 */
export function photoName(publicId, file) {
  const parts = photoWords(publicId, file);
  const key = parts ? parts.join("") : null;
  return key && key.length >= 5 ? key : null;
}

const words = (text) => text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word && !/^\d+$/.test(word));

/** photoName's words (`pitt-volleyball-v-oregon` → pitt, volleyball, v, oregon),
 *  for matching a name whose words all appear in a longer folder title. */
export function photoWords(publicId, file) {
  const flickrTitle = typeof file === "string" ? file.match(/^(.*)_\d{8,}_o$/)?.[1] : null;
  for (const raw of [flickrTitle, publicId]) {
    if (!raw || /^[a-z0-9]{20}$/.test(raw)) continue;
    const name = raw
      .replace(/_[a-z0-9]{6}$/, "") // Cloudinary's unique-filename suffix
      .replace(/jpe?g$/i, "")
      .replace(/[-_ ]\d+$/, ""); // a frame counter: -10, _3
    if (CAMERA_NAME.test(name)) continue;
    const parts = words(name);
    if (parts.join("").length >= 5) return parts;
  }
  return null;
}

/**
 * Matches photos to folders.
 * -2. Manual overrides come first; -1. NAS file hits (see below) next. Both are final.
 * 0. A photo whose own name (photoName) starts with a folder's title, or vice
 *    versa, goes there (`named`); several matching folders are split by date,
 *    else the most specific title takes it, flagged `ambiguous`.
 * 1. Dated photos go to the folder whose date (range) holds their capture day;
 *    a photo taken before 5am also tries the day before (late shows). Open
 *    ranges (`8-14 t...`) only catch days no exact folder claims.
 *    No folder that day: one dated the day before or after (`nearby`, flagged).
 * 2. Same-day folders are split by how many of the photo's tags the folder's
 *    hint tags share; a tie is `ambiguous` (kept on the first, flagged).
 * 3. Undated photos inherit an album when the nearest dated photos on both
 *    sides in upload order are in that album and share a tag (`inferred`).
 * `photos`: { public_id, tags, created_at, taken, file } with `taken` EXIF or
 * null and `file` the original filename.
 */
export function proposeAlbums(folders, photos, { nasHits = {}, manual = {} } = {}) {
  const assignment = new Map(); // public_id → { slug, how }
  const settled = new Set(); // NAS knows where the file lives: no guessing after
  const byShoot = new Map(folders.map((folder) => [`${folder.root}/${folder.folder}`, folder]));

  // -2. Your own calls (scripts/album-overrides.json: "<root>/<shoot>" → ids)
  //     win over everything and survive every re-run.
  for (const [shoot, ids] of Object.entries(manual)) {
    const folder = byShoot.get(shoot);
    if (!folder) throw new Error(`album-overrides.json: no shoot folder "${shoot}" in album-folders.json`);
    for (const id of ids) {
      assignment.set(id, { slug: folder.slug, how: "manual" });
      settled.add(id);
    }
  }

  // -1. The photo's camera file on the NAS (nasHits: stem → paths). Counters
  //     roll over, so a stem can sit in several shoots; the one whose date
  //     (±1 day) fits the photo wins (`nas`). Found only outside the year
  //     folders (e.g. TPN Sophomore Year), the photo stays unassigned.
  const fits = (folder, day) => folder.start && shiftDay(folder.start, -1) <= day && day <= shiftDay(folder.end, 1);
  for (const photo of photos) {
    if (settled.has(photo.public_id)) continue;
    const hits = nasHits[cameraStem(photo.file)];
    if (!hits?.length) continue;
    const shoots = [...new Set(hits.map(shootOf).filter(Boolean))].map((key) => byShoot.get(key)).filter(Boolean);
    const day = captureDay(photo.taken);
    let fitting = day ? shoots.filter((folder) => fits(folder, day)) : shoots;
    // Nothing dated fits: an undated shoot holding the file can't be ruled out.
    if (!fitting.length) fitting = shoots.filter((folder) => !folder.start);
    if (fitting.length === 1) assignment.set(photo.public_id, { slug: fitting[0].slug, how: "nas" });
    settled.add(photo.public_id);
  }
  const within = (day, loose) =>
    folders.filter((folder) => folder.start && folder.loose === loose && folder.start <= day && day <= folder.end);
  // Exact folders (the photo's day, then the night before) beat open ranges.
  const candidatesFor = (day, late) =>
    [[day, false], ...(late ? [[shiftDay(day, -1), false]] : []), [day, true], ...(late ? [[shiftDay(day, -1), true]] : [])]
      .map(([d, loose]) => within(d, loose))
      .find((found) => found.length) ?? [];

  const titled = folders
    .map((folder) => ({ folder, key: nameKey(folder.title.replace(/\.\.\.$/, "")), words: new Set(words(folder.title)) }))
    .filter(({ key }) => key.length >= 5);
  for (const photo of photos) {
    if (settled.has(photo.public_id)) continue;
    const name = photoName(photo.public_id, photo.file);
    if (!name) continue;
    // A prefix either way (`PulisCarShow` / "Puli's Car Show"), or every word
    // of a longer name in the title (`pitt-volleyball-v-oregon`).
    const parts = photoWords(photo.public_id, photo.file);
    const matches = titled.filter(
      ({ key, words: title }) =>
        name.startsWith(key) || key.startsWith(name) || (parts.length >= 3 && parts.every((part) => title.has(part))),
    );
    if (!matches.length) continue;
    const day = captureDay(photo.taken);
    const onDay = day ? matches.filter(({ folder }) => folder.start && folder.start <= day && day <= folder.end) : [];
    // Dated, a same-named folder from another year is out (two Supernovas).
    const sameYear = day ? matches.filter(({ folder }) => folder.year === Number(day.slice(0, 4))) : [];
    let pool = onDay.length ? onDay : sameYear.length ? sameYear : matches;
    // `sophia` fits two Sophia Brush shoots but was taken on "Sophie 1-28"'s
    // day: a dated photo no name match can settle is left to its date.
    if (day && !onDay.length && pool.length > 1) continue;
    // A year folder beats a secondary root's same-named shoot.
    const primary = pool.filter(({ folder }) => folder.primary);
    if (primary.length === 1 && pool.length > 1) pool = primary;
    const pick = [...pool].sort((a, b) => b.key.length - a.key.length)[0];
    // `amelia` fits every Amelia Harn shoot: without a date to settle it, flag it.
    assignment.set(photo.public_id, { slug: pick.folder.slug, how: pool.length === 1 ? "named" : "ambiguous" });
  }

  for (const photo of photos) {
    if (assignment.has(photo.public_id) || settled.has(photo.public_id)) continue;
    const day = captureDay(photo.taken);
    if (!day) continue;
    let candidates = candidatesFor(day, captureHour(photo.taken) < 5);
    let near = false;
    if (!candidates.length) {
      // Folders are often named for the day after (or before) the shoot.
      candidates = [...within(shiftDay(day, -1), false), ...within(shiftDay(day, 1), false)];
      near = true;
    }
    if (!candidates.length) continue;
    if (candidates.length === 1) {
      assignment.set(photo.public_id, { slug: candidates[0].slug, how: near || candidates[0].approx ? "nearby" : "dated" });
      continue;
    }
    // Same-day folders: tags, and words of the photo's own name (`ls-climbing-club`).
    const parts = photoWords(photo.public_id, photo.file) ?? [];
    const scored = candidates.map((folder) => ({
      folder,
      score: overlap(folder.tags, photo.tags) + 2 * overlap(parts, words(folder.title)),
    }));
    const best = Math.max(...scored.map(({ score }) => score));
    const winners = scored.filter(({ score }) => score === best);
    assignment.set(photo.public_id, {
      slug: winners[0].folder.slug,
      how: winners.length === 1 && best > 0 ? (near ? "nearby" : "dated") : "ambiguous",
    });
  }

  const ordered = [...photos].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.public_id.localeCompare(b.public_id));
  const anchors = ordered.map((photo) => (["manual", "nas", "dated", "named"].includes(assignment.get(photo.public_id)?.how) ? photo : null));
  const nearest = (index, step) => {
    for (let i = index + step; i >= 0 && i < ordered.length; i += step) if (anchors[i]) return anchors[i];
    return null;
  };
  ordered.forEach((photo, index) => {
    if (assignment.has(photo.public_id) || settled.has(photo.public_id) || captureDay(photo.taken)) return;
    const before = nearest(index, -1);
    const after = nearest(index, 1);
    if (!before || !after) return;
    const slug = assignment.get(before.public_id).slug;
    if (assignment.get(after.public_id).slug !== slug) return;
    if (!overlap(photo.tags, before.tags) && !overlap(photo.tags, after.tags)) return;
    assignment.set(photo.public_id, { slug, how: "inferred" });
  });

  const albums = folders
    .map((folder) => ({
      slug: folder.slug,
      title: folder.title,
      folder: folder.folder,
      year: folder.year,
      date: folder.approx ? null : folder.start, // an import window is no date: the photos give it
      photos: ordered
        .filter((photo) => assignment.get(photo.public_id)?.slug === folder.slug)
        .map((photo) => ({ id: photo.public_id, how: assignment.get(photo.public_id).how })),
    }))
    .sort((a, b) => b.photos.length - a.photos.length || b.year - a.year);

  return {
    albums,
    unassigned: ordered.filter((photo) => !assignment.has(photo.public_id)).map((photo) => photo.public_id),
  };
}

/**
 * Albums shown on the site: ≥ MIN_ALBUM_PHOTOS kept photos, newest first.
 * Each keeps its photo ids in capture order (undated last); the site looks
 * the photos up in Cloudinary by id, so nothing is tagged there. Previews
 * are the first three, as delivery URLs (`taken`: public_id → EXIF-form date).
 */
export function siteAlbums(proposal, taken, cloudName) {
  return proposal.albums
    .map((album) => {
      const ids = album.photos
        .filter(({ how }) => KEPT.has(how))
        .map(({ id }) => id)
        .map((id, order) => ({ id, order, when: captureDay(taken[id]) ? taken[id] : null }))
        .sort((a, b) => (a.when && b.when ? a.when.localeCompare(b.when) : a.when ? -1 : b.when ? 1 : 0) || a.order - b.order)
        .map(({ id }) => id);
      const days = ids.map((id) => captureDay(taken[id])).filter(Boolean).sort();
      return {
        slug: album.slug,
        title: album.title,
        date: album.date ?? days[0] ?? null,
        year: album.year,
        count: ids.length,
        photos: ids,
        preview: ids.slice(0, 3).map((id) => ({
          public_id: id,
          secure_url: `https://res.cloudinary.com/${cloudName}/image/upload/${id}`,
        })),
      };
    })
    .filter((album) => album.count >= MIN_ALBUM_PHOTOS)
    .sort((a, b) => (b.date ?? `${b.year}-01-01`).localeCompare(a.date ?? `${a.year}-01-01`) || a.title.localeCompare(b.title));
}

const yamlString = (text) => JSON.stringify(text); // a JSON string is a valid YAML scalar

/**
 * A rebuilt album over its existing YAML: the file owns title, year and date
 * (edit them freely); the build only refreshes photos and count.
 */
export function mergeAlbum(built, existing) {
  if (!existing) return built;
  const pick = (key) => (existing[key] === undefined ? built[key] : existing[key]);
  return { ...built, title: pick("title"), year: pick("year"), date: pick("date") };
}

/** One album as its content-collection YAML (src/content/albums/<slug>.yaml). */
export function albumYaml({ title, year, date, count, photos }) {
  return [
    "# title, year and date are yours to edit; `npm run photos:albums -- build` keeps them",
    "# and refreshes only photos and count (from scripts/album-proposal.json).",
    `title: ${yamlString(title)}`,
    `year: ${year}`,
    `date: ${date ?? "null"}`,
    `count: ${count}`,
    "photos:",
    ...photos.map((id) => `  - ${yamlString(id)}`),
    "",
  ].join("\n");
}
