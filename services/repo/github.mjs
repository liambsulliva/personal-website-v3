// The few GitHub calls this service makes. The token is used here and nowhere else.
export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function github({ token, fetch = globalThis.fetch, api = "https://api.github.com/graphql" }) {
  async function gql(query, variables) {
    const res = await fetch(api, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "personal-website-repo" },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    }).catch(() => {
      throw new GitHubError(502, "GitHub didn't answer");
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.errors?.length) {
      const stale = json.errors?.some((error) => /expected.*head|is at|STALE_DATA/i.test(`${error.type} ${error.message}`));
      // Never GitHub's own words: a message could repeat what was sent.
      throw stale ? new GitHubError(409, "The branch moved on") : new GitHubError(502, `GitHub refused (${res.status})`);
    }
    return json.data;
  }

  const split = (repo) => {
    const [owner, name] = repo.split("/");
    return { owner, name };
  };

  return {
    async head({ repo, branch }) {
      const data = await gql(
        "query($owner:String!,$name:String!,$ref:String!){ repository(owner:$owner,name:$name){ ref(qualifiedName:$ref){ target { ... on Commit { oid url committedDate messageHeadline } } } } }",
        { ...split(repo), ref: `refs/heads/${branch}` },
      );
      const target = data.repository?.ref?.target;
      if (!target) throw new GitHubError(404, "That branch doesn't exist");
      return { oid: target.oid, url: target.url, date: target.committedDate, message: target.messageHeadline };
    },

    /** The text files directly in `dir`. */
    async list({ repo, branch }, dir) {
      const data = await gql("query($owner:String!,$name:String!,$expr:String!){ repository(owner:$owner,name:$name){ object(expression:$expr){ ... on Tree { entries { path type oid object { ... on Blob { text } } } } } } }", {
        ...split(repo),
        expr: `${branch}:${dir}`,
      });
      return (data.repository?.object?.entries ?? []).filter(({ type, object }) => type === "blob" && typeof object?.text === "string").map(({ path, oid, object }) => ({ path, sha: oid, text: object.text }));
    },

    async read({ repo, branch }, path) {
      const data = await gql("query($owner:String!,$name:String!,$expr:String!){ repository(owner:$owner,name:$name){ object(expression:$expr){ ... on Blob { oid text } } } }", { ...split(repo), expr: `${branch}:${path}` });
      const blob = data.repository?.object;
      return typeof blob?.text === "string" ? { sha: blob.oid, text: blob.text } : null;
    },

    async shas({ repo, branch }, paths) {
      if (!paths.length) return {};
      const variables = { ...split(repo) };
      const params = paths.map((path, i) => ((variables[`e${i}`] = `${branch}:${path}`), `$e${i}:String!`));
      const data = await gql(
        `query($owner:String!,$name:String!,${params.join(",")}){ repository(owner:$owner,name:$name){ ${paths.map((_, i) => `f${i}: object(expression:$e${i}) { oid }`).join(" ")} } }`,
        variables,
      );
      return Object.fromEntries(paths.map((path, i) => [path, data.repository?.[`f${i}`]?.oid ?? null]));
    },

    async commit({ repo, branch }, changes, message, expectedHead) {
      const [headline, ...rest] = message.trim().split("\n");
      const data = await gql("mutation($input: CreateCommitOnBranchInput!){ createCommitOnBranch(input:$input){ commit { oid url } } }", {
        input: {
          branch: { repositoryNameWithOwner: repo, branchName: branch },
          message: { headline: headline.slice(0, 200), body: rest.join("\n").trim().slice(0, 5000) || undefined },
          expectedHeadOid: expectedHead,
          fileChanges: {
            additions: changes.filter(({ content }) => content !== null).map(({ path, content }) => ({ path, contents: Buffer.from(content, "utf8").toString("base64") })),
            deletions: changes.filter(({ content }) => content === null).map(({ path }) => ({ path })),
          },
        },
      });
      return data.createCommitOnBranch.commit;
    },
  };
}
