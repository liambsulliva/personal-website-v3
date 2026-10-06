import { getCollection, type CollectionEntry } from "astro:content";

const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const FULL_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** ArticleCard meta: "Logo • Oct 2024" */
export const pieceMeta = (kind: string | undefined, date: Date, full = false) =>
  [kind, (full ? FULL_DATE : MONTH_YEAR).format(date)].filter(Boolean).join(" • ");

const byOrderThenDate = (a: CollectionEntry<"pieces">, b: CollectionEntry<"pieces">) =>
  a.data.order - b.data.order || a.data.date.getTime() - b.data.date.getTime();

export async function getPieces(gallery: "design" | "writing") {
  const pieces = await getCollection("pieces", ({ data }) => data.gallery === gallery);
  return pieces.sort(byOrderThenDate);
}

export async function getProjects(wing: "engineering" | "design") {
  const projects = await getCollection("projects", ({ data }) => data.wing === wing);
  return projects.sort((a, b) => a.data.order - b.data.order);
}

/**
 * Each wing's page leads with one FeaturedArticle: the first entry (in page
 * order) flagged `featured`. It's pulled out of the regular lists so it
 * never shows twice.
 */
export function splitFeatured<T extends { data: { featured: boolean } }>(entries: T[]) {
  const featured = entries.find((entry) => entry.data.featured);
  return { featured, rest: entries.filter((entry) => entry !== featured) };
}

/** A project with an MDX body is a write-up; otherwise the card is outbound. */
export const hasWriteup = (project: CollectionEntry<"projects">) =>
  Boolean(project.body && project.body.trim().length > 0);

export const projectHref = (project: CollectionEntry<"projects">) =>
  hasWriteup(project)
    ? `/${project.data.wing}/${project.id}`
    : (project.data.demo ?? project.data.github ?? "#");
