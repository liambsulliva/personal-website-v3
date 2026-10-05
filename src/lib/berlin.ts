// Berlin (study abroad) posts: server fetch, never a build-time loader or a
// client useEffect. Mapped to ArticleCard fields.

const ENDPOINT =
  "https://public-api.wordpress.com/rest/v1.1/sites/pittbusinesstotheworld.com/posts/?tag=liam-sullivan&fields=ID,title,date,URL,featured_image&number=20";

export type BerlinPost = {
  id: number;
  title: string;
  date: Date;
  href: string;
  image?: string;
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#039;": "'",
  "&#8217;": "’",
  "&#8216;": "‘",
  "&#8220;": "“",
  "&#8221;": "”",
  "&#8211;": "–",
  "&#8212;": "—",
  "&#8230;": "…",
  "&nbsp;": " ",
};

export const stripHtml = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&[#\w]+;/g, (entity) => ENTITIES[entity] ?? entity)
    .trim();

/** Photon (i0.wp.com) crop to the ArticleCard media box. */
const photon = (url: string, width = 720, height = 384) => {
  try {
    const u = new URL(url);
    u.searchParams.delete("fit");
    u.searchParams.set("resize", `${width},${height}`);
    u.searchParams.set("ssl", "1");
    return u.toString();
  } catch {
    return url;
  }
};

export async function getBerlinPosts(): Promise<BerlinPost[]> {
  try {
    const response = await fetch(ENDPOINT, { headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const data: {
      posts?: Array<{ ID: number; title: string; date: string; URL: string; featured_image?: string }>;
    } = await response.json();
    return (data.posts ?? []).map((post) => ({
      id: post.ID,
      title: stripHtml(post.title),
      date: new Date(post.date),
      href: post.URL,
      image: post.featured_image ? photon(post.featured_image) : undefined,
    }));
  } catch {
    return [];
  }
}
