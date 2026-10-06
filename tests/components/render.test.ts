import { beforeAll, describe, expect, it } from "vitest";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import ArticleCard from "../../src/components/cards/ArticleCard.astro";
import ProjectCard from "../../src/components/cards/ProjectCard.astro";
import CldImage from "../../src/components/media/CldImage.astro";
import SectionLabel from "../../src/components/cards/SectionLabel.astro";
import Socials from "../../src/components/chrome/Socials.astro";
import LobbyHero from "../../src/components/chrome/LobbyHero.astro";
import Breadcrumb from "../../src/components/chrome/Breadcrumb.astro";
import RootLayout from "../../src/layouts/RootLayout.astro";
import ProgressiveImage from "../../src/components/islands/ProgressiveImage";
import FeaturedArticle from "../../src/components/cards/FeaturedArticle.astro";
import BrandGlyph from "../../src/components/icons/BrandGlyph.astro";
import TimelineRow from "../../src/components/cards/TimelineRow.astro";
import Mark from "../../src/components/chrome/Mark.astro";
import PhoneMockup from "../../src/components/writeup/PhoneMockup.astro";
import SectionHeading from "../../src/components/writeup/SectionHeading.astro";
import Callout from "../../src/components/writeup/Callout.astro";
import SwitchHud from "../../src/components/writeup/SwitchHud.astro";
import Logomark from "../../src/components/chrome/Logomark.astro";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

const EXTERNAL_ICON = 'data-icon="external-link"';
const ROOT = join(import.meta.dirname, "../..");

describe("ArticleCard", () => {
  it("internal pieces open in the same tab with no outbound icon", async () => {
    const html = await container.renderToString(ArticleCard, {
      props: {
        title: "Welcome to UXD!",
        meta: "Deck • Sep 2024",
        href: "/presentation/clubmeeting1.pdf",
        external: false,
      },
    });
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain(EXTERNAL_ICON);
  });

  it("outbound pieces get a new tab, noopener and the icon by default", async () => {
    const html = await container.renderToString(ArticleCard, {
      props: {
        title: "Berlin",
        meta: "Blog • Jun 2024",
        href: "https://example.com/post",
      },
    });
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain(EXTERNAL_ICON);
  });

  it("sets a medium-weight title with the metadata tucked right under it", async () => {
    const html = await container.renderToString(ArticleCard, {
      props: { title: "Berlin", meta: "Blog • Jun 2024", href: "https://example.com/post" },
    });
    const content = html.match(/<div class="([^"]*)"[^>]*data-name="content"/)?.[1] ?? "";
    const title = html.match(/<p class="([^"]*)"[^>]*>Berlin</)?.[1] ?? "";
    const meta = html.match(/<p class="([^"]*)"[^>]*>Blog • Jun 2024</)?.[1] ?? "";
    expect(content).toContain("gap-0.5");
    expect(title).toContain("font-medium");
    expect(title).toContain("leading-[1.3]");
    expect(meta).toContain("leading-[1.3]");
  });
});

describe("ProjectCard", () => {
  const base = {
    title: "Kingdra",
    description: "Teambuilder",
    image: "site/projects/kingdra-app/cover",
    badges: ["React"],
  };

  it("write-up cards stay on site", async () => {
    const html = await container.renderToString(ProjectCard, {
      props: { ...base, href: "/engineering/kingdra-app" },
    });
    expect(html).toContain('href="/engineering/kingdra-app"');
    expect(html).not.toContain(EXTERNAL_ICON);
  });

  it("card-only projects are outbound", async () => {
    const html = await container.renderToString(ProjectCard, {
      props: {
        ...base,
        href: "https://github.com/liambsulliva/x",
        external: true,
      },
    });
    expect(html).toContain('target="_blank"');
    expect(html).toContain(EXTERNAL_ICON);
  });
});

describe("CldImage", () => {
  it("unseeded ids stay a gray skeleton with no coming-soon copy", async () => {
    const html = await container.renderToString(CldImage, {
      props: {
        id: "site/projects/claudia-cooks/cover",
        alt: "Claudia Cooks cover",
        aspect: "16:9",
      },
    });
    expect(html).toContain("cld--missing");
    expect(html).toContain('role="img"');
    expect(html).not.toContain("Image coming soon");
    expect(html).not.toContain("<img");
    expect(html).toContain('aria-label="Claudia Cooks cover"');
  });
});

describe("FeaturedArticle", () => {
  it("unseeded covers stay a skeleton and never request the image", async () => {
    const html = await container.renderToString(FeaturedArticle, {
      props: {
        title: "English is the New Frontier.",
        description: "A dek",
        meta: "Blog • Sep 2026",
        href: "https://example.com/post",
        image: "site/pieces/writing/featured/not-uploaded-yet",
      },
    });
    expect(html).toContain("cld--missing");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Image coming soon");
  });

  it("renders the seeded English is the New Frontier cover", async () => {
    const html = await container.renderToString(FeaturedArticle, {
      props: {
        title: "English is the New Frontier.",
        meta: "Blog • Sep 2026",
        href: "https://example.com/post",
        image: "site/pieces/writing/featured/english-is-the-new-frontier",
      },
    });
    expect(html).not.toContain("cld--missing");
    expect(html).toMatch(/<img[^>]*english-is-the-new-frontier/);
  });
});

describe("BrandGlyph", () => {
  it("inverts Next.js, Swift, D3 and Astro in dark mode", async () => {
    for (const brand of ["Next.js", "Swift", "D3", "Astro"] as const) {
      const html = await container.renderToString(BrandGlyph, {
        props: { brand },
      });
      expect(html).toContain("brand-glyph--invert-dark");
    }
  });

  it("leaves color marks and unused Express alone", async () => {
    for (const brand of ["React", "Express"] as const) {
      const html = await container.renderToString(BrandGlyph, {
        props: { brand },
      });
      expect(html).not.toContain("brand-glyph--invert-dark");
    }
  });
});

describe("TimelineRow", () => {
  it("flags the Pitt wordmark to render white in dark mode", async () => {
    const html = await container.renderToString(TimelineRow, {
      props: {
        company: "University of Pittsburgh",
        role: "BS",
        dates: "2022 – 2026",
        href: "https://www.pitt.edu",
        logo: "site/career/pitt",
        whiteLogoOnDark: true,
      },
    });
    expect(html).toContain("timeline-row__logo--white");
  });

  it("leaves color logos alone", async () => {
    const html = await container.renderToString(TimelineRow, {
      props: {
        company: "PNC",
        role: "Analyst",
        dates: "2025",
        href: "https://www.pnc.com",
        logo: "site/career/pnc",
      },
    });
    expect(html).not.toContain("timeline-row__logo--white");
  });
});

// Eyebrows: small Geist (never mono) in the section accent, written as
// authored: no forced caps, no wide tracking.
const expectEyebrowClasses = (classes: string) => {
  expect(classes).not.toMatch(/\buppercase\b/);
  expect(classes).not.toMatch(/\btracking-/);
  expect(classes).not.toMatch(/\bfont-mono\b/);
};

describe("SectionLabel", () => {
  it("uses the standard 24px bold heading, not the oversized muted featured style", async () => {
    const html = await container.renderToString(SectionLabel, {
      props: { id: "writing-substack" },
      slots: { default: "Substack" },
    });
    expect(html).toContain("Substack");
    expect(html).toContain("text-[24px]");
    expect(html).toContain("font-bold");
    expect(html).not.toContain("text-[32px]");
    expect(html).not.toContain("text-[40px]");
    expect(html).not.toContain("font-medium");
  });

  it("renders Featured! as a 12px accent eyebrow, as written", async () => {
    const html = await container.renderToString(SectionLabel, {
      props: { id: "writing-featured", eyebrow: true },
      slots: { default: "Featured!" },
    });
    const classes = html.match(/<h2[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(html).toMatch(/>Featured!<\/h2>/);
    expect(classes).toContain("text-[12px]");
    expect(classes).toContain("text-wing");
    expect(classes).not.toContain("text-[24px]");
    expectEyebrowClasses(classes);
  });
});

describe("SectionHeading", () => {
  it("keeps the eyebrow's authored casing", async () => {
    const html = await container.renderToString(SectionHeading, {
      props: { id: "ctx", eyebrow: "Project timeline", title: "Desktop-first development" },
    });
    expect(html).toMatch(/class="section-heading__eyebrow"[^>]*>Project timeline</);
    expect(html).not.toContain("PROJECT TIMELINE");
  });

  it("tucks the eyebrow 4px above the title", async () => {
    const html = await container.renderToString(SectionHeading, {
      props: { id: "ctx", eyebrow: "Context", title: "Desktop-first development" },
    });
    const header = html.match(/<header class="([^"]*)"/)?.[1] ?? "";
    expect(header).toContain("gap-1");
    expect(header).not.toMatch(/\bgap-(?!1\b)/);
  });
});

describe("Callout", () => {
  it("keeps the label's authored casing", async () => {
    const html = await container.renderToString(Callout, {
      props: { label: "The goal?" },
      slots: { default: "Make it feel at home on smaller devices." },
    });
    expect(html).toMatch(/class="callout__label"[^>]*>The goal\?</);
  });
});

describe("Socials", () => {
  it("renders Resume, GitHub and LinkedIn as labelled outbound links", async () => {
    const html = await container.renderToString(Socials);
    for (const label of ["Resume", "GitHub", "LinkedIn"])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html.match(/target="_blank"/g)).toHaveLength(3);
  });
});

describe("Mark", () => {
  it("lets the /me DNID degree title wrap on narrow screens", async () => {
    const html = await container.renderToString(Mark, {
      props: {
        href: "https://www.sci.pitt.edu/academics/undergraduate-majors/digital-narrative-and-interactive-design",
        color: "var(--accent-design)",
        icon: "palette",
      },
      slots: { default: "Digital Narrative and Interactive Design (DNID)" },
    });
    expect(html.replace(/<[^>]+>/g, "")).toContain("Digital Narrative and Interactive Design (DNID)");
    const open = html.match(/<a\b[^>]*>/)?.[0] ?? "";
    expect(open).not.toContain("whitespace-nowrap");
    expect(open).not.toContain("inline-flex");
    expect(open).not.toContain("inline-block");
    expect(html).not.toMatch(/height:\s*26px/);
    // Only the last word rides with the glyph; the rest flows with the prose.
    const keep = html.match(/class="mark__keep"[^>]*>([\s\S]*?)<\/span><\/span><\/a>/)?.[1] ?? "";
    expect(keep).toMatch(/^\(DNID\)/);
    expect(keep).toContain("palette");
  });
});

describe("PhoneMockup", () => {
  it("clips the Kingdra screenshot inside the frame instead of translating it to the viewport top", async () => {
    const html = await container.renderToString(PhoneMockup, {
      props: {
        content: "site/projects/kingdra-case-study/mobile-view",
        frame: "site/ui/iphone-frame",
        alt: "The original Kingdra mobile UI, showing a long scroll of Pokémon",
      },
    });
    const shell = html.match(/<div class="phone-mockup[^"]*"/)?.[0] ?? "";
    const screen = html.match(/class="phone-mockup__screen[^"]*"/)?.[0] ?? "";
    expect(html).toContain("kingdra-case-study/mobile-view");
    expect(shell).toMatch(/overflow-(hidden|clip)/);
    expect(screen).not.toContain("-translate-y-1/2");
    expect(screen).not.toContain("top-1/2");
    expect(screen).toMatch(/overflow-y-auto/);
  });
});

describe("LobbyHero", () => {
  it("SSRs the finished three lines for no-JS, zap and crawlers", async () => {
    const html = await container.renderToString(LobbyHero);
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain("I'm Liam .");
    expect(text).toContain("Business Systems Analyst");
    expect(text).toContain("This is my virtual museum.");
    expect(html).toContain('href="/me"');
  });

  it("does not repeat 'PNC' in the heading's accessible name", async () => {
    const html = await container.renderToString(LobbyHero);
    expect(html).not.toMatch(/<img[^>]*alt="PNC"/);
  });

  it("keeps Analyst+chart and PNC+mark together inside their links", async () => {
    const html = await container.renderToString(LobbyHero);
    const analyst = html.match(
      /<a[^>]*tealhq\.com[^>]*>([\s\S]*?)<\/a>/,
    )?.[1];
    const pnc = html.match(/<a[^>]*pnc\.com[^>]*>([\s\S]*?)<\/a>/)?.[1];
    expect(analyst).toContain("Analyst");
    expect(analyst).toContain("chart-column");
    expect(analyst).toContain("hero__keep");
    expect(pnc).toContain("PNC");
    expect(pnc).toContain("/brand/pnc.png");
    expect(pnc).toContain("hero__keep");
  });
});

describe("Breadcrumb", () => {
  it("links every path segment and marks the last one current", async () => {
    const html = await container.renderToString(Breadcrumb, {
      props: { path: "/engineering/kingdra-app/" },
    });
    expect(html).toContain('href="/engineering"');
    expect(html).toMatch(
      /href="\/engineering\/kingdra-app"[^>]*aria-current="page"/,
    );
    expect(html).toContain('aria-label="Liam Sullivan, home"');
  });

  it("keeps the path segments in mono (only eyebrows moved to Geist)", async () => {
    const html = await container.renderToString(Breadcrumb, {
      props: { path: "/writing/" },
    });
    expect(html).toMatch(/<li class="[^"]*\bfont-mono\b/);
  });
});

describe("SwitchHud", () => {
  it("ships keyboard and touch control rows, swapping them on touch-first devices", async () => {
    const html = await container.renderToString(SwitchHud);
    const rows = [...html.matchAll(/<ul[^>]*data-input="(\w+)"[^>]*aria-label="([^"]+)"/g)].map(
      ([, input, label]) => [input, label],
    );
    expect(rows).toEqual([
      ["keyboard", "Keyboard controls"],
      ["touch", "Touch controls"],
    ]);
    const touch = html.slice(html.indexOf('data-input="touch"'));
    for (const hint of ["Tap", "Tap again", "Back (top right)"]) expect(touch).toContain(hint);
    const source = readFileSync(join(ROOT, "src/components/writeup/SwitchHud.astro"), "utf8");
    expect(source).toContain("@media (hover: none) and (pointer: coarse)");
  });
});

describe("Logomark", () => {
  it("draws the v3 pill from the favicon's own glyph paths in the theme color", async () => {
    const html = await container.renderToString(Logomark);
    const favicon = readFileSync(join(ROOT, "public/favicon/icon-light.svg"), "utf8");
    const [v3, dot] = [...favicon.matchAll(/ d="([^"]+)"/g)].map(([, d]) => d);
    expect(html).toContain(`fill="var(--fg)" d="${v3}"`);
    expect(html).toContain(`fill="#ff8400" d="${dot}"`);
    expect(html).toContain('aria-label="Site versions"');
  });
});

describe("RootLayout", () => {
  it("puts the skip link first and ships absolute share images", async () => {
    const html = await container.renderToString(RootLayout, {
      props: { title: "Me - Liam Sullivan" },
    });
    const body = html.slice(html.indexOf("<body"));
    expect(body.match(/<a\b[^>]*>/)?.[0]).toContain('href="#main"');
    for (const property of ['property="og:image"', 'name="twitter:image"']) {
      expect(html).toMatch(
        new RegExp(`${property} content="https?://[^"]+/banner\\.jpg"`),
      );
    }
    expect(html).toContain("<title>Me - Liam Sullivan</title>");
  });

  it("applies theme and motion before first paint, defaulting to system", async () => {
    const html = await container.renderToString(RootLayout);
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('localStorage.getItem("theme") || "system"');
    expect(head).toContain("data-reduced-motion");
  });

  it("links light and dark favicons (SVG + every PNG size) by color scheme", async () => {
    const html = await container.renderToString(RootLayout);
    for (const scheme of ["light", "dark"]) {
      const media = `media="(prefers-color-scheme: ${scheme})"`;
      const svg = `/favicon/icon-${scheme}.svg`;
      expect(html).toMatch(new RegExp(`href="${svg}"[^>]*${media.replace(/[()]/g, "\\$&")}`));
      expect(existsSync(join(ROOT, "public", svg))).toBe(true);
      for (const size of [16, 32, 64, 128, 256, 512]) {
        const png = `/favicon/icon-${scheme}-${size}.png`;
        expect(html).toContain(`sizes="${size}x${size}" href="${png}"`);
        expect(existsSync(join(ROOT, "public", png))).toBe(true);
      }
    }
    expect(html).not.toContain("/favicon.svg");
  });
});

describe("ProgressiveImage (photography islands)", () => {
  it("server-renders SSR'd photos visible so they paint before hydration", () => {
    const html = renderToString(
      createElement(ProgressiveImage, {
        placeholderSrc:
          "https://res.cloudinary.com/demo/image/upload/w_480/a.jpg",
        srcSet: "https://res.cloudinary.com/demo/image/upload/w_960/a.jpg 960w",
        alt: "Featured photo 1",
      }),
    );
    expect(html).toContain('alt="Featured photo 1"');
    expect(html).toMatch(/<img[^>]*class="[^"]*opacity-100/);
    expect(html).not.toMatch(/<img[^>]*class="[^"]*opacity-0/);
  });
});
