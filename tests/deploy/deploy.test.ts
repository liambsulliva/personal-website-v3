// deploy/deploy.sh, the poller that replaces Vercel's deploy on push. Real
// git against a local "origin", tests/deploy/fake-docker.sh for docker, so
// this checks the script's decisions: when it builds, when it switches,
// what it leaves serving when something fails, and what it keeps.
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

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

describe.skipIf(!hasTools)("deploy.sh (poll a branch, build, switch)", () => {
  it("deploys the first commit and writes SITE_SHA and compose.yaml", () => {
    const a = push("a");
    const run = deploy();
    expect(run.status, run.out).toBe(0);
    expect(serving()).toBe(a);
    expect(running()).toBe(a);
    expect(read(join(project, "compose.yaml"))).toContain("${STACK:-personal-website}:${SITE_SHA");
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

  describe("root runs nothing a push can change", () => {
    const PINNED = ["deploy.sh", "pin.sh", "compose.yaml", "compose.photos.yaml", "compose.cms.yaml"];
    const pinnedDir = () => join(project, "deploy");
    const pinTo = (dir: string) => (mkdirSync(dir, { recursive: true }), PINNED.forEach((file) => cpSync(join(ROOT, "deploy", file), join(dir, file))));
    const runPinned = (script = join(pinnedDir(), "deploy.sh")) => {
      const result = spawnSync("bash", [script], { encoding: "utf8", env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, HOME: dir, REMOTE_URL: origin, FAKE_DOCKER_STATE: state, HEALTH_TIMEOUT: "0" } });
      return { status: result.status, out: result.stdout + result.stderr };
    };
    const pin = (input: string, args: string[] = []) => {
      const result = spawnSync("bash", [join(pinnedDir(), "pin.sh"), ...args], { encoding: "utf8", input });
      return { status: result.status, out: result.stdout + result.stderr };
    };
    const evil = () => {
      const marker = join(dir, "owned");
      writeFileSync(join(work, "deploy/deploy.sh"), `#!/usr/bin/env bash\ntouch ${marker}\n`);
      writeFileSync(join(work, "deploy/compose.yaml"), "name: personal-website\nservices:\n  site:\n    image: evil\n    privileged: true\n    volumes: [/:/host]\n");
      return marker;
    };

    beforeEach(() => pinTo(pinnedDir()));

    it("a push that changes the deploy files is built, but its deploy files are only reported", () => {
      const a = push("a");
      expect(runPinned().status).toBe(0);
      const marker = evil();
      const b = push("evil");
      const run = runPinned();
      expect(run.status, run.out).toBe(0);
      expect(serving()).toBe(b);
      expect(read(join(project, "compose.yaml"))).not.toContain("privileged");
      expect(read(join(project, "deploy.log"))).toContain(`deploy/compose.yaml in ${b.slice(0, 12)} differs from the pinned one`);
      for (let i = 0; i < 2; i++) expect(runPinned().status).toBe(0);
      expect(existsSync(marker)).toBe(false);
      expect(read(join(pinnedDir(), "deploy.sh"))).toBe(read(join(ROOT, "deploy/deploy.sh")));
      expect(a).not.toBe(b);
    });

    it("refuses to run from the clone", () => {
      push("a");
      expect(runPinned().status).toBe(0);
      pinTo(join(project, "repo/deploy"));
      const result = spawnSync("bash", [join(project, "repo/deploy/deploy.sh")], { encoding: "utf8", env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, HOME: dir, PROJECT_DIR: project, REMOTE_URL: origin, FAKE_DOCKER_STATE: state } });
      expect([result.status, result.stdout]).toEqual([1, expect.stringContaining("refusing to run from the clone")]);
    });

    it("pin.sh shows the change and takes it only on a yes", () => {
      pinTo(join(project, "repo/deploy"));
      expect(pin("").out).toContain("already the same");
      writeFileSync(join(project, "repo/deploy/compose.yaml"), "name: changed\n");
      const before = read(join(pinnedDir(), "compose.yaml"));
      for (const answer of ["", "no\n", "y\n"]) {
        const run = pin(answer);
        expect([run.status, run.out.includes("+name: changed")]).toEqual([1, true]);
        expect(read(join(pinnedDir(), "compose.yaml"))).toBe(before);
      }
      expect(pin("yes\n").status).toBe(0);
      expect(read(join(pinnedDir(), "compose.yaml"))).toBe("name: changed\n");
    });

    it("pin.sh won't follow a link", () => {
      pinTo(join(project, "repo/deploy"));
      rmSync(join(project, "repo/deploy/compose.yaml"));
      symlinkSync("/etc/hostname", join(project, "repo/deploy/compose.yaml"));
      const run = pin("yes\n", ["--yes"]);
      expect([run.status, run.out]).toEqual([1, expect.stringContaining("no plain")]);
      expect(read(join(pinnedDir(), "compose.yaml"))).toBe(read(join(ROOT, "deploy/compose.yaml")));
    });
  });

  describe("staging: a second project with the photo services and the dashboard", () => {
    const TOKEN = "github_pat_test_do_not_print";
    let cmsOrigin = "";
    let cmsWork = "";

    const setting = (key: string) => read(join(project, ".env")).match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? "";
    const service = (name: string) => read(join(state, name)).trim();
    const log = () => read(join(project, "deploy.log"));
    const git = (cwd: string, ...args: string[]) => sh(cwd, "git", ...NO_HOOKS, "-c", "user.name=Test", "-c", "user.email=test@example.test", ...args);
    const edit = (change: (env: string) => string) => writeFileSync(join(project, ".env"), change(read(join(project, ".env"))));

    function pushStaging(message: string, services = "one") {
      mkdirSync(join(work, "services"), { recursive: true });
      writeFileSync(join(work, "services/main.mjs"), services);
      writeFileSync(join(work, "CHANGE"), `${message}\n`);
      git(work, "add", "-A");
      git(work, "commit", "-qm", message);
      git(work, "push", "-q", "origin", "HEAD:staging");
      return sh(work, "git", "rev-parse", "HEAD");
    }
    function pushCms(message: string) {
      writeFileSync(join(cmsWork, "CHANGE"), message);
      git(cmsWork, "add", "-A");
      git(cmsWork, "commit", "-qm", message);
      git(cmsWork, "push", "-q", "origin", "HEAD:env/nas-images");
      return sh(cmsWork, "git", "rev-parse", "HEAD");
    }
    const run = (env: Record<string, string> = {}) => deploy({ CMS_URL: cmsOrigin, ...env });

    beforeEach(() => {
      cmsOrigin = join(dir, "cms.git");
      cmsWork = join(dir, "cms-work");
      mkdirSync(cmsWork);
      sh(dir, "git", "init", "-q", "--bare", "-b", "main", cmsOrigin);
      sh(cmsWork, "git", "init", "-q", "-b", "main");
      sh(cmsWork, "git", "remote", "add", "origin", cmsOrigin);
      writeFileSync(
        join(project, ".env"),
        [
          "CLOUDINARY_CLOUD_NAME=demo\nCLOUDINARY_API_KEY=key\nCLOUDINARY_API_SECRET=secret\nRAWG_API_KEY=rawg\nTUNNEL_TOKEN=t\nSITE_SHA=",
          "STACK=pw-staging\nDEPLOY_BRANCH=staging\nIMAGE_BACKEND=nas\nPHOTOS=1",
          `PHOTOS_USER=${process.getuid!()}:${process.getgid!()}\nCMS_BRANCH=env/nas-images\nGITHUB_TOKEN=${TOKEN}\n`,
        ].join("\n"),
      );
    });

    it("brings up the photo services, the site and the dashboard on the first run", () => {
      const a = pushStaging("a");
      const cms = pushCms("cms a");
      const first = run();
      expect(first.status, first.out + log()).toBe(0);
      expect(setting("SITE_SHA")).toBe(`${a}-nas`);
      expect(service("site")).toBe(`${a}-nas`);
      expect([service("img"), service("repo")]).toEqual([setting("PHOTOS_SHA"), setting("PHOTOS_SHA")]);
      expect(service("photos")).toBe(sh(work, "git", "rev-parse", "HEAD:services"));
      expect(service("cms")).toBe(cms);
      const site = builds().find((call) => call.includes("pw-staging:"))!;
      expect(site).toContain("--build-arg IMAGE_BACKEND=nas");
      expect(site, "healthz reports the commit, not the tag").toContain(`--build-arg SITE_SHA=${a} `);
      // The photo services come first: the candidate's checks need an index.
      const order = calls()
        .map((call) => (call.includes(" up -d img photos repo") ? "photos" : call.startsWith("run ") ? "candidate" : ""))
        .filter(Boolean);
      expect(order).toEqual(["photos", "candidate"]);
      expect(calls().find((call) => call.startsWith("run "))).toContain(`-e IMAGE_BACKEND=nas -v ${project}/photos/index:/index:ro`);
    });

    it("never acts on the live project, by deploy.sh or by hand", () => {
      pushStaging("a");
      pushCms("cms a");
      expect(run().status).toBe(0);
      const compose = calls().filter((call) => call.startsWith("compose ") && !call.startsWith("compose version"));
      expect(compose.length).toBeGreaterThan(3);
      for (const call of compose) expect(call).toMatch(/^compose -p pw-staging /);
      expect(read(join(project, "compose.yaml"))).toMatch(/^name: pw-staging$/m);
      for (const call of calls()) expect(call).not.toMatch(/personal-website(-candidate|:)/);
    });

    it("keeps the token out of every command line, log and clone", () => {
      pushStaging("a");
      pushCms("cms a");
      const first = run();
      expect(first.status).toBe(0);
      const basic = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
      for (const text of [read(join(state, "calls")), first.out, log(), read(join(project, "cms/.git/config")), read(join(project, "build.log"))]) {
        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain(basic);
      }
    });

    it("rebuilds the photo services only when services/ changes", () => {
      pushStaging("a");
      pushCms("cms a");
      run();
      resetCalls();
      pushStaging("b");
      expect(run().status).toBe(0);
      expect(builds().filter((call) => call.includes("-photos:"))).toEqual([]);
      pushStaging("c", "two");
      expect(run().status).toBe(0);
      expect(builds().filter((call) => call.includes("-photos:"))).toHaveLength(1);
      expect(service("photos")).toBe(sh(work, "git", "rev-parse", "HEAD:services"));
    });

    it("goes back to the last photo services when new ones are unhealthy, and leaves the site alone", () => {
      const a = pushStaging("a");
      pushCms("cms a");
      run();
      const good = setting("PHOTOS_SHA");
      pushStaging("b", "broken");
      writeFileSync(join(state, "unhealthy"), "photos\n");
      expect(run().status).toBe(1);
      expect(setting("PHOTOS_SHA")).toBe(good);
      expect(service("photos")).toBe(good);
      expect(service("site")).toBe(`${a}-nas`);
    });

    it("leaves nothing running when the first photo services are unhealthy", () => {
      pushStaging("a");
      pushCms("cms a");
      writeFileSync(join(state, "unhealthy"), "img\n");
      expect(run().status).toBe(1);
      expect(setting("PHOTOS_SHA")).toBe("");
      expect([service("img"), service("photos"), service("site")]).toEqual(["", "", ""]);
      rmSync(join(state, "unhealthy"));
      const again = run();
      expect(again.status, again.out + log()).toBe(0);
    });

    it("won't build services/ when it's a link to somewhere else", () => {
      pushStaging("a");
      pushCms("cms a");
      rmSync(join(work, "services"), { recursive: true });
      symlinkSync("/etc", join(work, "services"));
      git(work, "add", "-A");
      git(work, "commit", "-qm", "link");
      git(work, "push", "-q", "origin", "HEAD:staging");
      expect(run().status).toBe(1);
      expect(builds().filter((call) => call.includes("-photos:"))).toEqual([]);
      expect(log()).toContain("services is not a plain folder");
    });

    it("gives the token to `repo` alone, and keeps the site off the other services' networks", () => {
      const files = ["compose.yaml", "compose.photos.yaml", "compose.cms.yaml"].map((file) => parse(readFileSync(join(ROOT, "deploy", file), "utf8")));
      const services = Object.assign({}, ...files.map((file) => file.services)) as Record<string, { environment?: Record<string, string>; networks: string[]; volumes?: string[]; privileged?: boolean; ports?: unknown }>;
      const holding = Object.entries(services).filter(([, { environment }]) => /GITHUB_TOKEN/.test(JSON.stringify(environment ?? {}))).map(([name]) => name);
      expect(holding).toEqual(["repo"]);
      expect(Object.fromEntries(Object.entries(services).map(([name, { networks }]) => [name, networks]))).toEqual({
        site: ["web"],
        cloudflared: ["web", "library"],
        img: ["library"],
        photos: ["library", "repo"],
        repo: ["repo"],
        cms: ["library", "repo"],
      });
      for (const [name, service] of Object.entries(services)) {
        expect([name, service.ports, service.privileged, (service.volumes ?? []).some((volume) => /docker\.sock/.test(volume))]).toEqual([name, undefined, undefined, false]);
      }
    });

    it("a dashboard that won't build doesn't hold up the site, and isn't retried until it changes", () => {
      const a = pushStaging("a");
      pushCms("broken");
      writeFileSync(join(state, "build-fail"), "pw-staging-cms");
      expect(run().status).toBe(1);
      expect(service("site")).toBe(`${a}-nas`);
      resetCalls();
      expect(run().status).toBe(0);
      expect(builds()).toEqual([]);
      rmSync(join(state, "build-fail"));
      const fixed = pushCms("fixed");
      expect(run().status).toBe(0);
      expect(service("cms")).toBe(fixed);
    });

    it("puts the old dashboard back when the new one is unhealthy", () => {
      pushStaging("a");
      const good = pushCms("good");
      run();
      pushCms("bad");
      writeFileSync(join(state, "unhealthy"), "cms\n");
      expect(run().status).toBe(1);
      expect(setting("CMS_SHA")).toBe(good);
      expect(service("cms")).toBe(good);
    });

    it("redeploys the same commit when IMAGE_BACKEND changes, and changes back without a build", () => {
      const a = pushStaging("a");
      pushCms("cms a");
      run();
      edit((env) => env.replace("IMAGE_BACKEND=nas", "IMAGE_BACKEND=cloudinary"));
      expect(run().status).toBe(0);
      expect(service("site")).toBe(a);
      resetCalls();
      edit((env) => env.replace("IMAGE_BACKEND=cloudinary", "IMAGE_BACKEND=nas"));
      expect(run().status).toBe(0);
      expect(service("site")).toBe(`${a}-nas`);
      expect(builds()).toEqual([]);
    });

    it("starts the photo services when PHOTOS is turned on for a commit already serving", () => {
      pushStaging("a");
      edit((env) => env.replace("PHOTOS=1\n", "").replace("CMS_BRANCH=env/nas-images\n", ""));
      expect(run().status).toBe(0);
      expect(service("photos")).toBe("");
      edit((env) => `${env}PHOTOS=1\n`);
      expect(run().status).toBe(0);
      expect(service("photos")).not.toBe("");
    });
  });
});
