// What each caller may read and write. Nothing here comes from a request: a
// caller picks a space, and the space fixes the repository, branch and paths.
import { entryProblem } from "./mdx.mjs";
import { plainYaml } from "./yaml.mjs";

const NAME = "[a-z0-9]+(?:-[a-z0-9]+)*";
const YAML_FILE = new RegExp(`^src/content/(?:career|sections)/${NAME}\\.yaml$`);
const ENTRY_FILE = new RegExp(`^src/content/entries/${NAME}\\.mdx$`);
const MANIFEST = "src/data/cloudinary-manifest.json";
// The dashboard's own naming: the site path with ~ for /.
const DRAFT_FILE = /^drafts\/src~(?:content|data)~[A-Za-z0-9._~-]+\.json$/;
const MAX_BYTES = 512 * 1024;

function jsonProblem(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? null : "Expected a JSON object";
  } catch {
    return "That isn't valid JSON";
  }
}

const inContent = (path) => YAML_FILE.test(path) || ENTRY_FILE.test(path) || path === MANIFEST;

/** Spaces by name. `who` may use it; `dirs` can be listed; `allows` is every path that can be read or written. */
export function spacesFor({ siteRepo, siteBranch, draftsRepo, draftsBranch }) {
  const site = { repo: siteRepo, branch: siteBranch };
  return {
    content: {
      ...site,
      who: "cms",
      dirs: new Set(["entries", "sections", "career"].map((name) => `src/content/${name}`)),
      allows: inContent,
      deletes: (path) => path !== MANIFEST,
    },
    drafts: {
      repo: draftsRepo,
      branch: draftsBranch,
      who: "cms",
      dirs: new Set(["drafts"]),
      allows: (path) => DRAFT_FILE.test(path),
      deletes: () => true,
    },
  };
}

/** Why `change` can't be committed to `space`, or null. */
export function changeProblem(space, { path, content }) {
  if (typeof path !== "string" || path.length > 300 || !space.allows(path)) return "That path can't be written";
  if (content === null) return space.deletes(path) ? null : "That file can't be deleted";
  if (typeof content !== "string") return "Missing content";
  if (Buffer.byteLength(content) > MAX_BYTES) return "That file is too large";
  if (content.includes("\0")) return "That isn't text";
  if (path.endsWith(".mdx")) return entryProblem(content);
  return path.endsWith(".json") ? jsonProblem(content) : plainYaml(content).problem;
}
