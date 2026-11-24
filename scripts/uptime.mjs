// The outside uptime check (.github/workflows/uptime.yml runs it every 15
// minutes from GitHub, off the NAS). It catches what a deploy failure looks
// like from outside: the site down, no photos, the RAWG key gone,
// or main moving on while the site keeps serving an older commit.
//
//   node scripts/uptime.mjs https://liambsullivan.com
//   node scripts/uptime.mjs https://liambsullivan.com --expect-sha <main sha> --committed-at <unix s>
//
// --expect-sha    main's head; /healthz must report it once --grace-min has
// --committed-at  passed since that commit (a poll plus a build is ~10 min)
// --grace-min     default 30
// --report <file> also write a Markdown report (the workflow's issue body)
//
// Behind Cloudflare Access (staging), set CF_ACCESS_CLIENT_ID and
// CF_ACCESS_CLIENT_SECRET to a service token. A failed check is retried once
// after RETRY_DELAY_MS, so a container swap (a few seconds of 502) isn't an
// outage. Exit 0 when everything passes, 1 when something failed, 2 on usage.
import { appendFileSync, writeFileSync } from "node:fs";

const RETRY_DELAY_MS = Number(process.env.UPTIME_RETRY_DELAY_MS ?? 30_000);
const TIMEOUT_MS = Number(process.env.UPTIME_TIMEOUT_MS ?? 20_000);

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};
const origin = args.find((arg, i) => !arg.startsWith("--") && !args[i - 1]?.startsWith("--"));
const expectSha = flag("--expect-sha");
const committedAt = Number(flag("--committed-at") ?? NaN);
const graceMin = Number(flag("--grace-min") ?? 30);
const reportFile = flag("--report");
if (!origin || !/^https?:\/\//.test(origin) || (expectSha && !Number.isFinite(committedAt))) {
  console.error("usage: node scripts/uptime.mjs <origin> [--expect-sha <sha> --committed-at <unix s>] [--grace-min 30] [--report <file>]");
  process.exit(2);
}
const base = origin.replace(/\/+$/, "");

const access = process.env.CF_ACCESS_CLIENT_ID
  ? { "cf-access-client-id": process.env.CF_ACCESS_CLIENT_ID, "cf-access-client-secret": process.env.CF_ACCESS_CLIENT_SECRET ?? "" }
  : {};

async function get(path, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { "user-agent": "site-uptime-check", "cache-control": "no-cache", ...access, ...headers },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, text: await res.text() };
}
const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

let served = null;
const checks = [
  {
    name: "health",
    path: "/healthz",
    test: ({ status, text }) => {
      const body = json(text);
      if (status !== 200) return `HTTP ${status}`;
      if (body?.ok !== true || typeof body.sha !== "string") return `unexpected body: ${text.slice(0, 80)}`;
      served = body.sha;
      return null;
    },
  },
  { name: "home page", path: "/", test: ({ status, text }) => (status !== 200 ? `HTTP ${status}` : /<title>/.test(text) ? null : "no <title>") },
  { name: "photography", path: "/photography", test: ({ status }) => (status !== 200 ? `HTTP ${status}` : null) },
  {
    // The page renders 200 even without a photo index; this route doesn't.
    name: "photos",
    path: "/api/cloudinary/pool",
    test: ({ status, text }) => (status !== 200 ? `HTTP ${status}` : json(text)?.resources?.length ? null : "no photos"),
  },
  {
    // As the Switch menu's iframe asks.
    name: "rawg",
    path: "/api/rawg/platforms?page_size=1",
    headers: { referer: `${base}/switch-menu/`, "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" },
    test: ({ status, text }) => (status !== 200 ? `HTTP ${status} ${text.slice(0, 60)}` : json(text)?.results ? null : "no results"),
  },
];

async function run(check) {
  try {
    return check.test(await get(check.path, check.headers));
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const results = [];
for (const check of checks) {
  let problem = await run(check);
  if (problem) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    const again = await run(check);
    problem = again && `${again} (twice, ${RETRY_DELAY_MS / 1000} s apart)`;
  }
  results.push({ name: check.name, ok: !problem, detail: problem ?? `${check.path} 200` });
}

// The deploy: /healthz names the commit the container was built from.
if (expectSha) {
  const ageMin = Math.max(0, Math.floor((Date.now() / 1000 - committedAt) / 60));
  const short = (sha) => (sha ? sha.slice(0, 12) : "nothing");
  if (served === null) {
    results.push({ name: "deploy", ok: false, detail: "unknown: /healthz didn't answer" });
  } else if (served === expectSha) {
    results.push({ name: "deploy", ok: true, detail: `serving main (${short(served)})` });
  } else if (ageMin < graceMin) {
    results.push({ name: "deploy", ok: true, detail: `main moved ${ageMin} min ago to ${short(expectSha)}; still serving ${short(served)} (deploying)` });
  } else {
    results.push({
      name: "deploy",
      ok: false,
      detail: `main has been at ${short(expectSha)} for ${ageMin} min but the site serves ${short(served)}: the build or its checks failed, or the poller isn't running (deploy.log and build.log on the NAS)`,
    });
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name.padEnd(12)} ${r.detail}`);

const report = [
  `<!-- uptime-key: ${failed.map((r) => r.name).join(",") || "ok"} -->`,
  `**${failed.length ? `${failed.length} check(s) failing` : "All checks pass"}** on ${base}, ${new Date().toISOString()}`,
  "",
  "| | Check | Detail |",
  "|---|---|---|",
  ...results.map((r) => `| ${r.ok ? "✅" : "❌"} | ${r.name} | ${r.detail.replaceAll("|", "\\|")} |`),
  "",
].join("\n");
if (reportFile) writeFileSync(reportFile, report);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);

process.exit(failed.length ? 1 : 0);
