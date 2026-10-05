# V3 site audit (2026-10-04)

Primary-source audit of `/Users/liambsulliva/Developer/personal-website-v3`. Claims below follow a file that was read. `docs/v3-architecture-delta.md` is treated as a checklist of intended behavior, not as proof of implementation.

Status words used here:

- **Implemented:** present in source and wired to a route or layout.
- **Specified but missing:** named in the architecture delta, not found in this tree.
- **Stubbed / partial:** file or schema exists, but behavior, content, or chrome is incomplete.
- **Built but not in spec:** present in this tree, not required by the delta.

This tree has no `.git`, no `README.md`, no `LICENSE`, and no `.github/` workflows. Identity comes from `package.json` (`"name": "personal-website-v3"`, `"version": "3.0.0"`).

---

## 1. Identity and stack

**Implemented.** Package name, Astro 5, React, Svelte, MDX, Tailwind 4, Vercel adapter.

| Fact | Evidence |
| --- | --- |
| Package | `package.json`: `"name": "personal-website-v3"`, `"version": "3.0.0"`, `"private": true`, `"type": "module"` |
| Node | `package.json` `"engines": { "node": "24.x" }`; `.nvmrc` is `24` |
| Astro | `"astro": "^5.18.2"` plus `@astrojs/mdx`, `@astrojs/react`, `@astrojs/svelte`, `@astrojs/check`, `@astrojs/vercel` |
| UI runtimes | React `^18.3.1` and Svelte `^5.57.1`. Svelte files on disk are only `src/components/islands/Book.svelte` and `Bookmark.svelte` |
| CSS | Tailwind 4 via `"@tailwindcss/vite": "^4.3.3"` and `astro.config.mjs` `vite.plugins: [tailwindcss()]`. There is no `tailwind.config.js`. Tokens live in `src/styles/global.css` `@theme inline` (`--color-bg: var(--bg)`, `--font-sans: "Geist Sans"...`) |
| Dark mode | Not `darkMode: 'class'` in a Tailwind 3 config. `global.css` has `@custom-variant dark (&:where(.dark, .dark *));` and `:root.dark` color tokens |
| Fonts | `@fontsource/geist-sans` and `@fontsource-variable/martian-mono` imported from `global.css` |
| Adapter / output | `astro.config.mjs`: `adapter: vercel()` and `site: "https://liambsullivan.com"`. No `output` field. Astro 5 default is static (`node_modules/astro/dist/core/config/schemas/base.js` `.default("static")`). SSR is opt-in via `export const prerender = false` on `/photography`, `/writing`, and the three API routes. A prior build's `.vercel/output/config.json` sends those paths to `_render` and everything else through filesystem HTML |
| Frame headers | `vercel.json` sets CSP `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`, and `Referrer-Policy: same-origin` on `/switch-menu/:path*` |
| Env contract | `.env.example` lists `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `RAWG_API_KEY`. The local `.env` has the three Cloudinary names and does not define `RAWG_API_KEY` (name check only; values not recorded) |
| TypeScript | `tsconfig.json` extends `astro/tsconfigs/strict`, `jsx: "react-jsx"`. No `src/env.d.ts`; generated types are expected at `.astro/types.d.ts` |

**Pros (evidenced):** The stack matches the delta's "Astro 5 + React islands, Svelte only for Book" rule. Tailwind 4 `@theme inline` is a working substitute for the delta's `tailwind.config` `theme.extend.colors` mapping.

**Cons (evidenced):** No README. No git history in this directory. `prettier-plugin-astro` is in `package.json` `devDependencies` but `.prettierrc` only lists `prettier-plugin-tailwindcss`.

---

## 2. Information architecture

**Implemented:** lobby plus six wings, write-up slugs, 404, read-only APIs. **Missing as product routes:** `/dashboard`, `/other-work`, `/projects/*`, `/ux/*` (the last two exist only as 301 sources).

Pages under `src/pages`:

- `index.astro` (`/`)
- `me.astro`, `career.astro`, `photography.astro`, `writing.astro`, `404.astro`
- `engineering/index.astro`, `engineering/[slug].astro`
- `design/index.astro`, `design/[slug].astro`
- `api/cloudinary/search.ts`, `api/cloudinary/tags.ts`, `api/rawg/[...path].ts`

Lobby is nav-only. `src/pages/index.astro` comment: "Nav only: hero, controls, stair-step NavLinks, socials, Logomark, Timer." There is no import from a `src/ui/*` homepage section folder (that folder does not exist).

Wings are real routes: `SECTIONS` in `src/lib/sections.ts` lists `/me`, `/career`, `/engineering`, `/design`, `/photography`, `/writing`.

Write-up slugs are generated from the `projects` collection filtered by `hasWriteup` (`src/lib/content.ts`: body must be non-empty). A prior `dist/client` build contains HTML for:

- `/engineering/kingdra-app`, `herl-app`, `switch-react-menu`, `the-invisible-hand-of-ux`, `bridge-app`
- `/design/kingdra-case-study`

Card-only projects (`claudia-cooks`, `how-expensive-is-fruit`, `compression-wars`) have `body_chars=0`, so they do not get `[slug]` pages.

Redirects in `astro.config.mjs`:

```
"/other-work" -> "/design" 301
"/projects/kingdra-app" -> "/engineering/kingdra-app" 301
"/projects/herl-app" -> "/engineering/herl-app" 301
"/projects/switch-react-menu" -> "/engineering/switch-react-menu" 301
"/projects/the-invisible-hand-of-ux" -> "/engineering/the-invisible-hand-of-ux" 301
"/projects/bridge-app" -> "/engineering/bridge-app" 301
"/ux/kingdra-case-study" -> "/design/kingdra-case-study" 301
```

`.vercel/output/config.json` compiles those as `^/other-work$` (and the other unslashed sources). `trailingSlash: "ignore"` is set, but the compiled redirect regexes do not include `/?`. Trailing-slash old URLs may miss the 301.

The delta's `/photography/` to `/photography/` row is a no-op and is not implemented (correctly absent). `/dashboard` has no page and no explicit redirect; the built Vercel catch-all is `'^/.*$'` -> `/404.html` status 404.

**Named layout gap:** there is no `HomeLayout.astro`. The lobby uses `RootLayout` directly.

**404:** `src/pages/404.astro` uses `SubpageLayout` (`showHeading={false}`), so it gets `SubpageHeader` and `SubpageFooter`. Focus dial script is present; zap / no-JS CSS freezes the dial (`:root[data-reduced-motion]` and `:root:not(.js)`).

---

## 3. Content model

**Implemented:** Zod collections `career`, `projects`, `pieces` in `src/content.config.ts`. `/me` is static `.astro`, not a collection. Cooking is absent. Berlin is SSR WordPress, not a collection loader. Featured writing is one `section: featured` YAML file.

### `/me`

`src/pages/me.astro`: three paragraphs inlined (Nikon D200, CS / DNID, BSA at PNC). Uses `Mark` chips. Portrait is `<CldImage id="site/me/portrait" ... gravity="face">`, not a local file under `public/`. `scripts/cloudinary-map.mjs` reserves `{ id: "site/me/portrait" }` with no `src`/`local`. `src/data/cloudinary-manifest.json` has 60 keys and does **not** include `site/me/portrait`. Until that public_id exists in Cloudinary, `CldImage` will hit `onerror="this.dataset.error=''"` and keep the skeleton.

The delta asked for "Figma portrait is a new local asset." Code chose a Cloudinary slot that is not in the manifest. **Partial.**

### `career`

Schema matches the delta except `monogram` is `.max(4)` with comment "Figma's Education row renders Pitt, so 4 rather than 2." Extra field vs law: none besides that max. `logo` comment in code says "Cloudinary public_id (site/career/*)", not a local image path.

Five YAML files: `pnc.yaml`, `herl.yaml`, `the-pitt-news.yaml`, `hse.yaml`, `pitt.yaml`. `/career` groups Experience vs Education via `kind`.

Unused local copies sit in `assets/career/` (`pitt.svg`, `pnc.png`, `herl.png`, `hse.png`, `the-pitt-news.png`). Nothing in `src/` references `assets/career`. Dead weight.

### `projects` (MDX)

Schema matches the delta plus `hero` (optional) and `order` (default 0).

| File | wing | body | role in IA |
| --- | --- | --- | --- |
| `kingdra-app.mdx` | engineering | write-up | `/engineering/kingdra-app` |
| `switch-react-menu.mdx` | engineering | write-up | `/engineering/switch-react-menu` |
| `herl-app.mdx` | engineering | write-up | `/engineering/herl-app` |
| `the-invisible-hand-of-ux.mdx` | engineering | write-up | `/engineering/the-invisible-hand-of-ux` |
| `bridge-app.mdx` | engineering | write-up | `/engineering/bridge-app` (un-orphaned) |
| `kingdra-case-study.mdx` | design | write-up | `/design/kingdra-case-study`; title "The Journey to Mobile" |
| `claudia-cooks.mdx` | engineering | empty | card only (`github`) |
| `how-expensive-is-fruit.mdx` | engineering | empty | card only (`demo`) |
| `compression-wars.mdx` | engineering | empty | card only (`demo`) |

`hasWriteup` / `projectHref` in `src/lib/content.ts`: empty body => outbound `demo ?? github ?? "#"`.

### `pieces`

Schema matches the delta plus optional `kind` ("Logo", "Cover", "Blog", ...). `gallery` is `design | writing`. `section` enum includes `featured`, `substack`, `video`, `berlin`.

On disk:

- Design graphic-design: `do-you-not-get-the-concept.yaml`, `from-pop-to-personal.yaml`, `mock-pitt-post.yaml`
- Design layouts: `beer-and-wine-edition.yaml`, `march-madness-edition.yaml`, `portrait-tutorial.yaml`, `wii-manual.yaml`
- Design design-club: `clubmeeting1.yaml` ... `clubmeeting6.yaml`
- Writing: only `english-is-the-new-frontier.yaml` with `section: featured` and a `description` dek

No files with `section: substack`, `video`, or `berlin`. No `src/content/**/cooking/**`. `/writing` hides empty Substack and Video Essays sections (`if (items.length === 0) return null`).

Berlin: `src/lib/berlin.ts` fetches `https://public-api.wordpress.com/rest/v1.1/sites/pittbusinesstotheworld.com/posts/?tag=liam-sullivan&fields=ID,title,date,URL,featured_image&number=20`, strips HTML from titles, maps to ArticleCard fields. No `WordpressFetcher.tsx` anywhere under `src/`.

Photography is not a collection (no `src/content/photos`).

---

## 4. Chrome

**Implemented** (Figma names exist as files unless noted): `NavLink`, `CompactNavIcon`, `IconButton`, `Logomark` (with inlined VersionOption), `Timer`, `SubpageHeader`, `SubpageFooter`, `MobileMenu`. **Missing as a named file:** `HomeLayout`. Root layout is `RootLayout.astro`, not `Layout.astro`.

| Piece | Where | Notes |
| --- | --- | --- |
| Root layout | `src/layouts/RootLayout.astro` | Fonts/meta via `global.css` import; theme + motion head script; `lang="en"`; slot only in `<body>` plus `controls.ts` |
| Theme FOUC script | inline in `RootLayout.astro` | Reads `localStorage.theme` default `"light"`; toggles `html.dark`; sets `data-reduced-motion` from `localStorage.motion` or `prefers-reduced-motion` |
| Light / dark / system | `ThemeButton.astro` + `src/scripts/controls.ts` | Cycle `light -> dark -> system`. Default light |
| Zap | `MotionButton.astro` + `controls.ts` | Sets `data-reduced-motion`; `global.css` then forces `transition: none !important; animation: none !important` |
| `NavLink` | `src/components/chrome/NavLink.astro` | Stair-step sizes from `SECTIONS.lobby`; hover underline, active bold+underline; "Color only, no motion" |
| `CompactNavIcon` | `CompactNavIcon.astro` | Scare-bounce `@keyframes` for desktop hover (`min-width: 768px`, `pointer: fine`) |
| `IconButton` | `IconButton.astro` | 36px hit, tooltip, `action: theme \| motion` |
| `Logomark` | `Logomark.astro` | `<details>`; v3 summary has no href; v2/v1 are `<a href>` to `https://v2.liambsullivan.com` and `https://v1.liambsullivan.com` (`VERSIONS` in `sections.ts`). Extra: JS spring open/close with `preventDefault` on summary |
| `Timer` | `Timer.tsx` | `America/New_York`, `client:idle`, tick aligned to minute. Placeholder hidden until hydrate (`visibility: now ? "visible" : "hidden"`). Extra: 12h/24h cube flip on hover |
| `SubpageHeader` | `SubpageHeader.astro` | Bar + compact-nav desktop; menu `IconButton` `popovertarget="mobile-menu"`; Me omits title row (`showTitle = section !== "me"`). Extra: "Liam Sullivan" name-wave keyframes |
| `SubpageFooter` | `SubpageFooter.astro` | Logomark + `Timer client:idle` |
| `MobileMenu` | `MobileMenu.astro` | Native `popover` on `#mobile-menu`; includes Me, Controls, Socials, Logomark, Timer. No JS required to open |
| `SubpageLayout` | `SubpageLayout.astro` | Header + main slot + footer. Used by every public subpage including 404 |
| `WriteupLayout` | `WriteupLayout.astro` | Hero (image or island slot), tool badges, GitHub/Demo `WriteupButton`s, Role/Team/Timeline, **760px** article, sticky Contents from MDX `SectionHeading`s |
| Lobby | `index.astro` | Uses `RootLayout`, not a `HomeLayout` |

`Chip` is not a standalone Astro file. Selected/unselected chips are a function inside `TagMenu.tsx` (`aria-pressed`, `chip--selected`).

`GalleryTile` is not a component file. Masonry tiles are `<button class="gallery-tile">` in `PhotoGallery.tsx`.

**Cards restyled:** `ProjectCard.astro` (image left on `md`, optional `LanguageBar`), `ArticleCard.astro`, `FeaturedArticle.astro`, `TimelineRow.astro`, `Badge.astro`, `LanguageBar.astro`.

---

## 5. Data fetching

**Implemented:** first paint of lists, Berlin cards, and featured photos is server HTML. `useEffect` is not used as the initial CMS. **Partial:** tag changes and gallery pages after the first still `fetch` from the island.

| Surface | Mode | Evidence |
| --- | --- | --- |
| Engineering / Design / Career / Me / write-ups | Static HTML (default prerender) | No `prerender = false`; `getCollection` in frontmatter |
| Photography | SSR | `export const prerender = false`; `Astro.response.headers.set("Cache-Control", PUBLIC_CACHE_CONTROL)` where `PUBLIC_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400"` (`cloudinaryServer.ts`); `Promise.all` of featured search, first masonry page, `listPhotoTags()` |
| Writing / Berlin | SSR | same `prerender = false` and Cache-Control; `getBerlinPosts()` in `berlin.ts` (server `fetch`, empty array on failure) |
| Cloudinary search API | SSR endpoint GET | `search.ts` GET only; `Cache-Control` on success |
| Cloudinary tags API | SSR endpoint GET | `tags.ts` |
| RAWG | SSR endpoint GET | `private, max-age=300` (not the public s-maxage formula) |
| Gallery next page / tag change | client `fetch` | `PhotoGallery.tsx` `loadPage` -> `publicCloudinarySearchUrl` |

`client:` directives in this tree (complete list):

- `Timer client:idle` on lobby, SubpageFooter, MobileMenu
- `Book client:visible` on HERL write-up
- `FeaturedCarousel client:visible` and `PhotoGallery client:visible` on photography
- `PDFCarousel`, `BrandingPhotoAlbum`, `BezierPlayground` `client:visible` in `the-invisible-hand-of-ux.mdx`

There is **no** `client:load` and **no** `client:only`. Writing has **no** client islands.

`useEffect` remaining uses: Timer tick; Carousel keyboard/resize/index clamp; TagMenu overflow chevrons; PDF.js load; PhotoGallery IntersectionObserver pagination; Loader online/offline; Bezier auto-replay. None of those load the first article list or Berlin grid.

Banned v2 patterns not present: `WordpressFetcher`, `CloudinaryCarousel` mount fetch, `dice-click`, `DescriptionTyper`, landing fade-in observer.

---

## 6. Islands

| Island | Status | Evidence |
| --- | --- | --- |
| `Book.svelte` + `Bookmark.svelte` | Implemented, restyled only as far as Tailwind classes on the cover imgs; 3D book CSS remains. Tilt skips when `data-reduced-motion` | `engineering/[slug].astro` passes Cloudinary `book-front` / `book-back` URLs |
| Switch embed + HUD | Implemented as Astro | `SwitchHud.astro`: `<iframe src="/switch-menu/index.html" loading="lazy">` plus keyboard HUD. Not Svelte |
| `BezierPlayground` | Implemented, restyled (`BezierPlayground.module.css` "Figma BezierPlayground"); zap skips auto-replay | Invisible Hand MDX `client:visible` |
| `PDFCarousel` | Implemented; pdf.js dynamic import in the browser | `src="/pitch-deck.pdf"` `client:visible` |
| `BrandingPhotoAlbum` | Implemented (`react-photo-album` rows layout) | Invisible Hand `albumPhotos(...)` |
| `WindowChrome` | Implemented; used in Invisible Hand MDX **without** `client:` so it SSRs as static chrome | `the-invisible-hand-of-ux.mdx` |
| `Carousel` (renamed from GenericCarousel) | Implemented | Default `transition = "fade"` in the component; FeaturedCarousel passes `transition="slide"` |
| Gallery pagination + lightbox | Implemented | First page SSR props; next page via GET search; `yet-another-react-lightbox` + Zoom; zap zeroes lightbox animation durations |
| `Timer` | Implemented | See chrome |
| `FigmaEmbed` | Implemented | Invisible Hand; host allowlist `figma.com` / `embed.figma.com`; `loading="lazy"` |
| `ProgressiveImage` | Implemented | Photography + carousel; CSS opacity fade (killed under zap via global rule) |
| `Loader` | Implemented | SVG SMIL `<animate>` dots. Zap CSS `animation: none` may not stop SMIL |

Switch `public/switch-menu`: `index.html` plus 6 JS assets and 2 OTF fonts. **Zero** `.map` files. Bundle dates on disk are `Aug 7`. `index.html` redirects non-iframe, non-localhost documents to `/engineering/switch-react-menu/`. Middleware also 302s `/switch-menu` document requests that are not embeds (`src/middleware.ts`, `SWITCH_MENU_PROJECT_PATH = "/engineering/switch-react-menu"`).

This repo has no GitHub Action. The delta's `MAIN_SITE_REPO` retarget lives in `switch-react-menu` and cannot be verified here. **Specified but missing from this tree.**

RAWG_API_KEY is absent from local `.env`, so `/api/rawg/*` returns 503 (`"RAWG proxy not configured"`) until that env is set. The proxy itself is implemented.

---

## 7. APIs

**Implemented (read-only Cloudinary + RAWG).** **Missing (intentionally, vs v2):** mutating dashboard APIs.

Present:

- `src/pages/api/cloudinary/search.ts`: public GET. Rejects `randomize` with 403 (`if (!body || body.randomize)`). No `dashboard: true` branch. No POST handler (delta allowed POST "if still needed"; pagination uses GET query params).
- `src/pages/api/cloudinary/tags.ts`: public GET.
- `src/pages/api/rawg/[...path].ts`: allowlisted paths/query; `isRawgProxyRequestAllowed` requires switch-menu referer.

Absent under `src/pages/api/cloudinary/`: `upload.ts`, `delete.ts`, `add-tag.ts`, `remove-tag.ts`. No `src/lib/dashboardAuth.ts`. No `src/pages/dashboard.astro`. No `src/components/dashboard/*`.

`src/lib/cloudinarySearchPolicy.ts` still understands `randomize` / `excludeIds` in the sanitizer, but search.ts never accepts POST bodies and rejects randomize. Harmless leftover in the policy type.

Middleware is switch-menu only (no dashboard no-store branch).

---

## 8. Photography

**Implemented: SSR first carousel page + first masonry page + tags.** Not a client-first fetch for initial data.

`src/pages/photography.astro`:

- Featured: `searchPhotos({ expression: photoExpression("featured"), max_results: 5 })` then `toFeaturedSlide`
- Masonry: `max_results: 20`, `toGalleryPhoto`
- Tags: `listPhotoTags()` (filters out `"featured"`)
- Islands: `client:visible` only
- Empty featured: skeleton `div.aspect-[4/3]` (not a spinner fetch)
- Preload of first slide placeholder in `<head>`

`photoExpression("featured")` is `resource_type:image AND tags=featured`. Server scopes with `NOT folder:site/*`.

After first paint, `PhotoGallery` fetches `/api/cloudinary/search` for infinite scroll and for chip changes (clears photos, then loads). That is allowed by the delta ("only for next page"; tag refetch is extra vs "SSR tags with the first page" but the chip **list** is SSR).

---

## 9. Spec vs code (checklist)

See the spec gap table at the end. Headline:

Most of delta sections 3-11 and the photography/Berlin/theme rules are **implemented**. Named gaps: `HomeLayout` file, standalone `Chip`/`VersionOption`/`GalleryTile`/`CodeBlock` components, `/me` portrait not seeded in the manifest, no `section: substack` files, GH Action retarget not in this repo, compiled redirects without optional trailing slash, extra motion beyond section 15, `press-card` scale vs "no scale" on cards, TimelineRow hover vs "None".

---

## 10. SEO, a11y, perf (from code only)

### SEO (implemented, with holes)

`RootLayout.astro` sets `title`, `meta name="description"`, `author`, `robots: index, follow`, canonical from `Astro.site` + pathname, `og:*`, `twitter:card summary_large_image`. Default description: "Developer, designer, photographer, and a few other things picked up along the way."

Holes:

- `og:image` and `twitter:image` are `content="/banner.jpg"` (root-relative, not absolute).
- No `@astrojs/sitemap`, no `public/robots.txt`, no `public/sitemap.xml`, no JSON-LD.
- No skip link (`rg` for `skip` in `src/**/*.astro` is empty).
- `/photography` and `/writing` are SSR with 300s CDN cache, which is good for live feeds and weak for instantly fresh Berlin posts (intentional per spec).

### A11y (implemented, with holes)

Present: `html lang="en"`; `:focus-visible` outline; lobby `aria-label="Sections"`; CompactNav `aria-current="page"`; Theme/Motion buttons `aria-label`; Timer `aria-label={`Pittsburgh time ${civil}`}`; 404 dial `role="slider"` with `aria-valuenow` / `aria-valuetext`; carousel `aria-live="polite"` "Slide X of Y"; TagMenu `role="group"` `aria-label="Filter photos by tag"`; LanguageBar `role="img"` with composed label; lightbox buttons labeled "Open photo N".

Holes:

- `ProjectCard` and `ArticleCard` pass `alt=""` on cover images (titles are adjacent text).
- `ArticleCard` always renders the external-link icon, even when `external={false}` (design-club PDFs). The `external` prop only controls `target="_blank"`.
- `Socials.astro` sets `external` on every IconButton, including `/Resume.pdf`.
- Carousel dots use hardcoded `bg-black` / `bg-white/70`, not theme tokens.
- Book cover alts are "Front Cover" / "Back Cover", not HERL-specific.

### Perf (implemented, with landmines still copied)

Good:

- No `client:load` of the photography tree.
- Featured photos and first masonry page SSR'd.
- `pdfjs` behind `client:visible`.
- Presentations stay as static files (`du`: `public/presentation` 72M, `public/layouts` 6.8M), linked from pieces, not bundled into JS.
- Switch maps stripped (0 `.map`; `public/switch-menu` 752K).
- No `utils/images.ts` mega-barrel; site images go through `cloudinary-manifest.json` (60 ids) and `cldUrl`.
- `_astro` immutable cache header in the Vercel build config.
- Lobby SSR's the finished three hero lines; typer only runs when `html.typing` is set.

Landmines still in tree:

- 72MB of PDFs in `public/presentation` still ship with the deployment.
- `PhotoGallery` + lightbox + `react-photo-album` hydrate on `client:visible` for the whole album island (not `client:load`, but still a large island).
- Timer is invisible until JS (`client:idle`), so the footer time is blank for no-JS users.
- CldImage hides the `<img>` until `onload` when `html.js` is set (`:root.js .cld > img:not([data-loaded]) { opacity: 0 }`), which needs JS for the fade-in (no-JS still shows the image because `.js` is added in the head script; without JS the image is visible). That is OK. With JS, late `onload` can flash skeleton.

---

## 11. Dead weight / incompleteness

No `TODO` / `FIXME` / `lorem ipsum` hits under `src/`, `docs/`, or `scripts/` except architecture-delta prose.

Dead or unused in *this* tree:

- `assets/career/*` (not referenced from `src/`)
- `src/lib/cloudinarySearchPolicy.ts` `randomize` / `excludeIds` fields (dice path is dead; search GET rejects randomize)
- `prettier-plugin-astro` unused by `.prettierrc`
- `pieces.section` values `substack`, `video`, `berlin` have no content files (`berlin` is correctly live-fetched instead)

Empty sections (hidden, not stub copy): Writing "Video Essays" and "Substack" render nothing when the collection filter is empty. Featured writing is filled. Photography empty featured is a skeleton box, not placeholder lorem.

Figma-named components **not** split out as files: `Chip`, `VersionOption`, `GalleryTile`, `HomeLayout`, `CodeBlock` (Shiki `pre.astro-code` is styled under a "CodeBlock" comment in `writeup.css`; MDX editorial code cards are `CodeExample`).

Incompleteness:

- No git, README, or CI in this directory
- `/me` portrait public_id not in the Cloudinary manifest
- `RAWG_API_KEY` missing locally
- No `section: substack` migration files (only a featured piece)
- Card-only projects have no write-up body (intentional per spec)

---

## 12. Strengths of the actual v3 tree

1. **Lobby / wings IA is real.** Six section routes exist; the homepage does not mount About/Projects/UX/Photo sections. Evidence: `src/pages/index.astro` plus `src/lib/sections.ts`.
2. **Collections replace hardcoded cards.** Engineering and Design indexes call `getProjects` / `getPieces`. Bridge is a write-up, not an orphan page.
3. **First paint of photography and Berlin is HTML.** `prerender = false` + server fetch + Cache-Control, with `client:visible` only for controls. No `WordpressFetcher`.
4. **Dashboard is actually gone.** No dashboard page, auth lib, or mutating Cloudinary routes under `src/pages/api`.
5. **Chrome is shared.** 404 and photography use `SubpageLayout` (header + footer), unlike the delta's description of v2.
6. **Theme is light-default with a no-FOUC head script** and CSS variables registered via `@property` for tweening.
7. **Switch path updates landed:** middleware, embed HTML, and `SWITCH_MENU_PROJECT_PATH` all point at `/engineering/switch-react-menu`. Source maps are absent.
8. **Write-ups are MDX** with a 760px column, TOC from `SectionHeading`, and islands on an allowlist of directives.
9. **Cooking is dropped** (zero cooking files). Video essays stay empty-until-authored (hidden).
10. **TypeScript strict + `astro check` in `npm run build`.**

---

## 13. Weaknesses of the actual v3 tree

1. **Not a git repository** (no `.git`). No README. Hard to treat as a shippable product snapshot.
2. **`/me` portrait is an unseeded Cloudinary id.** Manifest has 60 keys, not `site/me/portrait`.
3. **Writing Substack list is empty.** Delta said migrate `personal/` to `writing / substack`. This repo only has one featured YAML.
4. **Redirects compiled without trailing-slash variants.** Risk for old `/other-work/` and `/projects/.../` URLs.
5. **Motion exceeds section 15** in several places: `press-card` scale, TimelineRow hover, name-wave, Logomark JS spring, TOC glide, PNC bounce / BSA chair, Timer cube, `squishy` buttons. Zap kills *CSS* animation globally; SVG SMIL in `Loader.tsx` may keep spinning.
6. **ArticleCard always shows an external icon**, including internal `/presentation/*.pdf` links (`external: false` in YAML).
7. **OG image is not an absolute URL.** No sitemap/robots.
8. **Switch live data depends on `RAWG_API_KEY`**, which is not in the local env file.
9. **Large static PDFs (72M)** still sit in `public/presentation`.
10. **Named Figma pieces inlined or renamed** (`HomeLayout`, `Chip`, `CodeBlock`), which will confuse a Figma-to-code pass that searches for those filenames.
11. **Card press and image `alt=""`** weaken the ProjectCard a11y story the rest of the chrome is aiming for.

---

## Feature inventory

| Feature | Where it lives | Status | Data source | Hydration |
| --- | --- | --- | --- | --- |
| Lobby nav | `src/pages/index.astro` | done | `SECTIONS` in `lib/sections.ts` | none (Timer idle) |
| Hero type-in | `LobbyHero.astro` + `scripts/typer.ts` | done | SSR text in the component | page `<script>` if `html.typing` |
| Theme + zap | `RootLayout` head script, `controls.ts`, `ThemeButton`, `MotionButton` | done | `localStorage`, `matchMedia` | bundled `controls` on every page |
| Logomark versions | `Logomark.astro` | done | `VERSIONS` constants | `<details>` + extra click JS |
| Timer | `Timer.tsx` | done | `Date` + `America/New_York` | `client:idle` |
| `/me` copy | `pages/me.astro` | done | inlined | none |
| `/me` portrait | `CldImage` `site/me/portrait` | partial | Cloudinary public_id, **not** in manifest | none (img) |
| Career timeline | `pages/career.astro`, `TimelineRow.astro` | done | `getCollection("career")` YAML | none |
| Engineering index | `pages/engineering/index.astro` | done | `projects` wing=engineering | none |
| Design index | `pages/design/index.astro` | done | `projects` wing=design + `pieces` gallery=design | none |
| Write-ups | `WriteupLayout.astro` + MDX | done | `projects` MDX body | islands listed below |
| Book | `Book.svelte` on HERL | done | Cloudinary book-front/back | `client:visible` |
| Switch iframe + HUD | `SwitchHud.astro`, `public/switch-menu` | done | static embed + RAWG proxy | iframe; HUD is Astro (no hydrate) |
| Bezier / PDF / album | Invisible Hand MDX | done | local PDF + Cloudinary album ids | `client:visible` |
| Photography featured | `photography.astro` + `FeaturedCarousel.tsx` | done | Cloudinary tags=featured, SSR | `client:visible` (controls) |
| Photography masonry | `PhotoGallery.tsx` | done | SSR first 20; GET search after | `client:visible` |
| Photography tags | `TagMenu.tsx` | done | SSR `listPhotoTags()` | same island |
| Writing featured | `writing.astro` + `FeaturedArticle.astro` | done | `pieces` section=featured | none |
| Writing Substack | `writing.astro` filter | missing (hidden empty) | no YAML with `section: substack` | none |
| Video essays | same | missing (hidden empty) | no `section: video` files | none |
| Berlin / Study Abroad | `lib/berlin.ts` | done | WordPress.com public API, SSR | none |
| Cooking | (no files) | missing by design | dropped | n/a |
| 404 dial | `pages/404.astro` | done | static assets in `public/ui` | page script, gated |
| Cloudinary search/tags APIs | `pages/api/cloudinary/*` | done | Cloudinary Admin search/tags | n/a (HTTP) |
| Dashboard + mutating APIs | (absent) | missing by design | n/a | n/a |
| RAWG proxy | `pages/api/rawg/[...path].ts` | done | RAWG; needs `RAWG_API_KEY` | n/a |
| Redirects | `astro.config.mjs` | partial | static map | n/a |
| Mobile menu | `MobileMenu.astro` | done | `SECTIONS` | popover; Timer idle |
| TOC | `WriteupLayout.astro` + `lib/toc.ts` | done | MDX `<SectionHeading />` | small scroll script |

---

## Route inventory

| Path | Page file | Status |
| --- | --- | --- |
| `/` | `src/pages/index.astro` | done (lobby) |
| `/me` | `src/pages/me.astro` | done |
| `/career` | `src/pages/career.astro` | done |
| `/engineering` | `src/pages/engineering/index.astro` | done |
| `/engineering/kingdra-app` | `engineering/[slug].astro` + `kingdra-app.mdx` | done |
| `/engineering/switch-react-menu` | same + `switch-react-menu.mdx` | done |
| `/engineering/herl-app` | same + `herl-app.mdx` | done |
| `/engineering/the-invisible-hand-of-ux` | same + `the-invisible-hand-of-ux.mdx` | done |
| `/engineering/bridge-app` | same + `bridge-app.mdx` | done |
| `/engineering/claudia-cooks` | (no slug; card outbound) | card-only, no page |
| `/engineering/how-expensive-is-fruit` | (no slug; card outbound) | card-only, no page |
| `/engineering/compression-wars` | (no slug; card outbound) | card-only, no page |
| `/design` | `src/pages/design/index.astro` | done |
| `/design/kingdra-case-study` | `design/[slug].astro` + `kingdra-case-study.mdx` | done |
| `/photography` | `src/pages/photography.astro` | done (SSR) |
| `/writing` | `src/pages/writing.astro` | done (SSR) |
| `/404` | `src/pages/404.astro` | done |
| `/api/cloudinary/search` | `src/pages/api/cloudinary/search.ts` | done GET |
| `/api/cloudinary/tags` | `src/pages/api/cloudinary/tags.ts` | done GET |
| `/api/rawg/*` | `src/pages/api/rawg/[...path].ts` | done GET |
| `/switch-menu` | `public/switch-menu/index.html` + middleware | done (embed or 302) |
| `/other-work` | redirect in `astro.config.mjs` | done 301 to `/design` (unslashed) |
| `/projects/kingdra-app` (and herl, switch, invisible-hand, bridge) | redirects | done 301 to `/engineering/...` |
| `/ux/kingdra-case-study` | redirect | done 301 to `/design/kingdra-case-study` |
| `/dashboard` | (no file) | missing as product; built 404 catch-all |
| `/other-work` junk drawer page | (no file) | deleted |
| `/projects/*` product pages | (no files) | deleted (redirects remain) |

---

## Spec gap table

Architecture-delta item | Implemented? | Evidence
--- | --- | ---
New v3 repo, v2 frozen | Partial | Directory exists and is named v3; **no `.git`**
Astro 5 + React islands, Svelte only for Book | Yes | `package.json`; only two `.svelte` files; Switch HUD is Astro
Vercel adapter | Yes | `adapter: vercel()`
CMS: collections + Zod; `/me` static | Yes | `content.config.ts`; `me.astro`
`/other-work` deleted; Design + Writing split; cooking out | Yes | No other-work page; no cooking files
Dashboard not in this repo | Yes (absence) | No `dashboard.astro`, no mutating APIs
Photography SSR first carousel + first masonry | Yes | `photography.astro` frontmatter fetch
Live feeds Cache-Control 300 / swr 86400 | Yes | `PUBLIC_CACHE_CONTROL` on writing, photography, search, tags
Theme: Tailwind colors + CSS vars; light default | Yes | `global.css` `:root` / `:root.dark`; head script default `"light"` |
Logomark v3 current, v2/v1 links | Yes | `VERSIONS` in `sections.ts` |
Switch embed copy + RAWG + path `/engineering/...` | Yes | `public/switch-menu`, `rawg/[...path].ts`, `switchMenuEmbed.ts` |
Strip switch-menu source maps | Yes | `find ... -name "*.map"` count 0 |
Retarget GH Action `MAIN_SITE_REPO` | No (not in this tree) | No `.github/` |
Routes `/`, `/me`, `/career`, `/engineering`, `/design`, `/photography`, `/writing`, `/404` | Yes | `src/pages` |
Write-up slugs under wings | Yes | `[slug].astro` + MDX |
No `/dashboard`, `/other-work`, `/projects/*`, `/ux/*` as product | Yes | Only redirects for old paths |
Lobby nav only | Yes | `index.astro` |
Root layout: fonts, meta, FOUC script, light+dark vars, slot only | Yes | `RootLayout.astro` |
`SubpageLayout` header + slot + footer | Yes | `SubpageLayout.astro` |
`WriteupLayout` 760px + TOC | Yes | `WriteupLayout.astro` `max-w-[760px]` |
`HomeLayout` | No as a file | Lobby uses `RootLayout` |
Delete duplicate Footers / SideBar | Yes (absence) | No `SideBar.astro`, one `SubpageFooter` |
`career` collection + TimelineRow | Yes | YAML + `TimelineRow.astro` |
`projects` MDX + wing filter + empty body outbound | Yes | `hasWriteup` |
Extract six v2 write-ups + un-orphan bridge | Yes | six MDX bodies non-empty |
Card-only Claudia / Fruit / Compression | Yes | empty bodies, cards on engineering |
`pieces` schema + migrate other-work | Partial | design pieces present; **no substack files**; cooking dropped |
Writing featured | Yes | `english-is-the-new-frontier.yaml` `section: featured` |
Video essays empty until authored | Yes | hidden empty section |
Berlin SSR WP, do not port WordpressFetcher | Yes | `berlin.ts`; no fetcher component |
NavLink, CompactNavIcon, IconButton, Logomark, Timer, SubpageHeader/Footer, MobileMenu | Yes | files under `components/chrome` |
Chip as Figma component | Partial | inlined in `TagMenu.tsx` |
LanguageBar | Yes | `LanguageBar.astro` |
Port islands list | Yes | Book, Bezier, PDF, album, FigmaEmbed, Carousel, ProgressiveImage, WindowChrome, write-up editorial Astro |
Delete ui/*, DescriptionTyper, RedDotDemo, dashboard/*, WordpressFetcher, Badge.tsx, ToggleTrack | Yes (absence) | none of those paths exist |
`useEffect` not a data layer | Yes | Berlin/photos SSR |
Featured carousel SSR 5 slides, `client:visible`, no dice | Yes | `max_results: 5`; no dice |
Gallery SSR first page; fetch next | Yes | `PhotoGallery.tsx` |
Switch HUD as Astro | Yes | `SwitchHud.astro` |
Cloudinary copy: server, image, policy, search, tags | Yes | those five files exist |
Do not copy upload/delete/add-tag/remove-tag/dashboardAuth | Yes | absent |
search GET (POST optional) | Yes GET-only | `export const GET` only |
Redirect table | Partial | 301s present without trailing-slash regex; dashboard is implicit 404 |
Hash URLs 301 | N/A | cannot 301 hashes (noted in delta) |
Middleware switch-menu 302 to engineering path | Yes | `middleware.ts` |
No View Transitions / Motion.dev on lobby | Yes | no such imports |
Zap sets data-reduced-motion + prefers-reduced-motion | Yes | head script + controls |
Hero type-in spec (forward, sessionStorage, SSR finished lines) | Yes | `index.astro` head script + `typer.ts` |
Hero extra PNC bounce / BSA chair | Built but not in spec | `LobbyHero.astro` `@keyframes pnc-bounce` / `bsa-chair` |
Carousel **slide** not fade | Yes | FeaturedCarousel `transition="slide"` |
404 Figma chrome + v2 dial, zap static | Yes | `404.astro` |
ProjectCard hover lighten only, no scale | Partial | `hover-surface` plus `press-card` scale on `:active` |
TimelineRow hover none | No (contradicts) | `TimelineRow.astro` ghost highlight on hover |
monogram max 2 | No | schema `.max(4)` |
`tailwind.config` theme.extend.colors | Partial | Tailwind 4 `@theme inline` instead |

---

## Content parity table (this repo only)

Compared to holdings the delta says to migrate. Filenames are from **this** tree. v2 was not opened.

| Holding (delta) | In v3? | Files / notes |
| --- | --- | --- |
| `kingdra-app` write-up | Yes | `src/content/projects/kingdra-app.mdx` |
| `switch-react-menu` write-up | Yes | `switch-react-menu.mdx` |
| `herl-app` write-up | Yes | `herl-app.mdx` |
| `the-invisible-hand-of-ux` write-up | Yes | `the-invisible-hand-of-ux.mdx` |
| `bridge-app` write-up | Yes | `bridge-app.mdx` |
| `kingdra-case-study` design write-up | Yes | `kingdra-case-study.mdx` |
| Claudia Cooks card | Yes | `claudia-cooks.mdx` frontmatter only |
| How Expensive is Fruit? card | Yes | `how-expensive-is-fruit.mdx` frontmatter only |
| Compression Wars card | Yes | `compression-wars.mdx` frontmatter only |
| graphic-design pieces | Yes | `do-you-not-get-the-concept.yaml`, `from-pop-to-personal.yaml`, `mock-pitt-post.yaml` |
| layouts pieces | Yes | `beer-and-wine-edition.yaml`, `march-madness-edition.yaml`, `portrait-tutorial.yaml`, `wii-manual.yaml` |
| design-club pieces | Yes | `clubmeeting1.yaml` ... `clubmeeting6.yaml` (PDFs under `public/presentation/`) |
| `personal/` -> writing/substack | **No files** | No YAML with `section: substack` |
| Writing featured | Yes | `pieces/writing/english-is-the-new-frontier.yaml` |
| cooking | **Dropped** | zero files |
| Berlin / WordPress | **SSR, not files** | `lib/berlin.ts` |
| Video essays | Empty | no `section: video` |
| Career rows | Yes (new) | `pnc.yaml`, `herl.yaml`, `the-pitt-news.yaml`, `hse.yaml`, `pitt.yaml` |
| `/me` copy | Yes | inlined in `me.astro` |
| `/me` portrait asset | Partial | id reserved in `cloudinary-map.mjs`, missing from `cloudinary-manifest.json` |
| Pitch deck PDF | Yes | `public/pitch-deck.pdf` (2.5M) |
| Resume | Yes | `public/Resume.pdf` |
| Switch embed | Yes | `public/switch-menu/` (752K, no maps) |

---

## Method note

Read: `package.json`, `astro.config.mjs`, `vercel.json`, `svelte.config.js`, `tsconfig.json`, `.nvmrc`, `.env.example`, `.gitignore`, `.prettierrc`, all of `src/pages`, `src/content.config.ts`, `src/middleware.ts`, layouts, chrome, lib, islands listed above, collection files, `public/switch-menu/index.html`, `src/styles/global.css`, `writeup.css`, a prior `.vercel/output/config.json`, and `docs/v3-architecture-delta.md` as a checklist only. Did not treat the delta as runtime fact. Did not modify application code.
