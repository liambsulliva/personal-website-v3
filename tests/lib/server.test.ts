import { afterEach, describe, expect, it, vi } from "vitest";
import { getBerlinPosts } from "../../src/lib/berlin";
import { publicTags } from "../../src/lib/cloudinaryServer";
import {
  isRawgProxyRequestAllowed,
  isSwitchMenuDocumentPath,
  isSwitchMenuEmbedRequest,
  SWITCH_MENU_PROJECT_URL,
} from "../../src/lib/switchMenuEmbed";
import { slashSafeRoute } from "../../integrations/slashSafeRedirects.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publicTags (photography chip row)", () => {
  it("drops the editorial flag and internal underscore tags, dedupes and sorts", () => {
    expect(
      publicTags([
        "soccer",
        "featured",
        "_draft",
        "music",
        "soccer",
        "_hidden",
      ]),
    ).toEqual(["music", "soccer"]);
  });
});

describe("getBerlinPosts", () => {
  it("maps WordPress posts to ArticleCard fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          posts: [
            {
              ID: 7,
              title: "Week one &amp; <b>Berlin</b>",
              date: "2024-06-01T10:00:00+00:00",
              URL: "https://pittbusinesstotheworld.com/week-one",
              featured_image:
                "https://i0.wp.com/example.com/a.jpg?fit=1200%2C800",
            },
          ],
        }),
      ),
    );
    const [post] = await getBerlinPosts();
    expect(post).toMatchObject({
      id: 7,
      title: "Week one & Berlin",
      href: "https://pittbusinesstotheworld.com/week-one",
    });
    expect(post.image).toContain("resize=720%2C384");
    expect(post.image).not.toContain("fit=");
  });

  it("degrades to an empty section when WordPress is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 503 })),
    );
    expect(await getBerlinPosts()).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("offline"))),
    );
    expect(await getBerlinPosts()).toEqual([]);
  });
});

describe("Switch embed guards", () => {
  const origin = "https://liambsullivan.com";

  it("treats only the bare /switch-menu document as the embed page", () => {
    expect(isSwitchMenuDocumentPath("/switch-menu")).toBe(true);
    expect(isSwitchMenuDocumentPath("/switch-menu/")).toBe(true);
    expect(isSwitchMenuDocumentPath("/switch-menu/assets/App.js")).toBe(false);
  });

  it("recognises iframe loads from the write-up and sends direct visits to it", () => {
    expect(SWITCH_MENU_PROJECT_URL).toBe("/engineering/switch-react-menu/");
    expect(
      isSwitchMenuEmbedRequest(
        new Request(`${origin}/switch-menu/`, {
          headers: { "sec-fetch-dest": "iframe" },
        }),
      ),
    ).toBe(true);
    expect(
      isSwitchMenuEmbedRequest(
        new Request(`${origin}/switch-menu/`, {
          headers: { referer: `${origin}/engineering/switch-react-menu` },
        }),
      ),
    ).toBe(true);
    expect(
      isSwitchMenuEmbedRequest(new Request(`${origin}/switch-menu/`)),
    ).toBe(false);
    expect(
      isSwitchMenuEmbedRequest(
        new Request(`${origin}/switch-menu/`, {
          headers: {
            referer: "https://evil.example/engineering/switch-react-menu",
          },
        }),
      ),
    ).toBe(false);
  });

  it("only lets the embed itself call the RAWG proxy", () => {
    const fromEmbed = new Request(`${origin}/api/rawg/games`, {
      headers: {
        referer: `${origin}/switch-menu/`,
        "sec-fetch-site": "same-origin",
        "sec-fetch-dest": "empty",
      },
    });
    expect(isRawgProxyRequestAllowed(fromEmbed)).toBe(true);
    expect(
      isRawgProxyRequestAllowed(new Request(`${origin}/api/rawg/games`)),
    ).toBe(false);
    expect(
      isRawgProxyRequestAllowed(
        new Request(`${origin}/api/rawg/games`, {
          headers: {
            referer: `${origin}/switch-menu/`,
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("slashSafeRoute (Vercel redirect patterns)", () => {
  it("lets each 301 source match with or without a trailing slash", () => {
    const route = slashSafeRoute({
      src: "^/other-work$",
      headers: { Location: "/design" },
      status: 301,
    });
    expect(route.src).toBe("^/other-work/?$");
    const pattern = new RegExp(route.src);
    expect(pattern.test("/other-work")).toBe(true);
    expect(pattern.test("/other-work/")).toBe(true);
    expect(pattern.test("/other-work/x")).toBe(false);
  });

  it("leaves non-redirect routes and already-slash-safe sources alone", () => {
    const catchAll = { src: "^/.*$", dest: "/404.html", status: 404 };
    expect(slashSafeRoute(catchAll)).toBe(catchAll);
    const filesystem = { handle: "filesystem" };
    expect(slashSafeRoute(filesystem)).toBe(filesystem);
    const done = { src: "^/x/?$", headers: { Location: "/y" }, status: 301 };
    expect(slashSafeRoute(done)).toBe(done);
  });
});
