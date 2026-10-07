// Applies a CMS case's files to the real src/content (and the Cloudinary
// image manifest) and puts every byte back afterwards. Guard rails:
//   - only paths under src/content/ or src/data/cloudinary-manifest.json;
//   - each file must still match the sha the CMS authored it against (so a
//     case never clobbers content that changed since the fixtures were taken);
//   - originals are restored after every case, and on SIGINT/SIGTERM;
//   - the suite ends by asserting `git status src/content` is what it was.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { ROOT } from "./loader";

export type CaseFile = { path: string; content: string | null; baseSha: string | null };

const blobSha = (bytes: Buffer) => createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");

const backups = new Map<string, Buffer | null>();

function abs(path: string) {
  const clean = normalize(path);
  const allowed = clean.startsWith("src/content/") || clean === "src/data/cloudinary-manifest.json";
  if (!allowed || clean.includes("..")) throw new Error(`Refusing to touch ${path}`);
  return join(ROOT, clean);
}

export const contentStatus = () =>
  execFileSync("git", ["status", "--porcelain", "--", "src/content", "src/data/cloudinary-manifest.json"], { cwd: ROOT, encoding: "utf8" });

/** Fails (without writing anything) if any file moved on since the CMS authored the case. */
export function checkBase(files: CaseFile[]) {
  const stale = files.filter((f) => {
    const p = abs(f.path);
    const current = existsSync(p) ? blobSha(readFileSync(p)) : null;
    return current !== f.baseSha;
  });
  if (stale.length) {
    throw new Error(
      `The site's content changed since the CMS fixtures were taken (${stale.map((f) => f.path).join(", ")}). ` +
        "Run `npm run test:fixtures` in cms-dashboard, then rerun the contract.",
    );
  }
}

export function apply(files: CaseFile[]) {
  checkBase(files);
  for (const f of files) {
    const p = abs(f.path);
    if (!backups.has(p)) backups.set(p, existsSync(p) ? readFileSync(p) : null);
    if (f.content === null) rmSync(p, { force: true });
    else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.content);
    }
  }
}

export function restore() {
  for (const [p, bytes] of backups) {
    if (bytes === null) rmSync(p, { force: true });
    else writeFileSync(p, bytes);
  }
  backups.clear();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    restore();
    process.exit(130);
  });
}
process.once("exit", restore);
