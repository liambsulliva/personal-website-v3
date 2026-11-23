// Album files, one commit each, through services/repo: it holds the GitHub
// token and lets this service write album files on one branch, nothing else.
const DIR = "src/content/albums";

export function repoAlbums({ url, secret, fetch = globalThis.fetch }) {
  async function call(op, body) {
    const res = await fetch(`${url}/v1/${op}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ space: "albums", ...body }),
      signal: AbortSignal.timeout(40_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`repo ${op}: ${res.status} ${json.error?.message ?? ""}`.trim());
    return json;
  }
  const file = (slug) => `${DIR}/${slug}.yaml`;
  return {
    async slugs() {
      const { files } = await call("list", { dir: DIR });
      // An empty folder would let every album be made again.
      if (!files.length) throw new Error("repo: no album files");
      return files.map(({ path }) => path.slice(DIR.length + 1, -".yaml".length));
    },
    /** { text, sha }, or null when the album's file is gone. */
    async read(slug) {
      return (await call("read", { path: file(slug) })).file;
    },
    /** `sha` null creates. Refused when the file isn't `sha` any more, so a dashboard publish in between is never overwritten. */
    async write(slug, text, sha, message) {
      const path = file(slug);
      const { oid } = await call("head", {});
      const { shas } = await call("shas", { paths: [path] });
      if ((shas[path] ?? null) !== sha) throw new Error("the album changed meanwhile");
      // Anything committed since the head was read makes this one stale.
      await call("commit", { changes: [{ path, content: text }], message, expectedHead: oid });
    },
  };
}
