# personal-website-v3 architecture delta

Contract for the next implementation pass. **Figma defines layout and component needs. It does not author content.** Content, APIs, and islands come from frozen **personal-website-v2** as mapped below.

- **v2 repo (frozen):** `/Users/liambsulliva/Developer/personal-website-v2`
- **v3 repo (this tree):** `/Users/liambsulliva/Developer/personal-website-v3`
- **Figma:** [personal-website-v3](https://www.figma.com/design/qG8iY9Elr0VlGXyjC84hSX) (`fileKey` `qG8iY9Elr0VlGXyjC84hSX`)
- **Live v2 after freeze:** `https://v2.liambsullivan.com`
- **Live v1:** `https://v1.liambsullivan.com`
- **Apex promotion** (`liambsullivan.com` → v3) is out of scope here. Liam promotes on his own time.

Do not implement until you treat this file as law. Do not copy v2’s information architecture, homepage, or client-fetch CMS.

---

## 1. Locked decisions

| Topic | Decision |
| --- | --- |
| Delivery | New v3 repo. v2 is frozen as a product. |
| Figma | Chrome, tokens, layout, component inventory. Not copy. |
| CMS | Astro content collections + Zod. Write-ups are MDX. `/me` is static `.astro` text, not MDX and not a collection. |
| `/other-work` | Deleted as a route. Split into Design + Writing. Cooking stays out. |
| Stack | Astro 5 + React islands. Keep Svelte only for `Book.svelte`. Port Switch HUD to Astro. |
| Dashboard | **Not in this repo.** Separate repo later. |
| Photography data | Read-only Cloudinary in v3. SSR first carousel + first masonry page. |
| Live feeds | No build-time WP loaders. Server fetch with `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`. |
| Theme | Real light/dark via Tailwind colors + reusable CSS vars. Light default. |
| Versions | Expanded Logomark: v3 current (no nav). v2 → `https://v2.liambsullivan.com`. v1 → `https://v1.liambsullivan.com`. Do not patch frozen v2. |
| Switch embed | Copy `public/switch-menu` + RAWG proxy. Retarget `switch-react-menu` GitHub Action `MAIN_SITE_REPO` to this repo. |
| Motion | See **§15**. MPA stays instant. Zap = reduce JS / no decorative motion. Figma has no keyframe timelines. |

---

## 2. How v2 was built (the problem)

v2 is a **static Astro site that fetches its own CMS in the browser**.

| Area | Where it was | What was wrong |
| --- | --- | --- |
| Document shell | `src/layouts/Layout.astro` | Head + dark-only `:root` hex. No header, footer, nav, or theme. |
| Page chrome | Reimplemented per route | Footer missing on photography/dashboard/404. BackLink + margins copied. |
| Landing | `src/pages/index.astro` + `src/ui/*` | Long hash page. About/Projects/UX/Photo/Extracurriculars are not routes. |
| Nav | `src/components/SideBar.astro` | Fixed 1375px “CONTENTS” hash list, hidden &lt;1400px. |
| Case studies | 500–680 line `.astro` pages | Prose trapped in components. `CaseStudyLayout` welded to 1150px + SideBar. |
| Cards | `src/ui/Projects.astro` hardcoded | Duplicates write-up metadata. `Card.astro` ignores `viewBtn`. |
| CMS | Only `otherWork` markdown | About, projects, career, write-ups not in collections. |
| WordPress | `WordpressFetcher.tsx` `useEffect` + `client:load` | Empty grid until JS. |
| Photos | `CloudinaryCarousel` / `CloudinaryFetcher` mount fetch | Home waits for `client:visible` then API. `/photography` hydrates the whole gallery immediately. |
| Dashboard | `/dashboard` + mutating Cloudinary APIs | Private tool mixed into the marketing site. **Leave it out of v3.** |
| Naming | `Cloudinary*`, two Footers, two Badges, `DiceIcon`, `Loader` | Fetcher ≠ gallery. `ui/` is homepage sections, not a design system. |
| Runtimes | Astro + React + Svelte | Svelte only for Book + Switch HUD. |
| Dead weight | `components/Footer.astro`, `RedDotDemo*`, unlinked `bridge-app.astro` | Duplicate / unused / orphan. |

v3 is the opposite IA: **lobby index + wings**. Same Cloudinary cloud, same write-up words, new chrome.

---

## 3. Routes

Figma frames (implement layout from these; populate from v2 / collections):

| Route | Figma frame | Node |
| --- | --- | --- |
| `/` | Desktop Index Light / Dark, Mobile Index | `16:173`, `17:489`, `18:324`, `19:488` |
| `/me` | Subpage / Me | `28:940` |
| `/career` | Subpage / Career | `35:1252` |
| `/engineering` | Subpage / Engineering | `24:329` |
| `/engineering/[slug]` | Subpage / Write-up / Invisible Hand (template) | `51:1374` |
| `/design` | Subpage / Design | `53:3354` |
| `/design/[slug]` | Same write-up template | `51:1374` |
| `/photography` | Subpage / Photography | `25:464` |
| `/writing` | Subpage / Writing | `28:811` |
| `/404` | 404 | `104:3410` |
| Mobile nav | Mobile Menu | `33:1236` |

There is **no** `/dashboard`, `/other-work`, `/projects/*`, or `/ux/*` as product routes. Old paths 301 (see §11).

Lobby `/` is nav only: stair-step `NavLink`s (Me, Career, Engineering, Design, Photography, Writing), theme + motion `IconButton`s, socials, collapsed `Logomark`, `Timer`. **No in-page sections.**

---

## 4. Layouts (was → change)

| v2 | v3 |
| --- | --- |
| `Layout.astro` = html/head + dark `:root` | **Root layout:** fonts, meta, theme script (no FOUC), CSS vars for light **and** dark, Tailwind `darkMode: 'class'`. Slot only. |
| No shared subpage chrome | **`SubpageLayout`:** Figma `SubpageHeader` (section variant) + slot + `SubpageFooter` (Logomark + Timer). |
| `CaseStudyLayout.astro` 1150px + hash SideBar + 3-col meta + Footer | **`WriteupLayout`:** Figma write-up. Hero, badges, GitHub/demo `WriteupButton`s, Role/Team/Timeline, **760px** article column, TOC from MDX headings, footer. Keep a named slot for islands. |
| `index.astro` owns landing CSS (1150px, fade-in, section-labels) | **`HomeLayout` / lobby page:** Figma index. Delete hash sections and `IntersectionObserver` fade-in. |
| `layouts/Footer.astro` vs unused `components/Footer.astro` | One `SubpageFooter`. Delete the duplicate. |
| Photography / 404 omit footer | Every public subpage uses `SubpageFooter`. |

Do not port `SideBar.astro`. Replace with Figma `NavLink` (lobby stair-step) and `CompactNavIcon` (subpage / mobile). Write-up TOC is the Figma `Contents` column, generated from MDX `h2`s, not SideBar.

---

## 5. Content model

### 5.1 `/me` — static Astro (no MDX, no collection)

**Was:** `src/ui/Background.astro` (three paragraphs, Nikon D200 / CS / DNID / PNC links).

**Change:** `src/pages/me.astro` (or a small component it imports) with that copy inlined. Figma portrait is a new local asset. Optional inline chips (`<Mark>`) only if cheap; do **not** recreate Figma’s per-word spans.

### 5.2 Collections + Zod (everything else that is authored)

Define in `src/content.config.ts`. Names below are law.

#### `career`

**Was:** no route. One sentence in About. `src/components/Timeline.astro` is a **Switch case-study phase list** — do not reuse it.

**Change:** entries rendered as Figma `TimelineRow` (`35:370`).

```ts
z.object({
  kind: z.enum(["experience", "education"]),
  company: z.string(),
  role: z.string(),
  dates: z.string(),
  monogram: z.string().max(4).optional(), // Figma Education row uses "Pitt"
  logo: z.string().optional(), // Cloudinary public_id (site/career/*)
  whiteLogoOnDark: z.boolean().default(false), // one-color marks (Pitt) render white in dark mode
  href: z.string().url(),
  order: z.number().default(0),
})
```

Author new YAML/MD files. There is no v2 body to extract.

#### `projects` (MDX)

**Was:** hardcoded cards in `src/ui/Projects.astro` + prose in `src/pages/projects/*.astro` and `src/pages/ux/kingdra-case-study.astro`.

**Change:** one collection. Index pages filter on `wing`. A body is a write-up; no body ⇒ card is outbound only (`external` icon).

```ts
z.object({
  title: z.string(),
  description: z.string(),
  wing: z.enum(["engineering", "design"]),
  image: z.string(),
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
})
```

Slug = filename. MDX body uses Figma slots via components: `SectionHeading`, `Callout`, `CaptionedFigure`, `CodeBlock`, plus islands in §7.

**Extract MDX from these v2 files (get the text out of `.astro`):**

| v3 slug | wing | v2 source |
| --- | --- | --- |
| `kingdra-app` | engineering | `src/pages/projects/kingdra-app.astro` |
| `switch-react-menu` | engineering | `src/pages/projects/switch-react-menu.astro` |
| `herl-app` | engineering | `src/pages/projects/herl-app.astro` |
| `the-invisible-hand-of-ux` | engineering | `src/pages/projects/the-invisible-hand-of-ux.astro` |
| `bridge-app` | engineering | `src/pages/projects/bridge-app.astro` (un-orphan) |
| `kingdra-case-study` | design | `src/pages/ux/kingdra-case-study.astro` |

**Card-only (no v2 write-up; author frontmatter only):**

| slug | wing | Figma card on Engineering |
| --- | --- | --- |
| `claudia-cooks` | engineering | Claudia Cooks |
| `how-expensive-is-fruit` | engineering | How Expensive is Fruit? |
| `compression-wars` | engineering | Compression Wars |

Kingdra is **two entries**: app on Engineering, Journey to Mobile on Design.

#### `pieces`

**Was:** `src/content/other-work/**/*.md` + `other-work.astro` junk drawer + client WP.

**Change:** ArticleCard data. No `/other-work`.

```ts
z.object({
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
  order: z.number().default(0),
})
```

**Migrate from v2 `otherWork`:**

| v2 path prefix | v3 `gallery` / `section` |
| --- | --- |
| `graphic-design/` | design / graphic-design |
| `layouts/` | design / layouts |
| `design-club/` | design / design-club |
| `personal/` | writing / substack |
| `cooking/` | **drop** |

**Writing Featured** is a `section: featured` piece (or `featured: true` on one substack entry — pick one and stick to it). **Video essays** have no v2 source; leave the Figma section empty until authored.

**Berlin** is **not** a collection loader. `/writing` SSR-fetches

`https://public-api.wordpress.com/rest/v1.1/sites/pittbusinesstotheworld.com/posts/?tag=liam-sullivan`

and sets `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`. Map to ArticleCard fields (`title` stripped of HTML, `date`, `href`, `image`). Do **not** port `WordpressFetcher.tsx`.

Photography is **not** a collection.

---

## 6. Component map (Figma name is the v3 name)

Build from Figma components on page `0:1`. Restyle; do not keep v2 dark hex as the source of truth.

| Figma | v2 analog | Verdict |
| --- | --- | --- |
| `NavLink` | `SideBar.astro` | **New.** Stair-step sections Me→Writing, states Default/Hover/Active. |
| `CompactNavIcon` | none | **New.** Subpage / mobile. |
| `IconButton` | none (do not reuse `ToggleTrack`) | **New.** Theme (`sun` / `moon` / `sun-moon`), motion (`zap` / `zap-off`), resume, github, linkedin. |
| `Logomark` | footer SVG | **New.** Collapsed + Expanded. Expanded hosts `VersionOption` v3/v2/v1. Prefer `<details>` over JS. |
| `VersionOption` | README v1 link | **New.** Current=Yes for v3. Current=No are `<a href>`. |
| `Timer` | none | **New.** `America/New_York`. `client:idle` tick only. |
| `SubpageHeader` | `BackLink` + ad-hoc titles | **New.** Section variants including Me. |
| `SubpageFooter` | `layouts/Footer.astro` | **Restyle.** Logomark + Timer, not the old 100vw gray bar. |
| `Badge` | `Badge.astro` + `badge.css` | **Restyle.** Drop React `Badge.tsx` unless dashboard lands elsewhere. |
| `ProjectCard` + `ProjectCard/Mobile` | `Card.astro` | **Rewrite layout.** Image left (desktop), 1-col. Optional `LanguageBar`. |
| `ArticleCard` | `OtherWorkGrid.astro` | **Restyle.** title, media, meta, external icon. |
| `Chip` (Default/Selected) | `CloudinaryTag.tsx` | **Restyle.** Selected state already exists as `isSelected`. |
| `GalleryTile` | `ProgressiveImage` + photo-album | **Reuse** natural aspect masonry (react-photo-album). Figma tiles are layout, not a 9-image cap. |
| `TimelineRow` | **not** `Timeline.astro` | **New.** Career only. |
| `SectionHeading` | `SectionHeading.astro` + editorial CSS | **Restyle** to Figma 760px write-up heading. |
| `Callout` | `Callout.astro` | **Restyle.** |
| `WriteupButton` | `Button.astro` | **Restyle.** |
| `LanguageBar` | none | **New.** Optional on `ProjectCard` from frontmatter. |
| `MobileMenu` | none | **New.** |

**Port as islands / editorial (restyle chrome, keep behavior):**

`CaptionedFigure`, `CodeBlock`, `CopyGrid`, `StatsGrid`, `Pipeline`, `FeatureInventory`, `InteractionGrid`, `BeforeAfter`, `PhoneMockup`, `ProsConsCard`, `BlockQuote`, `CaseStudyCard` / `CaseStudyCardGrid`, `FigmaEmbed`, `GenericCarousel` (export name `SharedCarousel` — rename to `Carousel`), `ProgressiveImage`, `BrandingPhotoAlbum`, `BezierPlayground`, `WindowChrome`, `PDFCarousel`, `Book.svelte` + `Bookmark.svelte`.

**Delete / do not port:**

`src/ui/*`, `DescriptionTyper.astro`, `SideBar.astro`, `components/Footer.astro`, `DiceIcon.astro` as a randomizer, `RedDotDemo*`, `WordpressFetcher.tsx`, `dashboard/*`, `TagRow.tsx` (admin), `PhotographyUploader.tsx`, `CloudinaryManagementGrid.tsx`, `ToggleTrack.tsx` (unless a restyled cousin is needed — Figma uses `IconButton`, not ToggleTrack), unused icons (`AnimationIcon`, `ReactWhiteIcon`, `SvelteWhiteIcon`, `TypescriptWhiteIcon`, `WrenchIcon` unless a card needs them).

---

## 7. Islands and `useEffect`

**Rule:** first paint of lists, articles, featured photos, and Berlin cards is HTML. `useEffect` is not a data layer.

### Allowlist

| Island | Directive | `useEffect` OK for | Fetch on mount? |
| --- | --- | --- | --- |
| Theme + reduced-motion | inline `<head>` script | `localStorage` / `matchMedia` only | no |
| Timer | `client:idle` | clock tick | no |
| Logomark versions | `<details>` + small script | WAAPI spring open/close (zap: instant) | no |
| Featured carousel | SSR 5 `featured` slides; `client:visible` for controls | index, keyboard, resize | **no** (dice is dead) |
| Gallery | SSR first page | IntersectionObserver pagination, lightbox | only for **next** page |
| `Book.svelte` | `client:visible` on HERL write-up | tilt / page flip | no |
| Bezier, PDF, BrandingPhotoAlbum | `client:visible` | existing demo / pdf.js | no |
| Switch iframe | Astro `<iframe loading="lazy">` | none (HUD is Astro) | no |
| Write-up TOC | small script or CSS | active heading | no |

### Ban

- `WordpressFetcher` mount fetch
- `CloudinaryCarousel` / `CloudinaryMenu` / `CloudinaryFetcher` fetch for **initial** data
- `dice-click` / `carousel-loading` custom event bus
- `DescriptionTyper` infinite loop
- Landing `IntersectionObserver` fade-in
- `client:load` on `/photography` or `/writing` for the whole tree

Photography pagination after first page may hit `/api/cloudinary/search` from the island. Tags for the chip row: SSR with the first page (v2 fetched tags in `useEffect` — stop that).

Switch HUD: rewrite `SwitchMenuPreview.svelte` as Astro. Keep the iframe + keyboard hint; drop Svelte for it.

---

## 8. Data and APIs in v3

### Cloudinary (read-only)

**Copy from v2:**

- `src/lib/cloudinaryServer.ts`
- `src/lib/cloudinaryImage.ts`
- `src/lib/cloudinarySearchPolicy.ts` (public expressions only)
- `src/pages/api/cloudinary/search.ts` — **public GET (and public POST if still needed for pagination).** Strip `dashboard: true` branch.
- `src/pages/api/cloudinary/tags.ts`

Keep `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`.

**Do not copy:** `upload.ts`, `delete.ts`, `add-tag.ts`, `remove-tag.ts`, `dashboardAuth.ts`, `src/pages/dashboard.astro`, `src/components/dashboard/*`.

Env still needed: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

Featured carousel query stays `resource_type:image AND tags=featured`, `max_results: 5`. Future dashboard repo writes those tags against the same cloud.

Photography page: **SSR** featured set + first masonry page + tag list in the Astro frontmatter (server `fetch` to Cloudinary or internal API). Then hydrate controls/lightbox/infinite scroll.

### RAWG + Switch embed

**Copy:** `src/pages/api/rawg/[...path].ts`, `src/lib/switchMenuEmbed.ts`, `src/middleware.ts` switch-menu branch, `vercel.json` frame headers, `public/switch-menu/`.

**Change:**

- `SWITCH_MENU_PROJECT_PATH` `/projects/switch-react-menu` → `/engineering/switch-react-menu`
- Embed `index.html` redirect of non-iframe document requests to that new path
- Strip `public/switch-menu/**/*.map` (v2 ships ~968KB of source maps)

Env: `RAWG_API_KEY`.

### GitHub Action (lives in `switch-react-menu`, not this repo)

File: `/Users/liambsulliva/Developer/switch-react-menu/.github/workflows/deploy-vercel-subpath.yml`

Today it builds `dist/browser` with `VITE_RAWG_PROXY_BASE=/api/rawg` and pushes to `vars.MAIN_SITE_REPO` (default `liambsulliva/personal-website-v2`) at `public/switch-menu`.

**Change:** set repository variable `MAIN_SITE_REPO` to `liambsulliva/personal-website-v3`. Copy the current bundle into v3 once as the seed. Frozen v2 keeps its last commit and stops receiving embed pushes. Prefer also skipping `*.map` in the sync step.

---

## 9. Theming and motion

**Was:** dark-only hex in `Layout.astro` (`#0f0f0f`, `#151515`, `#76c7ff`, …). No `color-scheme`, no class toggle. `ToggleTrack` is dashboard tabs. Reduced motion only in SideBar + 404.

**Change:**

- CSS variables on `:root` (light) and `html.dark` (or `.dark`) for background, text, muted, border, card, footer, and per-wing accents.
- Map those vars into `tailwind.config` `theme.extend.colors` so utilities like `bg-background` / `text-muted` work.
- `darkMode: 'class'`.
- Default **light**.
- `IconButton` sun-moon cycles **light → dark → system**. Persist in `localStorage`. Head script applies class before paint.
- `IconButton` zap sets `data-reduced-motion` and also honor `prefers-reduced-motion`.
- No v2 fade-in observer. Timer and Book must respect reduced motion.

Geist Sans stays the UI font (already in v2 Layout). Martian Mono stays write-up/code only.

---

## 10. v2 page → v3 destination (copy vs rewrite)

| v2 | v3 | Action |
| --- | --- | --- |
| `pages/index.astro` | `/` lobby | **Rewrite.** Delete sections. |
| `ui/Background.astro` | `/me` | **Move copy** into static `me.astro`. |
| `ui/Projects.astro` | `/engineering` | **Replace** with `getCollection("projects")` + `ProjectCard`. |
| `ui/UX.astro` | `/design` case-study row | **Replace.** Kingdra UX card from `projects` `wing: design`. |
| `ui/Photography.astro` + `pages/photography.astro` | **one** `/photography` | **Merge.** Carousel + chips + masonry. No dice. |
| `ui/Extracurriculars.astro` | gone from lobby | Featured design-club decks become Design `pieces`. |
| `pages/other-work.astro` | `/design` + `/writing` | **Split and delete** the junk drawer. |
| `pages/projects/*.astro` | `src/content/projects/*.mdx` | **Extract** prose; delete page files. |
| `pages/ux/kingdra-case-study.astro` | `projects/kingdra-case-study.mdx` | **Extract.** |
| `pages/dashboard.astro` | elsewhere | **Do not port.** |
| `layouts/CaseStudyLayout.astro` | `WriteupLayout.astro` | **Rewrite** to 760px Figma chrome; keep metadata props. |
| `content/other-work/*` | `content/pieces/*` | **Migrate** schema; drop cooking. |
| `content.config.ts` `otherWork` | `career` + `projects` + `pieces` | **Replace.** |

---

## 11. Redirects (v3)

Ship 301s even before apex promotion (harmless on a preview host).

| From | To |
| --- | --- |
| `/photography/` | `/photography/` |
| `/other-work/` | `/design/` |
| `/projects/kingdra-app/` | `/engineering/kingdra-app/` |
| `/projects/herl-app/` | `/engineering/herl-app/` |
| `/projects/switch-react-menu/` | `/engineering/switch-react-menu/` |
| `/projects/the-invisible-hand-of-ux/` | `/engineering/the-invisible-hand-of-ux/` |
| `/projects/bridge-app/` | `/engineering/bridge-app/` |
| `/ux/kingdra-case-study/` | `/design/kingdra-case-study/` |
| `/dashboard/` | 404 (or later dashboard host — not this repo) |

Hash URLs (`/#background`, `/#projects`, …) cannot 301. Lobby is the replacement.

Middleware: switch-menu document requests that are not embeds 302 to `/engineering/switch-react-menu/` (was `/projects/switch-react-menu/`).

---

## 12. Performance landmines in v2 (do not repeat)

- Home photography: hydrate then `GET /api/cloudinary/search`. **SSR the five featured URLs.**
- `/photography` `client:load` of album + lightbox + menu. **SSR first page; `client:visible` the interactive remainder.**
- `pdfjs` on Invisible Hand: keep, but `client:visible` only.
- `public/presentation` (~72MB PDFs) and `public/layouts`: linked from pieces; do not eagerly bundle. Copy assets that `pieces` still href.
- Switch embed source maps: strip.
- `utils/images.ts` mega-barrel: prefer per-entry images in content, not one import graph.

---

## 13. Implementation order for the next model

1. Scaffold Astro 5 + React + Svelte (Book only) + Tailwind, Vercel adapter, Root layout with light/dark CSS vars.
2. Figma chrome: `NavLink`, `IconButton`, `Logomark`+`VersionOption`, `Timer`, `SubpageHeader`, `SubpageFooter`, `MobileMenu`. Lobby `/` with no body sections.
3. `SubpageLayout` + empty Me / Career / Engineering / Design / Photography / Writing / 404 matching Figma layout.
4. Collections: `projects` MDX, `pieces`, `career`. Extract write-up text from the six v2 `.astro` files. Migrate other-work markdown. Static `me.astro` copy from `Background.astro`.
5. `WriteupLayout` + MDX component map + islands (Book, Bezier, PDF, album, FigmaEmbed, Switch iframe/HUD).
6. Photography SSR + read-only Cloudinary APIs + carousel/masonry/lightbox allowlist.
7. Writing SSR Berlin fetch with 300s cache + ArticleCards from `pieces`.
8. Copy switch-menu bundle; retarget GH Action; RAWG proxy; path updates; strip maps.
9. Redirects. Delete v2-only files listed in §6.
10. Stop. Do not build `/dashboard`.

---

## 14. Sources in v2 worth opening first

- `docs/v2-implementation-notes.md` — factual inventory of v2 as it shipped
- `src/layouts/Layout.astro`, `CaseStudyLayout.astro`, `Footer.astro`
- `src/pages/index.astro`, `src/ui/Background.astro`, `src/ui/Projects.astro`
- `src/content.config.ts`, `src/content/other-work/`
- `src/components/gallery/CloudinaryCarousel.tsx`, `CloudinaryFetcher.tsx`
- `src/components/editorial/WordpressFetcher.tsx` (do not copy the pattern)
- `src/middleware.ts`, `src/lib/switchMenuEmbed.ts`
- `src/pages/projects/the-invisible-hand-of-ux.astro` (heaviest MDX extraction + island list)

Figma component page `0:1` is the naming authority. Invisible Hand frame `51:1374` is the write-up slot template.

---

## 15. Motion

Figma v3 has **hover/active variants** and a zap control. It has **no keyframe timelines** (checked on index, `NavLink`, Logomark, mobile menu, 404). Motion below is additive. Prefer **CSS** (and a tiny Astro `<script>` where required). Do **not** turn the site into an SPA or put Motion.dev on the lobby just to animate chrome.

Zap (`IconButton` zap / zap-off) sets `data-reduced-motion` and also honors `prefers-reduced-motion`. Treat it as **reduce JavaScript**: professional, basic, no decorative distraction so visitors who struggle with focus can read. Under zap / reduced-motion / no-JS: skip every item in this section unless noted.

### Tokens

```css
--motion-fast: 150ms;
--motion-medium: 200ms;
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
```

Zap: `transition: none` and `animation: none`.

### Do not animate

| Surface | Why |
| --- | --- |
| Route changes (lobby ↔ wing ↔ write-up) | Honor Astro MPA. Instant. No View Transitions, no page slide/crossfade. |
| Lobby `NavLink` stair-step | Color/variant CSS only. No stagger, no bounce, no enter rise. |
| Lobby Controls (theme, zap) | No bounce. |
| Lobby socials (resume, GitHub, LinkedIn) | No bounce. Color/opacity only if hover exists. |
| `/me` portrait, Career rows, list enter | LCP / content. No stagger. |
| Write-up sections | v2 fade-in is tech debt. **Banned.** |
| Lightbox scale, masonry tile fade-in, carousel fade | Zap kill list. Carousel uses **slide** instead of fade (see below). |
| Book tilt | Gate with zap (demo can stay still). |

### Hover (CSS only)

| Surface | Motion |
| --- | --- |
| `ProjectCard`, `ArticleCard` | v2-style **lighten/darken** of the surface, `--motion-fast`. No lift, no scale. |
| `Badge` / chips | Same lighten/darken, `--motion-fast`. |
| `WriteupButton`, `VersionOption` | Color `--motion-fast`. |
| `TimelineRow` | Ghost 5% `--fg` tint via `::before` opacity, `--motion-fast`. No lift, no scale. |
| Lobby `NavLink` | Figma Default/Hover/Active color only. |

### Scare-bounce (desktop subpage menu only)

**Target:** `SubpageHeader` → `compact-nav` → `CompactNavIcon` (Me, Career, Engineering, Design, Photography, Writing). Desktop only. Not the lobby stair-step, not Controls, not socials, not mobile menu.

**Feel:** on hover, the icon **jumps up as if scared of the cursor**, then **falls back down** (short overshoot). CSS `@keyframes` on `:hover`. Zap: no animation, static icon.

### Logomark spring

The version rail is still `<details>`. With motion on, a page script springs the panel open from the pill (`scale(0.56, 0.46)` → 1) and pops the version rows out of the top (bottom row first). Close reverses it, then the pill settles. Zap: native open/close, no spring, no press scale.

### Breadcrumb name strum

Subpage `Breadcrumb` “Liam Sullivan” letters strum 7px up in sequence on hover and focus-visible (360ms, 24ms stagger). The animation runs to the end even if the pointer leaves. Zap: static name, no transform.

### Theme color tween (still MPA)

Register color tokens with `@property` (`--bg`, `--fg`, `--border`, `--card`, and other semantic colors that must interpolate). Toggling `html.dark` **tweens those colors ~200ms**. No router, no View Transitions, no React tree on the lobby.

Do **not** tween `box-shadow` or every utility. Zap: instant class swap.

### Lobby hero type-in (LLM generation)

**Copy** (Figma Desktop Index, node `16:173`):

1. `I'm Liam.`
2. `A Business Systems Analyst [bsa-icon] at PNC [pnc mark]`
3. `This is my virtual museum.`

**Behavior:**

- Forward only. **Not** v2 `DescriptionTyper` (no shuffle, no delete, no loop).
- **Word/token chunks** with slight jitter, not 100ms-per-character.
- Lines run **sequentially**.
- **Blinking caret** until line 3 finishes, then the caret is gone.
- **BSA icon and PNC mark pop in when their word finishes** (“Analyst”, “PNC”), not after the whole line. CSS `hero-pop` scales them 0.6 → 1 over `--motion-medium`. Each mark lives inside its link; on phones, `white-space: nowrap` keeps the word and mark on one line.
- **Once per session** (`sessionStorage`). Later visits to `/` in that session show the finished three lines.
- **SSR the finished three lines** for LCP, SEO, and no-JS. Script types only when motion is allowed and the session flag is unset.
- **Zap / no-JS:** leave the SSR text. Never run the typer.

The typer is the lobby page script. Logomark’s spring is a separate chrome script. Do not revive `DescriptionTyper.astro`.

### Photography carousel

v2 `GenericCarousel` already supports `transition: "fade" | "slide"`. **Use `slide`.** Horizontal, loop, prev/next + dots as in Figma. Zap: jump to the index with no tween (or disable controls’ animation).

First masonry page: no enter animation (SSR). No album stagger.

### 404

**Port the v2 focus dial** (`src/pages/404.astro` pointer + keyboard blur) and **put the Figma 404 layout on top of it** (frame `104:3410`). Do not keep v2’s old copy/layout as the visual source of truth.

- **Zap or no-JS:** static Figma 404, dial frozen in-focus, no blur. Progressive enhancement: dial JS never required to see or leave the page.
- **Motion on:** v2 dial behavior under Figma chrome.

### Engine cheat sheet

| Need | Tool |
| --- | --- |
| Hover color, badges, cards | CSS `transition` |
| TimelineRow ghost tint | CSS `::before` opacity |
| Compact-nav scare-bounce | CSS `@keyframes` |
| Logomark spring | WAAPI on `<details>` |
| Breadcrumb name strum | CSS `@keyframes` + tiny script |
| Theme tween | `@property` + class on `html` |
| Hero type-in | Astro `<script>`, sessionStorage |
| Hero PNC / chart pops | CSS `@keyframes` when the word finishes |
| Carousel slide | Existing React carousel island |
| 404 dial | Page script, gated |
| Route change | Nothing |

Do not add Motion.dev unless a React island already needs it (carousel/lightbox). Chrome stays in Astro + CSS.
