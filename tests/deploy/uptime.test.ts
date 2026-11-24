// scripts/uptime.mjs, the outside check the Uptime workflow runs, against a
// stub site: what it calls healthy, a deploy in progress, a failed deploy,
// and an outage, and that one blip (a container swap) isn't an outage.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(import.meta.dirname, "../../scripts/uptime.mjs");
const MAIN = "a".repeat(40);
const OLD = "b".repeat(40);

type Site = { sha: string; down: Set<string>; blips: Map<string, number>; requests: { path: string; referer?: string }[] };
let site: Site;
let server: Server;
let origin = "";
let dir = "";

const reply = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "uptime-test-"));
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    site.requests.push({ path, referer: req.headers.referer });
    const blips = site.blips.get(path) ?? 0;
    if (blips > 0) {
      site.blips.set(path, blips - 1);
      return reply(res, 502, "bad gateway");
    }
    if (site.down.has(path)) return reply(res, 500, { error: "down" });
    if (path === "/healthz") return reply(res, 200, { ok: true, sha: site.sha });
    if (path === "/") return reply(res, 200, "<title>Liam Sullivan</title>");
    if (path === "/photography") return reply(res, 200, "<title>Photos</title>");
    if (path === "/api/cloudinary/pool") return reply(res, 200, { resources: [{ public_id: "x" }] });
    if (path === "/api/rawg/platforms") {
      const ok = req.headers.referer === `${origin}/switch-menu/` && req.headers["sec-fetch-dest"] === "empty";
      return ok ? reply(res, 200, { results: [{ id: 1 }] }) : reply(res, 403, { detail: "Forbidden" });
    }
    return reply(res, 404, "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  site = { sha: MAIN, down: new Set(), blips: new Map(), requests: [] };
});

/** Runs the check as the workflow does; `ageMin` is how long ago main's head was committed. */
function check(ageMin = 60, extra: string[] = []) {
  const report = join(dir, `report-${Math.random()}.md`);
  const committedAt = String(Math.floor(Date.now() / 1000) - ageMin * 60);
  const child = spawn(process.execPath, [SCRIPT, origin, "--expect-sha", MAIN, "--committed-at", committedAt, "--report", report, ...extra], {
    env: { PATH: process.env.PATH, UPTIME_RETRY_DELAY_MS: "10", UPTIME_TIMEOUT_MS: "2000" },
  });
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  child.stderr.on("data", (chunk) => (out += chunk));
  return new Promise<{ status: number | null; out: string; report: string }>((resolve) =>
    child.on("close", (status) => resolve({ status, out, report: readFileSync(report, "utf8") })),
  );
}

describe("scripts/uptime.mjs", () => {
  it("passes when the site is up and serving main", async () => {
    const run = await check();
    expect(run.status, run.out).toBe(0);
    expect(run.out).toMatch(/ok {4}deploy +serving main/);
    expect(run.report.split("\n")[0]).toBe("<!-- uptime-key: ok -->");
    // The RAWG check asks as the Switch menu's iframe does.
    expect(site.requests.find((r) => r.path === "/api/rawg/platforms")?.referer).toBe(`${origin}/switch-menu/`);
  });

  it("treats an older commit as deploying within the grace period", async () => {
    site.sha = OLD;
    const run = await check(10);
    expect(run.status, run.out).toBe(0);
    expect(run.out).toMatch(/deploy +main moved 10 min ago .*\(deploying\)/);
  });

  it("(regression) fails when main moved on and the site still serves an older commit", async () => {
    site.sha = OLD;
    const run = await check(45);
    expect(run.status).toBe(1);
    expect(run.out).toMatch(/FAIL {2}deploy +main has been at aaaaaaaaaaaa for 45 min but the site serves bbbbbbbbbbbb/);
    expect(run.report.split("\n")[0]).toBe("<!-- uptime-key: deploy -->");
  });

  it("fails when an upstream key stops working, naming which", async () => {
    site.down.add("/api/cloudinary/pool");
    const run = await check();
    expect(run.status).toBe(1);
    expect(run.out).toMatch(/FAIL {2}photos +HTTP 500 \(twice/);
    expect(run.report.split("\n")[0]).toBe("<!-- uptime-key: photos -->");
  });

  it("fails when the site is down, and can't vouch for the deploy", async () => {
    for (const path of ["/healthz", "/", "/photography", "/api/cloudinary/pool", "/api/rawg/platforms"]) site.down.add(path);
    const run = await check();
    expect(run.status).toBe(1);
    expect(run.report.split("\n")[0]).toBe("<!-- uptime-key: health,home page,photography,photos,rawg,deploy -->");
  });

  it("retries once, so a few seconds of 502 during a container swap pass", async () => {
    site.blips.set("/healthz", 1);
    site.blips.set("/photography", 1);
    const run = await check();
    expect(run.status, run.out).toBe(0);
    expect(site.requests.filter((r) => r.path === "/healthz")).toHaveLength(2);
  });

  it("refuses to run without an origin, or with a sha but no commit time", async () => {
    const bare = spawn(process.execPath, [SCRIPT, origin, "--expect-sha", MAIN]);
    expect(await new Promise((resolve) => bare.on("close", resolve))).toBe(2);
  });
});
