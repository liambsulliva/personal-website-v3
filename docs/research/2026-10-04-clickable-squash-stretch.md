# Clickable squash/stretch audit (2026-10-04)

Primary-source inventory of singular clickable controls under `src/components`, plus the career collection that TimelineRow renders. Claims follow a file that was read.

**Press model (after clarification):** not cartoon `scaleX ≠ scaleY`. Same idea as Logomark VersionOption in `src/components/chrome/Logomark.astro`: `:active { transform: scale(0.95) }` (uniform shrink). Release uses a spring cubic-bezier so the control overshoots larger than rest, then settles. Zap (`:root[data-reduced-motion] * { transition: none }`) in `src/styles/global.css` already kills the overshoot.

---

## Existing CSS (before this pass)

From `src/styles/global.css`:

- `.squishy:active` was `transform: scale(1.1, 0.84)` — cartoon squash. Release already used `cubic-bezier(0.34, 2.1, 0.5, 1)`.
- `.press-card:active` was `scale(0.985, 0.97)` — slight squash on large cards.
- Logomark (the reference): `scale(0.95)` on `.logomark__summary:active` and `.version-option:active`.

---

## Singular clickables

| Control | File | Element | Before | Action |
| --- | --- | --- | --- | --- |
| Theme / motion / socials / menu | `chrome/IconButton.astro` | `button` or `a.icon-button__hit` | hover fill only | add `squishy` on hit |
| Compact nav glyphs | `chrome/CompactNavIcon.astro` | `a.compact-nav-icon` | scare-bounce on glyph | add `squishy` on the `<a>` |
| Lobby stair-step | `chrome/NavLink.astro` | `a.navlink` | underline / bold | add `squishy` |
| Home name | `chrome/SubpageHeader.astro` | `a.name-wave` | letter strum | add `squishy` |
| Hero "Liam" | `chrome/LobbyHero.astro` | `a.hero__liam-link` | underline / bold | add `squishy` |
| Version picker | `chrome/Logomark.astro` | `summary`, `a.version-option` | already `scale(0.95)` | spring the release to match `.squishy` |
| Back | `chrome/BackLink.astro` | `a.back-link` | arrow nudge | add `squishy` |
| Mobile close + section links + name | `chrome/MobileMenu.astro` | `button`, `a` | underline on links | add `squishy` |
| Inline marks | `chrome/Mark.astro` | `a.mark` | underline | add `squishy` |
| Tool badges | `cards/Badge.astro` | `a.badge--link` | hover fill | add `squishy` when `href` |
| Write-up CTA | `writeup/WriteupButton.astro` | `a.writeup-button` | hover color | add `squishy` |
| Tag chips + chevrons | `islands/TagMenu.tsx` | `button.chip`, scroll `button` | already `squishy` | keep; inherits new scale |
| Carousel chevrons + dots | `islands/Carousel.tsx` | `button.carousel-nav`, dots | already `squishy` | keep |
| Gallery tiles | `islands/PhotoGallery.tsx` | `button.gallery-tile` | none | add `squishy`; image already `object-cover` |
| Try again | `islands/PhotoGallery.tsx` | `button.chip` | already `squishy` | keep |
| Lightbox chrome | YARL `.yarl__button` | close / prev / next / zoom | library default | global `.yarl__button:active { scale(0.95) }` |
| Lightbox slide | `PhotoGallery.tsx` `LightboxSlide` | sized `div` + `ProgressiveImage` | contain-fit box, `object-cover` | fill `rect`; `object-fit: fill`; `squishy` on wrapper |
| Career rows | `cards/TimelineRow.astro` | was a `div` | ghost hover | become `<a class="squishy">` when `href` |
| Replay | `islands/BezierPlayground/BezierPlayground.tsx` | `button.replay` | color hover | add `squishy` |
| Bookmarks | `islands/Bookmark.svelte` | `button.bookmark` | hover fill | add `squishy` |

### Skip (not a singular clickable control)

| Item | Why |
| --- | --- |
| `ProjectCard` / `ArticleCard` / `FeaturedArticle` | Composite card surfaces; they keep `.press-card` (now uniform `scale(0.97)`) |
| `CaseStudyCard`, write-up grids | Display articles, no click handler |
| `WindowChrome` traffic dots | Decorative `span`s, not buttons (`WindowChrome.tsx`) |
| `Timer` | Hover/focus cube flip, not a click (`chrome/Timer.tsx`) |
| `Book.svelte` pages | Drag / page-turn surface; bookmarks are the discrete controls |
| `BrandingPhotoAlbum` | Photos are not buttons |
| Featured carousel slide | Image only; nav/dots already `squishy` |
| 404 focus dial | `role="slider"`, grab/drag (`pages/404.astro`) |
| Bezier graph | Pointer drag on a canvas, not a button |

---

## Lightbox fill

`yet-another-react-lightbox` `SlideImage.imageFit` is `"contain" \| "cover"` only (`node_modules/yet-another-react-lightbox/dist/types.d.ts`). There is no `"fill"` in the library.

This site already replaces the default slide via `render.slide` → `LightboxSlide` in `src/components/islands/PhotoGallery.tsx`. That wrapper was sized with contain-fit:

```ts
const fit = Math.min(rect.width / naturalWidth, rect.height / naturalHeight, 1);
```

`ProgressiveImage` layers used `object-cover`. For press scale, a contain-fitted box leaves empty slide around the photo. Filling `rect` and using `object-fit: fill` lets the bitmap stretch with the new box (uniform `scale(0.95)` on the wrapper, image fills it). Zoom still wraps the custom slide (`plugins/zoom/index.js` calls `render.slide` inside `ZoomWrapper`).

YARL chrome buttons are `.yarl__button` (`dist/styles.css`). There is no per-button `className` on `Lightbox` props besides root `className` (`types.d.ts`).

---

## Career hrefs

`src/content.config.ts` `career` schema had no `href`. `src/pages/career.astro` passed company/role/dates/monogram/logo only. Official sites used:

| Entry | URL |
| --- | --- |
| HSE | `https://hs-experts.com` (org site; impressum lists HSE Health & Safety Experts GmbH) |
| HERL | `https://herl.pitt.edu` |
| PNC | `https://www.pnc.com` (already used on `/me`) |
| Pitt | `https://www.pitt.edu` |
| The Pitt News | `https://pittnews.com` |

---

## Sources

- `src/styles/global.css` `.squishy`, `.press-card`, reduced-motion
- `src/components/chrome/Logomark.astro` `:active { transform: scale(0.95) }`
- `src/components/islands/PhotoGallery.tsx` `LightboxSlide`
- `node_modules/yet-another-react-lightbox/dist/types.d.ts` `ImageFit`, `Render`, `className`
- `src/content/career/*.yaml`, `src/content.config.ts`, `src/pages/career.astro`
- `src/pages/me.astro` PNC URL
