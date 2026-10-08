import { getCollection, getEntry, type CollectionEntry } from "astro:content";

export type Wing = "engineering" | "design" | "writing";
export type Entry = CollectionEntry<"entries">;
export type SectionConfig = CollectionEntry<"sections">["data"]["sections"][number];
export type Section = SectionConfig & { entries: Entry[] };

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const FULL_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** ArticleCard meta: "Logo • Oct 2024" */
export const pieceMeta = (kind: string | undefined, date: Date | undefined, full = false) =>
  [kind, date && (full ? FULL_DATE : MONTH_YEAR).format(date)].filter(Boolean).join(" • ");

/** Every card's meta line: kind and month, or the first three badges when there's neither. */
export const entryMeta = (entry: Entry) =>
  pieceMeta(entry.data.kind, entry.data.date) || entry.data.badges.slice(0, 3).join(" • ");

/** An entry with an MDX body is a write-up; otherwise its card is outbound. */
export const hasWriteup = (entry: Entry) => Boolean(entry.body && entry.body.trim().length > 0);

export const entryHref = (entry: Entry) =>
  hasWriteup(entry) ? `/${entry.data.wing}/${entry.id}` : (entry.data.href ?? entry.data.github ?? "#");

/** Opens in a new tab: outbound links only, never a write-up or a site path. */
export const isExternal = (entry: Entry) =>
  !hasWriteup(entry) && entry.data.external && !entryHref(entry).startsWith("/");

const time = (entry: Entry) => entry.data.date?.getTime();

/** Undated entries sort after dated ones in either direction. */
const byDate = (direction: 1 | -1) => (a: Entry, b: Entry) => {
  const ta = time(a);
  const tb = time(b);
  if (ta === undefined || tb === undefined) return (ta === undefined ? 1 : 0) - (tb === undefined ? 1 : 0);
  return (ta - tb) * direction;
};

/** A section's entries in its chosen order. Custom order lists slugs; the rest follow, newest first. */
export function sortSection(section: SectionConfig, entries: Entry[]) {
  if (section.layout === "feed" || section.sort === "newest") return [...entries].sort(byDate(-1));
  if (section.sort === "oldest") return [...entries].sort(byDate(1));
  const rank = new Map(section.order.map((slug, i) => [slug, i]));
  const listed = entries.filter((e) => rank.has(e.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...listed, ...entries.filter((e) => !rank.has(e.id)).sort(byDate(-1))];
}

/**
 * A wing page: its sections in order with their entries, and the one
 * FeaturedArticle that leads it — the first entry (in page order) flagged
 * `featured`, pulled out of its section so it never shows twice.
 */
export async function getWing(wing: Wing) {
  const [entries, config] = await Promise.all([
    getCollection("entries", ({ data }) => data.wing === wing),
    getEntry("sections", wing),
  ]);
  const configs = config?.data.sections ?? [];
  const keys = new Set(configs.map((s) => s.key));
  const stray = entries.filter((e) => !keys.has(e.data.section));
  if (stray.length) {
    throw new Error(
      `Entries in sections that don't exist on /${wing}: ${stray.map((e) => `${e.id} (${e.data.section})`).join(", ")}`,
    );
  }
  const sections = configs.map((s) => ({ ...s, entries: sortSection(s, entries.filter((e) => e.data.section === s.key)) }));
  const featured = sections.flatMap((s) => s.entries).find((e) => e.data.featured);
  return {
    featured,
    sections: sections.map((s) => ({ ...s, entries: s.entries.filter((e) => e !== featured) })),
  };
}

/** Write-up routes for one wing's [slug] page. */
export async function writeupPaths(wing: Wing) {
  const entries = await getCollection("entries", ({ data }) => data.wing === wing);
  return entries.filter(hasWriteup).map((entry) => ({ params: { slug: entry.id }, props: { entry } }));
}
