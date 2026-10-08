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
    badges: z.array(z.string()).default([]), // tools used on the job
  }),
});

export const WINGS = ["engineering", "design", "writing"] as const;
export const LAYOUTS = ["list", "grid-3", "grid-2-wide", "hero", "feed"] as const;

/**
 * Entries: everything on /engineering, /design and /writing. Each one sits in
 * a section of its wing's page, and the section's layout decides which card it
 * renders as. A body is a write-up at /<wing>/<slug>; no body ⇒ the card links
 * to `href` (or `github`). Every field is open to every entry; the layouts
 * use what they need. Images are Cloudinary public_ids.
 */
const entries = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/entries" }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    wing: z.enum(WINGS),
    section: z.string(), // a `key` in src/content/sections/<wing>.yaml
    kind: z.string().optional(), // meta label: "Case Study", "Logo", "Blog", …
    date: z.coerce.date().optional(),
    href: z.string().optional(), // card link without a write-up; the write-up's demo button with one
    external: z.boolean().default(true),
    github: z.string().url().optional(),
    image: z.string().optional(),
    hero: z.string().optional(), // write-up hero when different from image
    heroFit: z.enum(["cover", "contain"]).default("cover"), // contain: transparent art, no crop or frame
    badges: z.array(z.string()).default([]), // cards show the first three
    languages: z
      .array(z.object({ name: z.string(), pct: z.number() }))
      .optional(), // Figma LanguageBar; omit component if empty
    role: z.array(z.string()).optional(),
    team: z.array(z.string()).optional(),
    tools: z.array(z.string()).optional(),
    timeline: z.array(z.string()).optional(),
    subtitle: z.string().optional(),
    featured: z.boolean().default(false), // the FeaturedArticle atop its wing's page (one per page)
  }),
});

/** Sections: one file per wing (sections/<wing>.yaml), top to bottom. */
const sections = defineCollection({
  loader: glob({ pattern: "*.{yaml,yml}", base: "./src/content/sections" }),
  schema: z.object({
    sections: z
      .array(
        z.object({
          key: z.string().regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/),
          heading: z.string(), // "" renders no label
          layout: z.enum(LAYOUTS),
          sort: z.enum(["custom", "oldest", "newest"]).default("custom"),
          order: z.array(z.string()).default([]), // custom order (entry slugs)
        }),
      )
      .refine((list) => new Set(list.map((s) => s.key)).size === list.length, { message: "section keys must be unique" }),
  }),
});

/**
 * Albums: one per photo-shoot folder on the NAS, for the /photography stacks.
 * The source of truth: title, year and date are edited here by hand, and
 * `npm run photos:albums -- build` keeps them, refreshing only photos and count.
 * The photos are Cloudinary public_ids in capture order; the first three are
 * the stack's cards.
 */
const albums = defineCollection({
  loader: glob({ pattern: "**/*.{yaml,yml}", base: "./src/content/albums" }),
  schema: z
    .object({
      title: z.string(),
      year: z.number().int(),
      date: z.coerce.date().nullable(), // null: nothing in the album is dated, the label shows the year
      count: z.number().int().positive(),
      photos: z.array(z.string()).min(1),
    })
    .refine((album) => album.count === album.photos.length, { message: "count must match photos" }),
});

export const collections = { career, entries, sections, albums };
