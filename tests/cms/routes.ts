// Renders a site route through the real page/endpoint modules, the way the
// deployed site would, with only the network mocked (WordPress + Cloudinary).
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer as reactRenderer } from "@astrojs/react";
import { getContainerRenderer as svelteRenderer } from "@astrojs/svelte";

type Rendered = { status: number; body: string };
type PageModule = { default: unknown; getStaticPaths?: () => Promise<Array<{ params: Record<string, string>; props?: Record<string, unknown> }>> };

const PAGES: Record<string, () => Promise<PageModule>> = {
  "/engineering": () => import("../../src/pages/engineering/index.astro"),
  "/design": () => import("../../src/pages/design/index.astro"),
  "/writing": () => import("../../src/pages/writing/index.astro"),
  "/career": () => import("../../src/pages/career.astro"),
  "/photography": () => import("../../src/pages/photography.astro"),
  "/engineering/[slug]": () => import("../../src/pages/engineering/[slug].astro"),
  "/design/[slug]": () => import("../../src/pages/design/[slug].astro"),
  "/writing/[slug]": () => import("../../src/pages/writing/[slug].astro"),
};

let container: AstroContainer | null = null;
async function getContainer() {
  container ??= await AstroContainer.create({ renderers: await loadRenderers([reactRenderer(), svelteRenderer()]) });
  return container;
}

/** WordPress posts for /writing's Study Abroad section. */
export const WORDPRESS_POSTS = [
  { ID: 1, title: "Fixture Post July", date: "2024-07-01T10:00:00+00:00", URL: "https://pbtw.example/july", featured_image: "" },
  { ID: 2, title: "Fixture Post June", date: "2024-06-01T10:00:00+00:00", URL: "https://pbtw.example/june", featured_image: "" },
];

const resource = (public_id: string) => ({
  public_id,
  secure_url: `https://res.cloudinary.com/demo/image/upload/${public_id}`,
  width: 4000,
  height: 6000,
  tags: ["portraits"],
});

/** fetch() for the duration of the contract: everything else is refused. */
export async function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("public-api.wordpress.com")) return Response.json({ posts: WORDPRESS_POSTS });
  if (url.includes("api.cloudinary.com") && url.endsWith("/resources/search")) {
    const { expression = "" } = JSON.parse(String(init?.body ?? "{}")) as { expression?: string };
    const ids = [...expression.matchAll(/public_id="([^"]+)"/g)].map((m) => m[1]!);
    // Reversed on purpose: callers must restore the album's own order.
    return Response.json({ resources: (ids.length ? ids : ["library-a", "library-b"]).reverse().map(resource) });
  }
  if (url.includes("api.cloudinary.com") && url.includes("/tags/")) return Response.json({ tags: ["portraits"] });
  throw new Error(`Unexpected network request in the CMS contract: ${url}`);
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&#x27;": "'", "&lt;": "<", "&gt;": ">", "&#34;": '"' };
/** Entity-decoded so expectations can be written as plain text. */
export const normalize = (html: string) => html.replace(/&(?:amp|quot|lt|gt|#39|#x27|#34);/g, (e) => ENTITIES[e]!);

export async function renderRoute(route: string): Promise<Rendered> {
  const url = new URL(route, "https://liambsullivan.com");
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (path === "/sitemap.xml") {
    const { GET } = await import("../../src/pages/sitemap.xml.ts");
    const res = await GET({ site: new URL("https://liambsullivan.com") } as never);
    return { status: res.status, body: await res.text() };
  }
  if (path === "/api/cloudinary/album") {
    const { GET } = await import("../../src/pages/api/cloudinary/album.ts");
    const res = await GET({ request: new Request(url), url } as never);
    return { status: res.status, body: await res.text() };
  }

  const dynamic = path.match(/^\/(engineering|design|writing)\/([^/]+)$/);
  const key = dynamic ? `/${dynamic[1]}/[slug]` : path;
  const load = PAGES[key];
  if (!load) throw new Error(`No page mapped for ${route}`);
  const mod = await load();
  let props: Record<string, unknown> | undefined;
  let params: Record<string, string> | undefined;
  if (dynamic) {
    const match = (await mod.getStaticPaths!()).find((p) => p.params.slug === dynamic[2]);
    if (!match) return { status: 404, body: "" };
    ({ params, props } = match);
  }
  const c = await getContainer();
  const body = await c.renderToString(mod.default as never, { params, props, request: new Request(url) });
  return { status: 200, body: normalize(body) };
}
