// The only holder of the GitHub token (docs/photo-pipeline-plan.md, "Who can
// do what"). The dashboard and the photo watcher ask it to read and commit
// content; it decides the repository, the branch and the files, checks what's
// in them, and never hands the token out. Reachable only inside the project's
// network.
//
//   POST /v1/head    { space }                                -> { oid, url, date, message }
//   POST /v1/list    { space, dir }                           -> { files: [{ path, sha, text }] }
//   POST /v1/read    { space, path }                          -> { file: { sha, text } | null }
//   POST /v1/shas    { space, paths }                         -> { shas: { path: sha | null } }
//   POST /v1/commit  { space, changes, message, expectedHead } -> { oid, url }
//
// Each caller has its own secret: `cms` gets content and drafts, `photos` albums.
//
// Env: GITHUB_TOKEN, SITE_REPO, SITE_BRANCH, DRAFTS_REPO, DRAFTS_BRANCH,
// REPO_CMS_SECRET, REPO_PHOTOS_SECRET (32+ characters), PORT (4332).
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { github, GitHubError } from "./github.mjs";
import { changeProblem, spacesFor } from "./policy.mjs";

const MAX_BODY = 4 * 1024 * 1024;
const MAX_CHANGES = 200;
const SHA = /^[0-9a-f]{40}$/;

class ApiError extends Error {
  constructor(status, message, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const digest = (text) => createHash("sha256").update(text).digest();

/** At most `most` per `ms`, so whoever takes over a caller can't flood the repository. */
export function limiter(most, ms, now = Date.now) {
  let times = [];
  return () => {
    times = times.filter((at) => now() - at < ms);
    if (times.length >= most) return false;
    times.push(now());
    return true;
  };
}

/**
 * @param options.secrets  { cms, photos }: who may call, by secret
 * @param options.hub      github(), or null without a token
 */
export function createRepo({ spaces, secrets, hub, allowCommit = limiter(60, 600_000), log = console.log }) {
  const callers = Object.entries(secrets).filter(([, secret]) => secret).map(([who, secret]) => [who, digest(`Bearer ${secret}`)]);

  function callerOf(req) {
    const given = digest(req.headers.authorization ?? "");
    let found = null;
    for (const [who, secret] of callers) if (timingSafeEqual(given, secret)) found = who;
    if (!found) throw new ApiError(401, "Unauthorized");
    return found;
  }

  async function bodyOf(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw new ApiError(413, "Too large");
      chunks.push(chunk);
    }
    try {
      const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {}
    throw new ApiError(400, "Expected a JSON object");
  }

  const readable = (space, path) => {
    if (typeof path !== "string" || path.length > 300 || !space.allows(path)) throw new ApiError(403, "That path can't be read");
    return path;
  };

  const OPS = {
    head: (space) => hub.head(space),
    async list(space, { dir }) {
      if (!space.dirs.has(dir)) throw new ApiError(403, "That folder can't be read");
      return { files: (await hub.list(space, dir)).filter(({ path }) => space.allows(path)) };
    },
    async read(space, { path }) {
      return { file: await hub.read(space, readable(space, path)) };
    },
    async shas(space, { paths }) {
      if (!Array.isArray(paths) || paths.length > MAX_CHANGES) throw new ApiError(400, "Expected up to 200 paths");
      return { shas: await hub.shas(space, [...new Set(paths)].map((path) => readable(space, path))) };
    },
    async commit(space, { changes, message, expectedHead }, who) {
      if (typeof message !== "string" || !message.trim()) throw new ApiError(400, "A commit message is required");
      if (!Array.isArray(changes) || !changes.length || changes.length > MAX_CHANGES) throw new ApiError(400, "Expected 1 to 200 changes");
      if (expectedHead !== undefined && !(typeof expectedHead === "string" && SHA.test(expectedHead))) throw new ApiError(400, "Malformed head");
      const seen = new Set();
      const problems = [];
      for (const change of changes) {
        if (!change || typeof change !== "object" || seen.has(change.path)) throw new ApiError(400, "Malformed or duplicate change");
        seen.add(change.path);
        const problem = changeProblem(space, change);
        if (problem) problems.push({ path: String(change.path).slice(0, 300), errors: [problem] });
      }
      if (problems.length) {
        log(`[repo] refused ${who}: ${problems.map(({ path, errors }) => `${JSON.stringify(path)} ${errors}`).join("; ").slice(0, 500)}`);
        throw new ApiError(422, problems[0].errors[0], { problems });
      }
      if (!allowCommit()) throw new ApiError(429, "Too many commits; try again in a few minutes");
      const commit = await hub.commit(space, changes.map(({ path, content }) => ({ path, content })), message, expectedHead ?? (await hub.head(space)).oid);
      log(`[repo] ${who} committed ${changes.length} to ${space.repo}@${space.branch}: ${commit.oid.slice(0, 12)}`);
      return commit;
    },
  };

  return async function handle(req, res) {
    const send = (status, value) => {
      if (!req.complete) res.setHeader("Connection", "close");
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(value));
    };
    try {
      const path = (req.url ?? "").split("?", 1)[0];
      if (req.method === "GET" && path === "/healthz") return send(200, { ok: true, ready: Boolean(hub) });
      const who = callerOf(req);
      const op = /^\/v1\/([a-z]+)$/.exec(path)?.[1];
      if (req.method !== "POST" || !op || !Object.hasOwn(OPS, op)) throw new ApiError(404, "Not found");
      const body = await bodyOf(req);
      const space = typeof body.space === "string" && Object.hasOwn(spaces, body.space) ? spaces[body.space] : null;
      if (!space || space.who !== who) throw new ApiError(403, "That isn't yours");
      if (!hub) throw new ApiError(503, "No GitHub token is set");
      send(200, await OPS[op](space, body, who));
    } catch (error) {
      const known = error instanceof ApiError || error instanceof GitHubError;
      if (!known) log(`[repo] ${error.stack ?? error}`);
      send(known ? error.status : 500, { error: { message: known ? error.message : "Something went wrong" }, ...(error.data ?? {}) });
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { GITHUB_TOKEN: token, SITE_REPO, SITE_BRANCH, DRAFTS_REPO, DRAFTS_BRANCH, REPO_CMS_SECRET: cms, REPO_PHOTOS_SECRET: photos } = process.env;
  for (const [name, value] of Object.entries({ SITE_REPO, SITE_BRANCH, DRAFTS_REPO, DRAFTS_BRANCH })) if (!value) throw new Error(`${name} is not set`);
  for (const secret of [cms, photos]) if (secret && secret.length < 32) throw new Error("secrets must be at least 32 characters");
  if (cms && cms === photos) throw new Error("each caller needs its own secret");
  const spaces = spacesFor({ siteRepo: SITE_REPO, siteBranch: SITE_BRANCH, draftsRepo: DRAFTS_REPO, draftsBranch: DRAFTS_BRANCH });
  const server = createServer(createRepo({ spaces, secrets: { cms, photos }, hub: token ? github({ token }) : null }));
  server.requestTimeout = 60_000;
  server.listen(Number(process.env.PORT || 4332), process.env.HOST || "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close(() => process.exit(0)));
}
