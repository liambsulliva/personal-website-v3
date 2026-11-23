// Album files on GitHub, one commit each. The token needs contents
// read/write on this repository and nothing else.
const DIR = "src/content/albums";
const AUTHOR = { name: "Liam Sullivan", email: "75332524+liambsulliva@users.noreply.github.com" };

export function githubAlbums({ token, repo, branch = "main", api = "https://api.github.com", fetch = globalThis.fetch }) {
  async function call(method, path, body) {
    const res = await fetch(`${api}/repos/${repo}/contents/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "personal-website-photos",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 404 && method === "GET") return null;
    // The status only: a response body could repeat what was sent.
    if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status}`);
    return res.json();
  }
  const ref = `?ref=${encodeURIComponent(branch)}`;
  const file = (slug) => `${DIR}/${encodeURIComponent(slug)}.yaml`;
  return {
    async slugs() {
      const entries = await call("GET", DIR + ref);
      if (!entries) throw new Error("GitHub: no albums folder");
      return entries.filter(({ name }) => name.endsWith(".yaml")).map(({ name }) => name.slice(0, -5));
    },
    /** { text, sha }, or null when the album's file is gone. */
    async read(slug) {
      const found = await call("GET", file(slug) + ref);
      return found && { text: Buffer.from(found.content, "base64").toString("utf8"), sha: found.sha };
    },
    /** `sha` null creates. GitHub refuses a stale sha, so a dashboard publish in between is never overwritten. */
    async write(slug, text, sha, message) {
      const content = Buffer.from(text).toString("base64");
      await call("PUT", file(slug), { message, content, branch, author: AUTHOR, committer: AUTHOR, ...(sha ? { sha } : {}) });
    },
  };
}
