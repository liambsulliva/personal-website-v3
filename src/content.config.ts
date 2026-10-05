import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

/** Career: rendered as Figma TimelineRow (35:370). */
const career = defineCollection({
  loader: glob({ pattern: "**/*.{md,yaml,yml}", base: "./src/content/career" }),
  schema: z.object({
    kind: z.enum(["experience", "education"]),
    company: z.string(),
    role: z.string(),
    dates: z.string(),
    // Figma's Education row renders "Pitt", so 4 rather than 2.
    monogram: z.string().max(4).optional(),
    logo: z.string().optional(), // Cloudinary public_id (site/career/*)
    // One-color wordmark that disappears on the dark field: render it white there.
    whiteLogoOnDark: z.boolean().default(false),
    href: z.string().url(),
    order: z.number().default(0),
  }),
});

/**
 * Projects: one collection for both wings. A body is a write-up; no body ⇒
 * the card is outbound only (external icon). Images are Cloudinary public_ids
 * (see scripts/cloudinary-map.mjs).
 */
const projects = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/projects" }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    wing: z.enum(["engineering", "design"]),
    image: z.string(),
    hero: z.string().optional(), // write-up hero when different from image
    heroFit: z.enum(["cover", "contain"]).default("cover"), // contain: transparent art, no crop
    badges: z.array(z.string()).max(3),
    languages: z
      .array(z.object({ name: z.string(), pct: z.number() }))
      .optional(), // Figma LanguageBar; omit component if empty
    github: z.string().url().optional(),
    demo: z.string().optional(),
    role: z.array(z.string()).optional(),
    team: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    timeline: z.array(z.string()).optional(),
    subtitle: z.string().optional(),
    order: z.number().default(0),
  }),
});

/** Pieces: ArticleCard data for /design and /writing. */
const pieces = defineCollection({
  loader: glob({ pattern: "**/*.{md,yaml,yml}", base: "./src/content/pieces" }),
  schema: z.object({
    title: z.string(),
    gallery: z.enum(["design", "writing"]),
    section: z.enum([
      "graphic-design",
      "layouts",
      "design-club",
      "featured",
      "substack",
      "video",
      "berlin",
    ]),
    date: z.coerce.date(),
    href: z.string(),
    external: z.boolean().default(true),
    image: z.string().optional(),
    description: z.string().optional(), // featured dek
    kind: z.string().optional(), // meta label: "Logo", "Cover", "Blog", …
    order: z.number().default(0),
  }),
});

export const collections = { career, projects, pieces };
