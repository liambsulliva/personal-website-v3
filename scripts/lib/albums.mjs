// Pure album logic for scripts/photo-albums.mjs: folder-name parsing, photo
// matching and the generated src/data/albums.ts. No I/O, so it's unit-tested
// in tests/lib/albums.test.ts.

export const MIN_ALBUM_PHOTOS = 5;
export const albumTag = (slug) => `_album-${slug}`;

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
  let name = raw.replace(/□/g, "-").replace(/…/g, "...").trim();
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
 * `{ "2026": ["Amelia Harn Bookstore 5-30", { "name": "…", "tags": [...] }], … }`
 * → folders with unique slugs (`2026-amelia-harn-bookstore-0530`).
 */
export function parseFolders(json) {
  const used = new Set();
  return Object.entries(json).flatMap(([yearKey, entries]) => {
    const year = Number(yearKey);
    return entries.map((entry) => {
      const folder = typeof entry === "string" ? entry : entry.name;
      const { title, start, end, loose = false } = parseFolderName(folder, year);
      let slug = `${year}-${kebab(title.replace(/\.\.\.$/, "")) || "untitled"}${start ? `-${start.slice(5).replace("-", "")}` : ""}`;
      // Same-named folders get -2, -3…, skipping any slug already handed out.
      for (let n = 2, base = slug; used.has(slug); n += 1) slug = `${base}-${n}`;
      used.add(slug);
      const tags = typeof entry === "string" || !entry.tags ? hintTags(title) : entry.tags;
      return { slug, folder, title, year, start, end, loose, tags };
    });
  });
}

const overlap = (a = [], b = []) => a.filter((tag) => b.includes(tag)).length;

/**
 * Matches photos to folders.
 * 1. Dated photos go to the folder whose date (range) holds their capture day;
 *    a photo taken before 5am also tries the day before (late shows). Open
 *    ranges (`8-14 t...`) only catch days no exact folder claims.
 * 2. Same-day folders are split by how many of the photo's tags the folder's
 *    hint tags share; a tie is `ambiguous` (kept on the first, flagged).
 * 3. Undated photos inherit an album when the nearest dated photos on both
 *    sides in upload order are in that album and share a tag (`inferred`).
 * `photos`: { public_id, tags, created_at, taken } with `taken` EXIF or null.
 */
export function proposeAlbums(folders, photos) {
  const assignment = new Map(); // public_id → { slug, how }
  const within = (day, loose) =>
    folders.filter((folder) => folder.start && folder.loose === loose && folder.start <= day && day <= folder.end);
  // Exact folders (the photo's day, then the night before) beat open ranges.
  const candidatesFor = (day, late) =>
    [[day, false], ...(late ? [[shiftDay(day, -1), false]] : []), [day, true], ...(late ? [[shiftDay(day, -1), true]] : [])]
      .map(([d, loose]) => within(d, loose))
      .find((found) => found.length) ?? [];

  for (const photo of photos) {
    const day = captureDay(photo.taken);
    if (!day) continue;
    const candidates = candidatesFor(day, captureHour(photo.taken) < 5);
    if (!candidates.length) continue;
    if (candidates.length === 1) {
      assignment.set(photo.public_id, { slug: candidates[0].slug, how: "dated" });
      continue;
    }
    const scored = candidates.map((folder) => ({ folder, score: overlap(folder.tags, photo.tags) }));
    const best = Math.max(...scored.map(({ score }) => score));
    const winners = scored.filter(({ score }) => score === best);
    assignment.set(photo.public_id, {
      slug: winners[0].folder.slug,
      how: winners.length === 1 && best > 0 ? "dated" : "ambiguous",
    });
  }

  const ordered = [...photos].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.public_id.localeCompare(b.public_id));
  const anchors = ordered.map((photo) => (assignment.get(photo.public_id)?.how === "dated" ? photo : null));
  const nearest = (index, step) => {
    for (let i = index + step; i >= 0 && i < ordered.length; i += step) if (anchors[i]) return anchors[i];
    return null;
  };
  ordered.forEach((photo, index) => {
    if (assignment.has(photo.public_id) || captureDay(photo.taken)) return;
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
      date: folder.start,
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

/** Albums shown on the site: ≥ MIN_ALBUM_PHOTOS photos, newest first. */
export function siteAlbums(proposal, byId, exif) {
  return proposal.albums
    .map((album) => {
      const photos = album.photos.map(({ id }) => byId.get(id)).filter(Boolean);
      const days = photos.map((photo) => captureDay(exif[photo.public_id])).filter(Boolean).sort();
      return {
        slug: album.slug,
        title: album.title,
        date: album.date ?? days[0] ?? null,
        year: album.year,
        count: photos.length,
        preview: photos.slice(0, 3).map(({ public_id, secure_url, width, height }) => ({ public_id, secure_url, width, height })),
      };
    })
    .filter((album) => album.count >= MIN_ALBUM_PHOTOS)
    .sort((a, b) => (b.date ?? `${b.year}-01-01`).localeCompare(a.date ?? `${a.year}-01-01`) || a.title.localeCompare(b.title));
}

export function toAlbumsModule(proposal, byId, exif) {
  return `// Generated by \`npm run photos:albums -- apply\` from scripts/album-proposal.json.
// Don't edit by hand: change titles or membership in the proposal and re-run apply.
import type { Album } from "../lib/albums";

export const ALBUMS: Album[] = ${JSON.stringify(siteAlbums(proposal, byId, exif), null, 2)};
`;
}
