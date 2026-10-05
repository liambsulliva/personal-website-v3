# v2 vs v3 comparison

Compared the 2026-10-04 primary-source audits:

- `docs/research/2026-10-04-v2-site-audit.md` in personal-website-v2
- `docs/research/2026-10-04-v3-site-audit.md` in personal-website-v3

Triage labels match `/triage`: one category (`bug` or `enhancement`) and one state (`ready-for-agent`, `ready-for-human`, `needs-info`, `needs-triage`, `wontfix`). These are recommendations. Nothing was filed on GitHub. v3 has no `.git` in the tree that was audited.

Locked product decisions from `docs/v3-architecture-delta.md` are treated as law for v3. A v2 feature that the delta dropped is `wontfix` here, not a miss.

---

## Verdict

v3 is the better site architecture. It has real wing routes, Zod collections, shared chrome, light/dark, and HTML first paint for photos and Berlin posts. v2 is the better *finished dark museum*: one long homepage, a live photography CMS with upload, cooking, and email in the footer.

v3 still needs a seeded `/me` portrait, slash-safe redirects, a few chrome bugs, and a decision on how photos get tagged now that the dashboard is gone. It does not need the v2 hash homepage, dice carousel, cooking drawer, or dashboard back in this repo.

The identity split is visual as much as architectural. v2 is a dark maker's desk with one cyan neon. v3 is a daylight museum whose rooms are color. Same Geist, same person, different building.

---

## Art direction

Sources: v2 `Layout.astro` tokens and `index.astro` / `Card.astro` / `Footer.astro` / `case-study-editorial.css`; v3 `global.css` Figma tokens, `LobbyHero.astro`, `NavLink.astro`, `SubpageHeader.astro`, `writeup.css`; Figma frames Desktop Index Light `16:173`, Dark `17:489`, Engineering `24:329`.

### v2. Night studio, one accent, long scroll

The whole site is one room. Background `#0f0f0f`, cards `#151515`, hairline `#333333`, footer `#101010`. Text is white down to `#d0d0d0` / `#b0b0b0`. The only brand color is a cyan-to-white gradient on the word "Liam": `rgb(43, 198, 255)` through `rgb(204, 245, 255)` into white. `theme-color` is `#0f0f0f`. There is no light theme.

Type is Geist Sans with `-1px` condensed headlines. Home body is 20px / 1.6 in a 1150px column. Write-up titles clamp to about 2.6rem, tight tracking, always white. Martian Mono shows up only in case studies. A fixed "CONTENTS" rail at 1375px, 12px bold gray, fades in and highlights the hash you are in. Under 1400px it vanishes and uppercase section labels take its place.

Motion is entrance and loop. Cards sit at `opacity: 0` until an IntersectionObserver adds `.visible`. The hero types "I want to make the web" then cycles delightful / seamless / whimsical / snappy in an infinite delete-and-retype. Photography has a dice control. The 404 is a camera: viewfinder corners, aperture mark, "Twist me!" on a focus dial.

Voice is first-person portfolio. "Hi! My name is Liam." Footer copy is "Built with Love by Liam Sullivan" on a full-bleed bar with Email, Resumé, LinkedIn, GitHub as 14px text links. Project cards are 16:9 contain images in `#151515` wells, tool badges, hover to `#181818`. It feels like a late-night personal site: dense, a little demo-scene, one neon sign in a dark room. You walk the work by scrolling.

### v3. Daylight museum, a color per room, lobby as wayfinding

Light is the designed default. Paper `#ffffff`, near-black type, muted `#3a3a3a`, surfaces `#eaeaea` / `#f0f0f0`, borders `#cccccc`. Dark mode reuses v2's night greys (`#0f0f0f`, `#151515`, `#333333`) as after-hours lighting, not as a different product. Color is how you know which wing you are in:

| Wing | Light | Dark |
| --- | --- | --- |
| Me | walnut `#5c3a21` | `#cea580` |
| Career | `#1f4fff` | `#7baeff` |
| Engineering | `#008a3e` | `#81d7a5` |
| Design | `#c800e0` | `#e99af7` |
| Photography | `#c99700` | `#f5cf77` |
| Writing | `#e8360a` | `#ffa581` |
| PNC mark | `#f58025` | `#f79d57` |

Those values are Figma variables registered so `html.dark` tweens them. Focus ring uses career blue.

The lobby is empty on purpose. Three walls: identity top-left, stair-step nav right, Logomark + Pittsburgh clock bottom. Hero copy is the thesis: "I'm Liam." walnut, underlined, a door to `/me`. "Business Systems Analyst" in career blue with a chair icon. "PNC" in orange with the mark. Then "This is my virtual museum." Nav type is signage, not a contents list: Me at 100px down to Writing at 40px, right-aligned, icon overflowing its slot, underline on hover, bold on press. Socials shrink to file / GitHub / LinkedIn icons. Controls are sun-moon and zap.

Subpages are labeled rooms. A 20px "Liam Sullivan" name bar, six compact glyphs, then a 56px title in the wing color. Engineering in Figma is a stack of image-left cards, language bars, pill badges, gray media wells. Write-ups keep the 760px column but restyle it: 18 / 1.65 muted body, 12px tracking-wide eyebrow in `--wing`, links underlined in a mix of the wing color.

Motion is hover and one greeting. No route crossfade. Cards lighten. Compact-nav glyphs scare-bounce away from the cursor. Theme colors tween 200ms. The hero types once per session, then stays finished. Zap kills decoration so the museum can be read.

### What the two vibes do to a visitor

v2 says: here is everything I made, stay a while, watch the typewriter, roll the dice. It is a studio visit at night.

v3 says: pick a gallery. The building orients you before you see a project. It is a museum foyer at opening time. Dark v3 is the same foyer after hours, still color-coded, not the old cyan desk.

Things that leak v2's play into v3's foyer: PNC bounce, BSA chair, name-wave on the header, Logomark spring, Timer cube, card press-scale. Figma's index is still type. Those extras are the `needs-triage` motion item below. Cyan as the site's only accent is gone on purpose; putting it back on dark mode would fight the wing system.

---

## Pros and cons

### v2

**Pros**

- Dark studio look: `#0f0f0f` field, cyan gradient on "Liam", 1150px long-scroll, CONTENTS rail, looping typer, dice, camera 404.
- Write-ups are designed case studies with working demos: HERL book, Switch iframe plus RAWG proxy, Invisible Hand PDF/bezier/album/Figma, Kingdra phone mockup.
- Photography is a real CMS. Featured carousel, tagged masonry, lightbox, bcrypt dashboard, signed uploads, public search policy.
- About copy is specific: Nikon D200, CS + DNID, BSA at PNC.
- Other Work holds layouts, graphic design, design club PDFs, cooking, a personal Substack link, and Berlin via WordPress.
- Switch embed is hardened: CSP `frame-ancestors`, HTML redirect, RAWG key stays on the server.
- 404 focus dial is a craft piece, not a blank status page.
- Shiki `CodeBlock` is server HTML.

**Cons**

- Homepage is a hash page. About, projects, UX, photo, extracurriculars are not routes.
- Photos and Berlin posts paint as loaders until `client:load` / `client:visible` fetches run.
- Chrome is dark-only. No shared header. Photography, dashboard, and 404 omit the footer. Photography has no `h1`.
- Project cards ignore `viewBtn`. `demoBtn` values `/herl-app` and `/switch-react-menu` would 404. `projectLink` is not root-absolute.
- Bridge write-up is unlinked. HERL bookmarks fire `openToPage` with no listener.
- OG tags use `name=` not `property=`, and title/url are not per page. No sitemap or `site`.
- `DescriptionTyper` loops forever and ignores `prefers-reduced-motion`.
- Dead weight: unused Footer, RedDotDemo, `react-image`, `dotenv`, switch-menu source maps, twin editorial image trees.

### v3

**Pros**

- Daylight museum look: paper field, walnut Liam, a hue per wing, stair-step signage, empty lobby, "This is my virtual museum."
- Lobby is nav only. Wings are `/me`, `/career`, `/engineering`, `/design`, `/photography`, `/writing`.
- `career`, `projects`, `pieces` collections with Zod. Write-ups are MDX. Bridge is a real engineering write-up.
- Photography and Writing SSR the first payload and set `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`. No `WordpressFetcher`. No `client:load`.
- Shared `SubpageLayout` on public subpages including 404. Theme defaults to light, cycles light → dark → system, no FOUC. Zap sets `data-reduced-motion`.
- Dashboard and mutating Cloudinary routes are absent, as specified.
- Switch HUD is Astro. Embed path is `/engineering/switch-react-menu`. Source maps are stripped.
- New work v2 never had as routes: Career timeline, card-only Claudia / Fruit / Compression Wars, versioned Logomark, Timer, mobile `popover` menu.
- `astro.config.mjs` sets `site: "https://liambsullivan.com"`. Canonical and per-page title exist.

**Cons**

- No `.git`, README, or CI in the audited directory.
- `/me` portrait id `site/me/portrait` is not in `cloudinary-manifest.json`. The image will skeleton until that public_id exists.
- Compiled 301s are unslashed only (`^/other-work$`). Old `/other-work/` and `/projects/.../` URLs may miss the redirect.
- `ArticleCard` always draws the external-link icon. `Socials` marks `/Resume.pdf` as `external`.
- Footer is Logomark + Timer. No mailto. v2's FlowCV resume link is gone; v3 links `public/Resume.pdf` instead.
- Extra motion vs delta §15: card `:active` scale, TimelineRow hover, name-wave, Logomark spring, Timer cube, PNC bounce / BSA chair. Zap kills CSS animation; SVG SMIL in `Loader` may keep spinning.
- Writing has no `section: substack` files. The one v2 personal piece is Featured. Video essays stay empty.
- HERL bookmarks still dispatch `openToPage`; `Book.svelte` still does not listen.
- OG image is `/banner.jpg`, not an absolute URL. No sitemap or robots.txt.
- Local `.env` has no `RAWG_API_KEY`, so the Switch proxy returns 503 until that is set in the host env.
- 72MB of PDFs still live in `public/presentation`.
- No in-repo way to upload or retag Cloudinary photos.

---

## What v3 is missing from v2

### Accidental or still broken

| v2 holding | v3 status | Triage |
| --- | --- | --- |
| Working `/me` portrait | Copy is inlined. Portrait Cloudinary id is unseeded. Delta asked for a local asset. | `bug` / `ready-for-human` |
| Trailing-slash old URLs | 301 map exists without `/?` | `bug` / `ready-for-agent` |
| Mailto in chrome | Missing. Socials are Resume, GitHub, LinkedIn. | `enhancement` / `needs-triage` |
| HERL bookmark page-turn | Same broken port: event with no listener | `bug` / `ready-for-agent` |
| Footer contact block | Replaced by Logomark + Timer. Email gone. | covered by mailto item |
| FlowCV resume URL | Replaced by `/Resume.pdf` | `enhancement` / `needs-triage` |
| Absolute-ish OG sharing | Per-page title exists; `og:image` is root-relative | `bug` / `ready-for-agent` |
| In-site photo tagging / featured checkbox | Dashboard omitted. No replacement workflow in this repo. | `enhancement` / `needs-info` |
| Public tag list hygiene | Tags GET still returns the full cloud list | `enhancement` / `ready-for-agent` |

### Present but weaker

| v2 holding | v3 status | Triage |
| --- | --- | --- |
| Internal PDF cards look local | `external: false` only drops `target="_blank"`. Icon still shows. | `bug` / `ready-for-agent` |
| Reduced-motion on some chrome | Zap is real for CSS. SMIL loader and extra keyframes remain. | `bug` / `ready-for-agent` for SMIL + spec-violating hover/scale. Extra lobby motion is `needs-triage`. |
| Long-scroll "all my work on one page" | Intentional lobby. Content lives on wings. | `wontfix` |
| Dark-only crafted look | Light default is locked. Dark still exists as a class. | `wontfix` |

### Dropped on purpose

| v2 holding | Why it is gone | Triage |
| --- | --- | --- |
| `/dashboard` and mutating Cloudinary APIs | Delta: separate repo later | `wontfix` |
| Cooking entries | Delta: cooking stays out | `wontfix` |
| `/other-work` junk drawer | Split to Design + Writing | `wontfix` |
| Hash homepage sections | Lobby + wings | `wontfix` |
| Dice / `randomize` carousel | Banned | `wontfix` |
| `DescriptionTyper` loop | One-shot lobby typer, SSR finished lines | `wontfix` |
| `WordpressFetcher` client fetch | SSR `berlin.ts` | `wontfix` |
| SideBar, duplicate Footer, RedDotDemo, `client:load` galleries | Deleted or replaced | `wontfix` |
| Video essays | Empty until authored | `wontfix` |
| Second Substack list | v2 had one personal file; v3 put it in Featured | `wontfix` |

v3 also **adds** things v2 lacked: `/career`, `/me` as a route, `/engineering` and `/design` indexes, three card-only projects, theme + zap, Timer, versioned Logomark, mobile menu, Bridge in the index, SSR photo/Berlin HTML, `site` + canonical.

---

## Improvement sites

Ordered by how much they block a public v3. Each row is triaged.

### Ship blockers

**`/me` portrait is empty.** `bug` / `ready-for-human`. An agent can switch `CldImage` to a local file, but someone has to supply the portrait. Delta called for a local asset. Do not invent a face.

**Trailing-slash 301s.** `bug` / `ready-for-agent`. Desired: each source in `astro.config.mjs` `redirects` also matches the trailing-slash form. `/dashboard` stays 404.

**RAWG key in the deploy env.** `bug` / `ready-for-human`. Code is done. Local `.env` and the host must define `RAWG_API_KEY` or the Switch iframe's live data 503s.

### Chrome and a11y bugs

**ArticleCard external icon.** `bug` / `ready-for-agent`. When `external` is false, do not render the external-link icon. `target` already respects the prop.

**Resume marked external.** `bug` / `ready-for-agent`. `Socials.astro` passes `external` for every `SOCIALS` item. `/Resume.pdf` should stay same-tab unless the design says otherwise.

**OG image URL.** `bug` / `ready-for-agent`. `og:image` / `twitter:image` should be `new URL("/banner.jpg", Astro.site)`. Keep `site` in astro config.

**HERL bookmarks.** `bug` / `ready-for-agent`. `Book` should listen for `openToPage` and open/flip to `detail.targetPage`, or bookmarks should not be buttons. Zap should skip tilt, which already happens.

**Loader vs zap.** `bug` / `ready-for-agent`. SVG SMIL in `Loader` should stop when `data-reduced-motion` is set. CSS `animation: none` does not cover SMIL.

**Press-card scale and TimelineRow hover.** `bug` / `ready-for-agent`. Delta §15: cards lighten/darken only, no scale. TimelineRow hover is none. Remove `press-card` scale and the timeline ghost highlight.

### Enhancements an agent can take

**Sitemap and robots.** `enhancement` / `ready-for-agent`. Add `@astrojs/sitemap` or a static `sitemap.xml`, plus `public/robots.txt` pointing at it. Include SSR routes `/photography` and `/writing`.

**Skip link.** `enhancement` / `ready-for-agent`. First focusable control in `RootLayout`: skip to `main`.

**Timer with no JS.** `enhancement` / `ready-for-agent`. SSR a static `America/New_York` clock string as the placeholder. Hydrate ticks after `client:idle`. Do not leave the footer time `visibility: hidden` for no-JS.

**Tags API filter.** `enhancement` / `ready-for-agent`. Server should drop `featured` and tags starting with `_` the way v2's menu did in the browser.

### Needs a person

**Git + README.** `enhancement` / `ready-for-human`. The tree is not a repo. An agent should not invent the remotes or license.

**`MAIN_SITE_REPO` on switch-react-menu.** `enhancement` / `ready-for-human`. Lives in another repository's Action variables.

**72MB of `/presentation` PDFs.** `enhancement` / `ready-for-human`. They are linked from design-club pieces. Moving them is a hosting choice, not a code tidy.

**How featured photos get tagged.** `enhancement` / `needs-info`. v3 can only read Cloudinary. Who writes `featured` now: a future dashboard repo, the Cloudinary console, or a script?

### Needs a design call

**Extra lobby motion.** `enhancement` / `needs-triage`. PNC bounce, BSA chair, name-wave, Logomark spring, Timer cube are built and not in §15. They pull v2's maker-desk play into v3's foyer. Keep as craft or cut to the Figma allowlist.

**Cyan as dark-mode accent.** `enhancement` / `needs-triage`. v2's identity is one cyan neon. v3 dark already uses v2 greys but keeps the six wing hues. Restoring cyan as the global accent would fight the museum color system.

**Mailto in chrome.** `enhancement` / `needs-triage`. v2 footer had `mailto:liambsullivan@gmail.com`. Figma socials may have dropped email on purpose.

**FlowCV vs `Resume.pdf`.** `enhancement` / `needs-triage`. v3 already ships the PDF. Confirm that is the canonical resume.

**Empty `alt` on cards.** `enhancement` / `needs-triage`. Titles sit next to the image, so empty alt can be correct. Only fill alt if the crop is the content.

---

## Agent briefs for `ready-for-agent` items

### Trailing-slash redirects

**Category:** bug
**Summary:** Old v2 URLs with a trailing slash should 301 the same way as the unslashed sources.

**Current behavior:** `astro.config` redirects compile to `^/other-work$` and `^/projects/...$`. `trailingSlash: "ignore"` does not add `/?` to those regexes.

**Desired behavior:** `/other-work/` → `/design/`. `/projects/kingdra-app/` → `/engineering/kingdra-app/`. Same for herl, switch, invisible-hand, bridge, and `/ux/kingdra-case-study/`. `/dashboard` and `/dashboard/` stay 404.

**Acceptance criteria:**

- [ ] Each documented 301 source matches with and without a trailing slash
- [ ] Destination paths stay the wing URLs
- [ ] `/dashboard` is still not a product route

**Out of scope:** Hash URLs. Apex DNS. Changing `/other-work` to `/writing`.

### ArticleCard external icon

**Category:** bug
**Summary:** Internal pieces should not show an outbound icon.

**Current behavior:** The external-link icon always renders. `external` only toggles `target="_blank"`.

**Desired behavior:** Icon renders only when `external` is true. Design-club and layout PDFs with `external: false` look internal.

**Acceptance criteria:**

- [ ] `external={false}`: no external-link icon, same tab
- [ ] `external={true}` or default: icon plus `rel="noopener noreferrer"`
- [ ] Berlin cards stay outbound

**Out of scope:** Redesigning ArticleCard layout.

### Resume same-origin

**Category:** bug
**Summary:** The resume IconButton should not be treated as a third-party tab.

**Current behavior:** `Socials` sets `external` on every item, including `/Resume.pdf`.

**Desired behavior:** Only http(s) off-origin hrefs get `external`.

**Acceptance criteria:**

- [ ] `/Resume.pdf` opens in the same tab without the external affordance
- [ ] GitHub and LinkedIn stay external

**Out of scope:** Adding mailto. Changing the PDF file.

### Absolute OG image

**Category:** bug
**Summary:** Social crawlers get a full URL for the share image.

**Current behavior:** `og:image` and `twitter:image` are `/banner.jpg`.

**Desired behavior:** Absolute URL from `Astro.site`. Other OG fields stay per-page.

**Acceptance criteria:**

- [ ] Rendered `og:image` starts with `https://liambsullivan.com/`
- [ ] Missing `Astro.site` does not crash the layout

**Out of scope:** New artwork. JSON-LD. Sitemap.

### HERL bookmarks

**Category:** bug
**Summary:** Bookmark tabs should open the book to the labeled year, or they should not be buttons.

**Current behavior:** `Bookmark` dispatches `openToPage`. `Book` never listens. `isFlipped` is not set from a click.

**Desired behavior:** A closed book opens and turns to `targetPage`. An open book jumps to that page. Reduced motion skips tilt, not the page jump.

**Acceptance criteria:**

- [ ] Clicking 1995 / 1996 / 2001 / 2004 / 2011 / 2023 changes the visible page
- [ ] Zap still disables tilt
- [ ] Keyboard/button labels stay the year strings

**Out of scope:** Rewriting the 35-page CSS 3D model. Svelte 5 runes migration.

### Zap stops the loader

**Category:** bug
**Summary:** The photography loader must not keep pulsing under zap.

**Current behavior:** Dots use SVG SMIL `<animate>`. Global CSS `animation: none` does not stop SMIL.

**Desired behavior:** No looping motion when `data-reduced-motion` is set, including the loader.

**Acceptance criteria:**

- [ ] With zap on, loader dots are static
- [ ] With zap off, existing motion remains

**Out of scope:** Redesigning the loader mark.

### Card and timeline hover vs §15

**Category:** bug
**Summary:** Cards and career rows follow the motion allowlist.

**Current behavior:** `press-card` scales on `:active`. `TimelineRow` highlights on hover.

**Desired behavior:** Cards lighten/darken at `--motion-fast` with no scale. Timeline rows have no hover motion.

**Acceptance criteria:**

- [ ] ProjectCard and ArticleCard `:active` does not scale
- [ ] TimelineRow hover does not tint or move
- [ ] Zap still zeroes transitions

**Out of scope:** PNC bounce, name-wave, Logomark spring, Timer cube. Those are a separate `needs-triage` item.

### Sitemap and robots

**Category:** enhancement
**Summary:** Crawlers get a sitemap and a robots pointer.

**Current behavior:** `site` is set. No `@astrojs/sitemap`, no `robots.txt`.

**Desired behavior:** A sitemap that includes static wings, write-up slugs, `/photography`, and `/writing`. `robots.txt` allows indexing and points at the sitemap.

**Acceptance criteria:**

- [ ] `robots.txt` is served at `/robots.txt`
- [ ] Sitemap lists the public HTML routes above
- [ ] `/dashboard` is not listed because it does not exist

**Out of scope:** JSON-LD. Changing meta descriptions.

### Skip link

**Category:** enhancement
**Summary:** Keyboard users can skip chrome to `main`.

**Current behavior:** No skip link in Astro layouts.

**Desired behavior:** A skip control is the first tab stop on every page and moves focus to the main landmark.

**Acceptance criteria:**

- [ ] Present on lobby and subpages
- [ ] Visible on focus
- [ ] Target exists on those pages

**Out of scope:** A full a11y audit.

### Timer first paint

**Category:** enhancement
**Summary:** The footer shows Pittsburgh time without waiting on `client:idle`.

**Current behavior:** Timer placeholder is `visibility: hidden` until hydrate.

**Desired behavior:** SSR a minute-resolution `America/New_York` string. The island replaces it when idle JS runs. No-JS keeps the SSR string.

**Acceptance criteria:**

- [ ] HTML source contains a time string before any Timer JS
- [ ] After hydrate, the clock still ticks
- [ ] Timezone stays `America/New_York`

**Out of scope:** 12h/24h cube interaction.

### Public tags filter

**Category:** enhancement
**Summary:** The public tags endpoint does not list internal tags.

**Current behavior:** GET `/api/cloudinary/tags` returns every tag. The gallery used to hide `_` prefixes and `featured` in the client.

**Desired behavior:** The JSON response already omits `featured` and tags that start with `_`.

**Acceptance criteria:**

- [ ] Response never includes `featured`
- [ ] Response never includes a tag starting with `_`
- [ ] Photography chip row still has the public tags

**Out of scope:** Auth on the tags route. Dashboard.

---

## Sources

- v2 audit, 2026-10-04
- v3 audit, 2026-10-04
- Spot-check: v3 `Book.svelte` has no `openToPage` listener; `ArticleCard.astro` always renders `external-link`; `Socials.astro` passes `external` for every item; `SOCIALS` is Resume / GitHub / LinkedIn only; `me.astro` uses `CldImage id="site/me/portrait"`
