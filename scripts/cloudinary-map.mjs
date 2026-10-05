// Source of truth for site imagery in Cloudinary (fixed folder mode, so the
// public_id path IS the folder). Convention:
//
//   site/projects/<slug>/cover        ProjectCard media + write-up hero fallback
//   site/projects/<slug>/hero         write-up hero (when different from cover)
//   site/projects/<slug>/<figure>     write-up figures, referenced from MDX
//   site/pieces/<gallery>/<section>/<slug>   ArticleCard media
//   site/me/portrait                  /me portrait
//   site/ui/<name>                    shared editorial chrome (phone frame)
//
// Photography is NOT here: it stays tag-driven (featured, portraits, …) at the
// cloud root, and the photography queries exclude folder:site/*.
//
// `src` is relative to the frozen v2 repo unless `local: true` (relative to
// this repo). Entries without `src` are reserved slots for you to upload by
// hand (the page shows a skeleton until then).

export const V2_ROOT = "../personal-website-v2";

const p = (slug, name, src) => ({ id: `site/projects/${slug}/${name}`, src });
const piece = (gallery, section, slug, src) => ({
  id: `site/pieces/${gallery}/${section}/${slug}`,
  src,
});

export const IMAGE_MAP = [
  // ── Engineering ─────────────────────────────────────────────
  p("kingdra-app", "cover", "src/images/projects/pokedraft.png"),
  p("kingdra-app", "teambuilder-old", "src/images/projects/teambuilder-old.jpg"),
  p("kingdra-app", "grid-based-selection", "src/images/projects/grid-based-selection.jpg"),

  p("switch-react-menu", "cover", "src/images/projects/switch-react-menu-screen.jpg"),
  p("switch-react-menu", "rich-details", "src/images/projects/switch-react-menu-mockup.png"),

  p("herl-app", "cover", "src/images/projects/herlthroughtheyears.png"),
  p("herl-app", "book-front", "src/images/case-studies/herl/Cover-Front.webp"),
  p("herl-app", "book-back", "src/images/case-studies/herl/Cover-Back.webp"),

  p("the-invisible-hand-of-ux", "cover", "src/images/projects/invisible-hand-of-ux.png"),
  p("the-invisible-hand-of-ux", "banner-raster", "src/images/projects/banner-raster.png"),
  p("the-invisible-hand-of-ux", "print-logo-raster", "src/images/projects/print-logo-raster.png"),
  p("the-invisible-hand-of-ux", "banner-color", "src/images/projects/banner-color.png"),
  p("the-invisible-hand-of-ux", "landing-separate-1", "src/images/projects/landing-separate-1.jpg"),
  p("the-invisible-hand-of-ux", "landing-separate-2", "src/images/projects/landing-separate-2.jpg"),
  p("the-invisible-hand-of-ux", "landing-grid", "src/images/projects/landing-grid.jpg"),
  p("the-invisible-hand-of-ux", "landing-sections", "src/images/projects/landing-sections.jpg"),
  p("the-invisible-hand-of-ux", "landing-gif", "src/images/projects/landing-gif.gif"),
  p("the-invisible-hand-of-ux", "cross-linked-terms", "src/images/projects/cross-linked-terms.gif"),
  p("the-invisible-hand-of-ux", "mode-tooltip", "src/images/projects/mode-tooltip.gif"),

  p("bridge-app", "cover", "src/images/projects/bridgeapp.jpg"),

  p("claudia-cooks", "cover"),
  p("how-expensive-is-fruit", "cover"),
  p("compression-wars", "cover"),

  // ── Design ──────────────────────────────────────────────────
  p("kingdra-case-study", "cover", "src/images/projects/mockup.png"),
  p("kingdra-case-study", "hero", "src/images/case-studies/kingdra/ux-banner.png"),
  p("kingdra-case-study", "mobile-view", "src/images/case-studies/kingdra/kingdra-mobile-view.png"),
  p("kingdra-case-study", "menubar", "src/images/case-studies/kingdra/menubar1.png"),
  p("kingdra-case-study", "iconbar", "src/images/case-studies/kingdra/iconbar.png"),
  ...["hamburger", "margins", "tabs", "modal"].flatMap((name) => [
    p("kingdra-case-study", `${name}-before`, `src/images/case-studies/kingdra/${name}-before.png`),
    p("kingdra-case-study", `${name}-after`, `src/images/case-studies/kingdra/${name}-after.png`),
  ]),
  p("kingdra-case-study", "pwa-before", "src/images/case-studies/kingdra/pwa-before.jpg"),
  p("kingdra-case-study", "pwa-after", "src/images/case-studies/kingdra/pwa-after.jpg"),
  p("kingdra-case-study", "horizontal-slots-before", "src/images/case-studies/kingdra/horizontalslots-before.png"),
  p("kingdra-case-study", "horizontal-slots-after", "src/images/case-studies/kingdra/horizontalslots-after.png"),
  ...[1, 2, 3, 4].map((n) =>
    p("kingdra-case-study", `flow-${n}`, `src/images/case-studies/kingdra/flow-${n}.webp`),
  ),

  { id: "site/ui/iphone-mockup", src: "src/images/ui/blank-iphone-mockup.png" },
  // Cutouts on transparent fill (assets/ui, assets/kingdra-case-study): the
  // v2 mockup baked in a #0f0f0f backdrop, and the hero carried extra padding.
  { id: "site/ui/iphone-frame", src: "assets/ui/iphone-frame.png", local: true },
  { id: "site/projects/kingdra-case-study/hero-phone", src: "assets/kingdra-case-study/hero-phone.png", local: true },

  // ── Pieces ──────────────────────────────────────────────────
  piece("design", "graphic-design", "from-pop-to-personal", "public/images/editorial/graphic-design/From-Pop-to-Personal.png"),
  piece("design", "graphic-design", "do-you-not-get-the-concept", "public/images/editorial/graphic-design/music-blog.png"),
  piece("design", "graphic-design", "mock-pitt-post", "public/images/editorial/layouts/mock-pitt-post.png"),
  piece("design", "layouts", "portrait-tutorial", "public/images/editorial/layouts/portrait-tutorial.png"),
  piece("design", "layouts", "wii-manual", "public/images/editorial/layouts/wii-manual.png"),
  piece("design", "layouts", "beer-and-wine-edition", "public/images/editorial/layouts/beer-and-wine-edition.png"),
  piece("design", "layouts", "march-madness-edition", "public/images/editorial/layouts/march-madness-edition.png"),
  ...[1, 2, 3, 4, 5, 6].map((n) =>
    piece("design", "design-club", `clubmeeting${n}`, `public/images/editorial/presentations/clubmeeting${n}.png`),
  ),
  // Substack hero for the post (assets/writing).
  {
    ...piece("writing", "featured", "english-is-the-new-frontier", "assets/writing/english-is-the-new-frontier.jpg"),
    local: true,
  },
  ...["pickled-onions", "hearts-of-palm", "tofu"].map((slug) =>
    piece("writing", "cooking", slug, `public/images/editorial/cooking/${slug}.jpg`),
  ),

  // ── Career logos (official marks, see assets/career/) ───────
  ...[
    ["pnc", "assets/career/pnc.png"],
    ["herl", "assets/career/herl.png"],
    ["the-pitt-news", "assets/career/the-pitt-news.png"],
    ["hse", "assets/career/hse.png"],
    ["pitt", "assets/career/pitt.svg"],
  ].map(([slug, src]) => ({ id: `site/career/${slug}`, src, local: true })),

  // ── Me ──────────────────────────────────────────────────────
  { id: "site/me/portrait" },
];
