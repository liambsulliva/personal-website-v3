import { describe, expect, it } from "vitest";
import { tocFromBody } from "../../src/lib/toc";
import { stripHtml } from "../../src/lib/berlin";
import {
  sanitizePublicCloudinarySearch,
  publicCloudinarySearchUrl,
  isPublicTag,
} from "../../src/lib/cloudinarySearchPolicy";
import { cldTransform, cldSrcSet } from "../../src/lib/cloudinary";
import { BRANDS, brandFor, docsUrl } from "../../src/lib/brands";
import { shuffled, toGalleryPhoto } from "../../src/lib/photos";
import { SECTIONS, SOCIALS, VERSIONS } from "../../src/lib/sections";

describe("tocFromBody", () => {
  it("reads SectionHeading ids and prefers toc > eyebrow > title for the label", () => {
    const body = [
      `<SectionHeading id="overview" eyebrow="Overview" title="A long title" />`,
      `<SectionHeading id="ctx" title='context here' />`,
      `<SectionHeading id="tl" toc="Short" eyebrow="Ignored" title={\`Also ignored\`} />`,
      `<SectionHeading title="No id, skipped" />`,
    ].join("\n");
    expect(tocFromBody(body)).toEqual([
      { id: "overview", label: "Overview" },
      { id: "ctx", label: "Context here" },
      { id: "tl", label: "Short" },
    ]);
  });

  it("returns nothing for an empty body", () => {
    expect(tocFromBody(undefined)).toEqual([]);
  });
});

describe("stripHtml (Berlin titles)", () => {
  it("drops tags and decodes the WordPress entities", () => {
    expect(
      stripHtml(
        "<em>Berlin</em> &amp; the &#8220;Mauerpark&#8221; &#8211; day 3",
      ),
    ).toBe("Berlin & the “Mauerpark” – day 3");
  });
});

describe("public Cloudinary search policy", () => {
  it("allows the gallery's untagged and tagged expressions", () => {
    expect(
      sanitizePublicCloudinarySearch({
        expression: "resource_type:image",
        max_results: 20,
      }),
    ).toEqual({
      expression: "resource_type:image",
      max_results: 20,
    });
    expect(
      sanitizePublicCloudinarySearch({
        expression: "resource_type:image AND tags=football",
        max_results: 20,
      }),
    )?.toMatchObject({ expression: "resource_type:image AND tags=football" });
  });

  it("rejects anything that could widen the query", () => {
    for (const expression of [
      "resource_type:image OR folder:site/*",
      "resource_type:image AND tags=football OR tags=x",
      "resource_type:raw",
      "folder:site/*",
    ]) {
      expect(
        sanitizePublicCloudinarySearch({ expression, max_results: 5 }),
      ).toBeNull();
    }
    expect(sanitizePublicCloudinarySearch(null)).toBeNull();
  });

  it("clamps max_results to 1..50", () => {
    expect(
      sanitizePublicCloudinarySearch({
        expression: "resource_type:image",
        max_results: 999,
      })?.max_results,
    ).toBe(50);
    expect(
      sanitizePublicCloudinarySearch({
        expression: "resource_type:image",
        max_results: -3,
      })?.max_results,
    ).toBe(1);
  });

  it("builds the gallery's next-page URL", () => {
    expect(
      publicCloudinarySearchUrl({
        expression: "resource_type:image",
        max_results: 20,
        next_cursor: "abc",
      }),
    ).toBe(
      "/api/cloudinary/search?expression=resource_type%3Aimage&max_results=20&next_cursor=abc",
    );
  });
});

describe("Cloudinary site imagery URLs", () => {
  it("smart-crops fixed slots and limits free-aspect figures", () => {
    expect(cldTransform({ aspect: "16:9", width: 480 })).toBe(
      "f_auto,q_auto,c_fill,g_auto,ar_16:9,w_480",
    );
    expect(cldTransform({ width: 480 })).toBe("f_auto,q_auto,c_limit,w_480");
    expect(cldTransform({ width: 48, quality: "auto:low", blur: 600 })).toBe(
      "f_auto,q_auto:low,c_limit,w_48/e_blur:600",
    );
  });

  it("never asks for a srcset width larger than the source asset", () => {
    // The manifest records the portrait at 3024px wide.
    const widths = cldSrcSet("site/me/portrait")
      .split(", ")
      .map((candidate) => Number(candidate.split(" ")[1].replace("w", "")));
    expect(Math.max(...widths)).toBeLessThanOrEqual(3024);
  });
});

describe("tag chips", () => {
  it("only lets chip tags through to the tag pool", () => {
    for (const tag of ["portraits", "esports", "a.b:c-d"]) expect(isPublicTag(tag)).toBe(true);
    for (const tag of ["_album-2026-nala-0425", "featured", "tags=x OR y", "", null, 3])
      expect(isPublicTag(tag)).toBe(false);
  });

  it("shuffles a copy, keeping every photo exactly once", () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const result = shuffled(items);
    expect(result).not.toBe(items);
    expect([...result].sort((a, b) => a - b)).toEqual(items);
    expect(items[0]).toBe(0); // input untouched
  });

  it("is a Fisher–Yates walk driven by the random source", () => {
    // random() = 0 always swaps with index 0: [a,b,c,d] → [b,c,d,a]
    expect(shuffled(["a", "b", "c", "d"], () => 0)).toEqual(["b", "c", "d", "a"]);
    // random() just under 1 never moves anything
    expect(shuffled(["a", "b", "c"], () => 0.9999)).toEqual(["a", "b", "c"]);
  });
});

describe("photo shaping", () => {
  const resource = {
    public_id: "DSC_0001",
    secure_url: "https://res.cloudinary.com/demo/image/upload/v1/DSC_0001.jpg",
    width: 1000,
    height: 800,
  };

  it("caps gallery previews and lightbox candidates at the source width", () => {
    const photo = toGalleryPhoto(resource);
    expect(photo.key).toBe("DSC_0001");
    expect(
      Math.max(...photo.lightboxSrcSet.map((source) => source.width)),
    ).toBe(1000);
    expect(photo.previewSrcSet).toContain(" 1000w");
  });
});

describe("brands", () => {
  it("resolves aliases and documentation links", () => {
    expect(brandFor("OpenAI API")).toBe("OpenAI");
    expect(brandFor("Unknown tool")).toBeUndefined();
    expect(docsUrl("Next.js")).toBe("https://nextjs.org/docs");
  });

  it("marks black glyphs so they invert in dark mode", () => {
    for (const name of ["Next.js", "Swift", "D3", "Astro"] as const)
      expect(BRANDS[name].invertOnDark).toBe(true);
    expect(BRANDS.React.invertOnDark).toBeUndefined();
    expect(BRANDS.Express.invertOnDark).toBeUndefined();
  });
});

describe("site chrome data", () => {
  it("has the six wings in stair-step order", () => {
    expect(SECTIONS.map((section) => section.href)).toEqual([
      "/me",
      "/career",
      "/engineering",
      "/design",
      "/photography",
      "/writing",
    ]);
  });

  it("links socials and old versions to absolute https URLs", () => {
    expect(SOCIALS.map((social) => social.label)).toEqual([
      "Resume",
      "GitHub",
      "LinkedIn",
    ]);
    for (const social of SOCIALS) expect(social.href).toMatch(/^https:\/\//);
    expect(VERSIONS[0].href).toBeNull();
    for (const version of VERSIONS.slice(1))
      expect(version.href).toMatch(/^https:\/\/v\d\.liambsullivan\.com$/);
  });
});
