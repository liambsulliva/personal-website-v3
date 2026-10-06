# /photography: album stacks — implementation plan

Status: **ready, grilled and design approved 2026-10-05**. Figma: AlbumStack `190:586`, desktop
`190:3925`, album-open `190:4386`, mobile `190:4535` in
[personal-website-v3](https://www.figma.com/design/qG8iY9Elr0VlGXyjC84hSX).

## Context

The Featured carousel (5 `featured`-tagged photos in `FeaturedCarousel.tsx`) goes away. In its place,
with no section label: a carousel of **album stacks**, one per photo shoot. Clicking a stack
**explodes** its cards into the existing masonry gallery, replacing the gallery's contents with the
album. Clicking a tag chip (or the stack's empty slot, or another stack) **collapses** the album back
into its stack before the next contents fill the gallery. The lightbox works on album photos exactly as
it does today. Animations are elastic, run in sequence and never overlap.

Albums come from the shoot folders on the photo drive (~250 folders, 2017–2026, named
`Title M-DD`). Cloudinary has no link back to them: 841 photos at the root, random public_ids, no
folder data. About a third still carry EXIF `DateTimeOriginal`. The Search API never returns it, so it
has to come from the Admin API, which allows 500 calls an hour.

## Decisions (settled in the grill)

| # | Decision |
|---|---|
| Albums | Membership = photo ids in the generated `src/data/albums.ts` (`npm run photos:albums -- build`, offline), with title, date, count and preview photos. Nothing is tagged in Cloudinary. Folder names are published as they are, including models' names. *(Changed 2026-10-05 from hidden `_album-<slug>` tags: no writes to Cloudinary, and album lookups cache until the next deploy.)* |
| Threshold | An album appears only with **≥ 5** photos. Undated folders take the date of their earliest photo; if none of their photos is dated, the label shows **the year only** (`2024 · 12 photos`). |
| Folder names | Folders cut off in the screenshots keep the cut-off name with a trailing `...` for now. A cut-off date (`3-...`) counts as undated. `□` in the screenshots is `-`. |
| Folders | `scripts/album-folders.json` comes from the NAS (`/PhotoDrive/<YYYY> Photos/<shoot>`, plus `TPN Sophomore Year/<shoot>` for 2023–24, year from the folder's creation date). One album per shoot folder; files in its subfolders count toward it (no nested albums). Undated shoots carry their NAS import date. `2016 Point and Shoot` (camera dumps) is left out. |
| Assignment | A script matches photos to folders by, in order: the photo's camera file found in a date-consistent NAS shoot folder (`nas`, Synology search, cached in `scripts/.cache/nas-hits.json`); the photo's own name (`PulisCarShow-10` → "Puli's Car Show"); capture date (EXIF, or Flickr's date taken for Flickr originals, whose Cloudinary copies lost their EXIF); a folder dated a day off (`nearby`); and dated neighbours in upload order (`inferred`). Same-day folders are split by tags. `ambiguous` placements are left out until reviewed. Flickr is only used by this offline script; the site reads Cloudinary alone. |
| Section | The "Featured!" label is removed; the carousel leads with no label. The `featured` tag, `toFeaturedSlide`/`FeaturedSlide` and `FeaturedCarousel.tsx` are deleted. `Carousel.tsx` stays (`PDFCarousel` uses it). |
| Carousel | Several stacks visible at once in a native scroll-snap track. Swipe or use the existing round prev/next buttons, which are hidden on mobile. Newest first, no year markers. |
| Stack | Three tilted print-cards (4px bg border, soft shadow). Hover/focus fans the back cards on a spring. Press squishes to 0.96. Open = dashed `border`-coloured outline around the 60% skeleton, title kept. No dragging. Label: title, then `May 2026 · 24 photos`. |
| Explode | No overlay, no blur. Press → clear (all tiles fade and shrink together, ≤ 200ms) → cards fly into the gallery tiles currently on screen (≤ 12, 15–25ms stagger, elastic spring) → handoff to the real tiles. Tiles off screen just appear. |
| Collapse | Triggered by a chip, the open stack's dashed slot (restores the previous tag), or another stack (collapse, then explode, strictly in sequence). Visible tiles fly back into the stack. If the stack is off screen they squash out through the viewport edge toward it (`exitToward`). **Never auto-scroll.** |
| Chips | None is selected while an album is open. |
| Timing | Each phase ≤ 200ms, and each phase starts on a *measured* end state (the `whenFrame` pattern). Closing mid-explode reverses from where the cards currently are. Any other click during a transition is ignored. Reduced motion = instant swap. |
| Loading | Stack previews are SSR'd (no fetch on mount). An album's photos come all at once on click from `api/cloudinary/album?slug=` (looks up its ids in Cloudinary; CDN-cached a day). Chips (All included) fetch their whole pool once from `api/cloudinary/pool`, shuffle it per selection and page locally; the first All page is shuffled on the server. |
| URL | No `?album=` state for now. Keep the gallery's source a plain serializable value so it can be wired to the URL later. |
| Lightbox | Unchanged. Album photos are ordinary gallery tiles, so the existing tile ↔ lightbox flight applies as is. |

## Steps

### 1. Album data pipeline (no site changes)

- **`scripts/album-folders.json`**: the 10 screenshots transcribed as `{ "2026": [...], …, "2017": [...] }`.
  Cut-off names are kept as shown, ending in `...` (e.g. `Christopher Maverick Silhouette 3-...`,
  `Higher Education-Free Speech Ra...`), and can be completed in the JSON later. `□` is transcribed as
  `-` (`Palestine Protest 9-3`, `Moab 3-3-9`).
- **Date parser** (pure, unit-tested): `M-DD`, `M-D`, `M-DD-YY` (`2-18-22`, `10-3-21`), ranges
  (`Moab 3-3-9`, `Game Jam 10-18 to 10-20`), trailing junk (`(Digital)`, `!(9-25)(JPEG ONLY)`), and
  undated folders (`Berlin`, `Otakon 2025`). A cut-off name (`...`) whose date is incomplete
  (`3-...`, `8-14 t...`) uses its first complete date, or counts as undated if there isn't one.
  Title = name with the date stripped; a cut-off title keeps its `...`. Slug = `<year>-<kebab-title>`.
- **`scripts/photo-albums.mjs`**. Move the signed-tag and search helpers out of
  `scripts/photo-tags.mjs` into `scripts/lib/cloudinary.mjs` so both scripts share them.
  - `exif`: lists every photo through Search, then calls Admin `resources/image/upload/<id>?image_metadata=true`
    per photo and caches the results in `scripts/.cache/photo-exif.json` (`.cache/` is already
    gitignored). It is resumable: it stops while `x-featureratelimit-remaining` > 10 and prints the
    reset time. 841 calls means two runs about an hour apart.
  - `propose`: matches by the local date of `DateTimeOriginal` against each folder's date or range.
    Same-day collisions (e.g. 2026-04-11 *Bigelow Bash* `music` vs *Puli's Car Show* `cars`) are split
    with a tag hint per folder in `album-folders.json`. Undated photos inherit an album when the dated
    photos on both sides of them in upload order agree and the tags overlap; these are marked
    `inferred`. Output: `scripts/album-proposal.json` (you review and edit it) plus a local contact
    sheet `scripts/.cache/proposal.html` with thumbnails per album, plus an unassigned list.
  - `apply`: writes `_album-<slug>` tags from the approved proposal through the existing signed `tags`
    endpoint, then generates **`src/data/albums.ts`**: `{ slug, title, date, count, preview:
    PhotoResource[3] }[]` for albums with ≥ 5 photos, newest first. Previews are the first 3 in upload
    order, so SSR needs no Cloudinary calls.
- Tests (`tests/lib/pure.test.ts`): date parser cases, the slug, and the ≥ 5 filter.

### 2. Search policy: ascending order for albums

- `src/lib/cloudinarySearchPolicy.ts`: accept `sort=asc` **only** for `resource_type:image AND
  tags=_album-*` expressions. `publicCloudinarySearchUrl` gains an optional `sort`.
- `src/pages/api/cloudinary/search.ts`: pass `sort_by: [{ created_at: "asc" }]` when sanitized.
- `src/lib/albums.ts`: `Album` type, `albumTag(slug)` and `albumExpression(slug)`.
- Tests: the policy accepts `sort` only with an album tag and rejects it for plain tags.

### 3. Stack + carousel components

- **`AlbumStack.tsx`**: a `<button>` holding three `ProgressiveImage` cards, each marked
  `data-album-card`. Rest/hover transforms come straight from Figma: rest `card/3` 7° (+6, −2) and
  `card/2` −5° (−5, −5); hover `card/3` 11° (+30, +2), `card/2` −9° (−28, +2), `card/1` lifts 8px.
  `:hover`/`:focus-visible` transitions use a spring exported from `lightboxFlight.ts` (export
  `springValues`/`toLinear` and add a `SPRING_EASING` constant), so the fan overshoots the same way the
  flights do. Press uses `.squishy` plus a new `.squishy-stack { --press-scale: 0.96 }` in `global.css`.
  The `open` prop renders the dashed dropzone (`border-[1.5px] border-dashed border-border
  bg-skeleton/60`).
- **`AlbumCarousel.tsx`**: a `scroll-snap-type: x mandatory` track, with the scrollbar hidden like
  `.tag-menu`, 288px stacks with a 24px gap (16px on mobile). It needs vertical padding plus a matching
  negative margin so the hover fan and shadows aren't clipped by `overflow-x: auto`. Prev/next:
  **export `CarouselNavigationButton` from `Carousel.tsx`** instead of copying it. Each button scrolls
  one track width, is disabled at either end, and is `hidden md:flex`. Arrow keys work while focus is
  inside, mirroring `Carousel.tsx`.

### 4. One island, one source of truth

The stacks and the gallery have to share state, and separate Astro islands can't, so they become one island.

- `PhotoGallery.tsx` takes an `albums` prop and renders `<AlbumCarousel>` above `<TagMenu>`.
- Replace `tag` with `source: { kind: "tag"; tag: string } | { kind: "album"; slug: string }`.
  `loadPage(source, cursor)` builds either the tag expression or the album expression plus `sort: "asc"`
  (album pages are 50; tag pages stay 20).
- `TagMenu` `selected: string | null`, where `null` means no chip is selected.
- Before an album opens, snapshot `{ source, photos, cursor }` so the dashed slot can restore the
  previous tag without a refetch.
- `photography.astro`: drop the featured search, the slide preload and the `SectionLabel`, and pass
  `albums` from `src/data/albums.ts`. Map the previews with `toGalleryPhoto`.
- Delete `FeaturedCarousel.tsx`, `toFeaturedSlide`/`FeaturedSlide` and their test.

### 5. Animation queue (the no-overlap guarantee)

- **`useGalleryTransitions`**: a hook with a single serial queue. `request(next)` either runs now or
  *replaces* the one pending request (latest wins, so there is never a backlog). Transitions also wait
  for any lightbox flight to land (`flightRef` is idle), and `openPhoto` keeps ignoring clicks while a
  transition runs. The phase is exposed for guards, mirroring `Flight.phase`.
- **`albumFlight.ts`**: DOM helpers next to `lightboxFlight.ts`, reusing `createFlyer`, `fly`
  (elastic `springFor`), `boxOf`, `inViewport`, `exitToward`, `allFinished`, `whenFrame`,
  `decodeWithin`, `pressPulse` and `mark`.
- **Explode**: `press` (stack pulse, meanwhile fetch page 1 and decode the previews) → `clear` (one
  ≤ 200ms fade + 0.96 scale on the gallery container; wait for opacity 0 with `whenFrame`) → await the
  fetch (keep `Loader` if it's slow) → swap photos, `afterPaint`, measure the on-screen tiles (≤ 12) →
  `fly`: flyers start at the stack's card rects (cards 1–3, then the top card's rect for the rest),
  staggered 20ms, and the stack flips to `open` the frame they spawn → `land`: each tile shows and its
  flyer is removed in the same task; the remaining tiles fade in.
- **Collapse**: reverse fly (on-screen tiles → stack rect, or `exitToward` when the stack is off
  screen) → stack `open → rest` with a settle dip → the next source fills in (a new album runs Explode;
  a tag fades in from the fetch or the snapshot).
- **Interrupt**: a collapse request during the `fly` phase reads each flyer's live
  `getBoundingClientRect()`, cancels its animations and flies it back from there. Every other request
  during a transition is ignored (stack clicks are dropped, and the latest chip click waits as the
  pending request).
- **Reduced motion** (`data-reduced-motion`): no flyers or fades; the swap and the stack state change
  instantly.
- Add DEV `performance.mark`s (`ab:E1-press` …) so phases can be checked in the Performance panel, the
  same way `lb:` marks work today.

### 6. Verification

- `npm test` (`vitest`): parser, policy and shaping tests. Update `tests/components/render.test.ts` if
  the photography render test shape changes.
- `npm run build` (`astro check && astro build`), plus `tests/build/output.test.ts`.
- Built-in browser on `astro-dev` (port 4322):
  - The stacks render SSR'd with no layout shift. Hover fans, press squishes, and the arrows and swipe
    snap to each stack.
  - Explode from the first stack: the gallery clears, the cards fly in, and no chip is selected.
  - Chip mid-explode: the album reverses, then the tag loads.
  - Stack → stack: collapse, then explode, with no overlap (check the `ab:` marks).
  - Scroll deep into an album and click a chip: the cards squash out through the top edge and nothing
    scrolls.
  - Open a lightbox from an album photo, close it, then immediately click a chip: the shrink finishes
    before the collapse starts.
  - Reduced motion, a 375px viewport and dark mode.
- Screenshot the key states for the PR.

## Open before implementation

None. Later, optionally: complete the cut-off folder names in `scripts/album-folders.json`, and add
`?album=` URL state.
