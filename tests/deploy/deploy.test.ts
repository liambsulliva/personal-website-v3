// deploy/deploy.sh, the poller that replaces Vercel's deploy on push. Real
// git against a local "origin", tests/deploy/fake-docker.sh for docker, so
// this checks the script's decisions: when it builds, when it switches,
// what it leaves serving when something fails, and what it keeps.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const SCRIPT = join(ROOT, "deploy/deploy.sh");
const hasTools = ["bash", "git", "flock"].every((tool) => spawnSync("sh", ["-c", `command -v ${tool}`]).status === 0);

const NO_HOOKS = ["-c", "core.hooksPath=/dev/null"];

let dir = "";
let origin = "";
let work = "";
let project = "";
let state = "";

const sh = (cwd: string, ...args: string[]) => {
  const result = spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
};

/** A new commit on origin's main; returns its sha. */
function push(message: string) {
  writeFileSync(join(work, "CHANGE"), `${message}\n`);
  sh(work, "git", "add", "-A");
  // Fixture commits in a throwaway repo: no user hooks, a placeholder identity.
  sh(work, "git", ...NO_HOOKS, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", message);
  sh(work, "git", ...NO_HOOKS, "push", "-q", "origin", "HEAD:main");
  return sh(work, "git", "rev-parse", "HEAD");
}

function deploy(env: Record<string, string> = {}) {
  const result = spawnSync("bash", [SCRIPT], {
    encoding: "utf8",
    env: {
      PATH: `${join(dir, "bin")}:${process.env.PATH}`,
      HOME: dir,
      PROJECT_DIR: project,
      REMOTE_URL: origin,
      FAKE_DOCKER_STATE: state,
      HEALTH_TIMEOUT: "0",
      ...env,
    },
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

const read = (file: string) => (existsSync(file) ? readFileSync(file, "utf8") : "");
const serving = () => read(join(project, ".env")).match(/^SITE_SHA=(.*)$/m)?.[1] ?? "";
const running = () => read(join(state, "site")).trim();
const images = () => read(join(state, "images")).trim().split("\n").filter(Boolean);
const calls = () => read(join(state, "calls")).trim().split("\n").filter(Boolean);
const builds = () => calls().filter((call) => call.startsWith("build "));
const resetCalls = () => writeFileSync(join(state, "calls"), "");

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deploy-test-"));
  origin = join(dir, "origin.git");
  work = join(dir, "work");
  project = join(dir, "project");
  state = join(dir, "state");
  for (const d of [work, project, state, join(dir, "bin")]) mkdirSync(d, { recursive: true });
  sh(dir, "git", "init", "-q", "--bare", "-b", "main", origin);
  sh(work, "git", "init", "-q", "-b", "main");
  sh(work, "git", "remote", "add", "origin", origin);
  mkdirSync(join(work, "deploy"));
  writeFileSync(join(work, "deploy/compose.yaml"), readFileSync(join(ROOT, "deploy/compose.yaml")));
  writeFileSync(
    join(project, ".env"),
    "CLOUDINARY_CLOUD_NAME=demo\nCLOUDINARY_API_KEY=key\nCLOUDINARY_API_SECRET=secret\nRAWG_API_KEY=rawg\nTUNNEL_TOKEN=t\nSITE_SHA=\n",
  );
  chmodSync(join(project, ".env"), 0o600);
  const docker = join(dir, "bin/docker");
  writeFileSync(docker, readFileSync(join(ROOT, "tests/deploy/fake-docker.sh")));
  chmodSync(docker, 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!hasTools)("deploy.sh (poll main, build, switch)", () => {
  it("deploys the first commit and writes SITE_SHA and compose.yaml", () => {
    const a = push("a");
    const run = deploy();
    expect(run.status, run.out).toBe(0);
    expect(serving()).toBe(a);
    expect(running()).toBe(a);
    expect(read(join(project, "compose.yaml"))).toContain("personal-website:${SITE_SHA");
    expect(read(join(project, "deploy.log"))).toContain(`deployed ${a.slice(0, 12)}`);
    // The build gets the public cloud name and the commit, never a secret.
    const [build] = builds();
    expect(build).toContain("--build-arg CLOUDINARY_CLOUD_NAME=demo");
    expect(build).toContain(`--build-arg SITE_SHA=${a}`);
    expect(build).toContain("--memory 1536m");
    expect(build).not.toMatch(/secret|key=|rawg/i);
    expect(sh(project, "stat", "-c", "%a", ".env"), ".env keeps its mode").toBe("600");
  });

  it("does nothing while main hasn't moved", () => {
    push("a");
    deploy();
    resetCalls();
    const run = deploy();
    expect(run.status).toBe(0);
    expect(builds()).toEqual([]);
    expect(calls().some((call) => call.startsWith("run "))).toBe(false);
  });

  it("(regression) redeploys when main moves", () => {
    const a = push("a");
    deploy();
    const b = push("b");
    const run = deploy();
    expect(run.status, run.out).toBe(0);
    expect(serving()).toBe(b);
    expect(running()).toBe(b);
    expect(images()).toEqual([b, a]);
  });

  it("(regression) fetches from REMOTE_URL when the clone was made from somewhere else", () => {
    const a = push("a");
    // The first deploy clones from a copy of origin (as phase 2 did from a bundle).
    const copy = join(dir, "copy.git");
    sh(dir, "git", "clone", "-q", "--bare", origin, copy);
    expect(deploy({ REMOTE_URL: copy }).status).toBe(0);
    expect(serving()).toBe(a);
    // main moves on the real origin only; the poller must build it.
    const b = push("b");
    const run = deploy();
    expect(run.status, run.out).toBe(0);
    expect(serving()).toBe(b);
  });

  it("keeps the old container serving when a build fails, and doesn't rebuild that commit", () => {
    const a = push("a");
    deploy();
    writeFileSync(join(state, "build-fail"), "");
    const c = push("c");
    const failed = deploy();
    expect(failed.status).toBe(1);
    expect(serving()).toBe(a);
    expect(running()).toBe(a);
    expect(read(join(project, "deploy.log"))).toContain(`build failed for ${c.slice(0, 12)}`);

    resetCalls();
    expect(deploy().status).toBe(0);
    expect(builds()).toEqual([]);

    rmSync(join(state, "build-fail"));
    expect(deploy({ FORCE: "1" }).status).toBe(0);
    expect(serving()).toBe(c);
  });

  it("builds the next push after a failed one", () => {
    push("a");
    deploy();
    writeFileSync(join(state, "build-fail"), "");
    push("broken");
    deploy();
    rmSync(join(state, "build-fail"));
    const fixed = push("fixed");
    expect(deploy().status).toBe(0);
    expect(serving()).toBe(fixed);
  });

  it("keeps the old container when the new image fails its checks, and retries without rebuilding", () => {
    const a = push("a");
    deploy();
    writeFileSync(join(state, "candidate-unhealthy"), "");
    const d = push("d");
    resetCalls();
    expect(deploy().status).toBe(1);
    expect(serving()).toBe(a);
    expect(running()).toBe(a);
    expect(calls().filter((call) => call.startsWith("compose") && call.includes(" up "))).toEqual([]);

    rmSync(join(state, "candidate-unhealthy"));
    resetCalls();
    expect(deploy().status).toBe(0);
    expect(builds()).toEqual([]);
    expect(serving()).toBe(d);
  });

  it("rolls back when the switched site fails its checks", () => {
    const a = push("a");
    deploy();
    const e = push("e");
    writeFileSync(join(state, "site-unhealthy"), `${e}\n`);
    const run = deploy();
    expect(run.status).toBe(1);
    expect(serving()).toBe(a);
    expect(running()).toBe(a);
    expect(read(join(project, "deploy.log"))).toContain("rolling back");
  });

  it("keeps the serving image and the newest three", () => {
    const shas = ["1", "2", "3", "4", "5"].map((n) => {
      const sha = push(n);
      deploy();
      return sha;
    });
    expect(images()).toEqual(shas.slice(2).reverse());
  });

  it("starts the stack if it stopped at the current commit", () => {
    const a = push("a");
    deploy();
    rmSync(join(state, "site"));
    expect(deploy().status).toBe(0);
    expect(running()).toBe(a);
    expect(builds()).toHaveLength(1);
  });

  it("runs once at a time", async () => {
    push("a");
    writeFileSync(join(project, ".deploy.lock"), "");
    const holder = spawn("flock", [join(project, ".deploy.lock"), "sleep", "5"]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      const run = deploy();
      expect(run.status).toBe(0);
      expect(run.out).toContain("another deploy is running");
      expect(builds()).toEqual([]);
    } finally {
      holder.kill();
    }
  });

  it("refuses to run without a .env", () => {
    rmSync(join(project, ".env"));
    push("a");
    const run = deploy();
    expect(run.status).toBe(1);
    expect(run.out).toContain("copy deploy/.env.example");
  });
});
