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

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create();
});

const EXTERNAL_ICON = "/icons/external-link.svg";

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
        image: "site/pieces/writing/featured/english-is-the-new-frontier",
      },
    });
    expect(html).toContain("cld--missing");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Image coming soon");
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

describe("SectionLabel", () => {
  it("uses the standard 24px bold heading, not the oversized muted featured style", async () => {
    const html = await container.renderToString(SectionLabel, {
      props: { id: "writing-featured" },
      slots: { default: "Featured" },
    });
    expect(html).toContain("Featured");
    expect(html).toContain("text-[24px]");
    expect(html).toContain("font-bold");
    expect(html).not.toContain("text-[32px]");
    expect(html).not.toContain("text-[40px]");
    expect(html).not.toContain("font-medium");
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
    expect(html).toContain("Digital Narrative and Interactive Design (DNID)");
    const open = html.match(/<a\b[^>]*>/)?.[0] ?? "";
    expect(open).not.toContain("whitespace-nowrap");
    expect(open).not.toContain("inline-flex");
    expect(html).not.toMatch(/height:\s*26px/);
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

  it("applies theme and motion before first paint, defaulting to light", async () => {
    const html = await container.renderToString(RootLayout);
    const head = html.slice(0, html.indexOf("</head>"));
    expect(head).toContain('localStorage.getItem("theme") || "light"');
    expect(head).toContain("data-reduced-motion");
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
