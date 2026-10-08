// The CMS contract: every field the cms-dashboard can author, applied to the
// real src/content and checked against what the real pages render.
//
// Cases come from the dashboard's Vitest suite, which drives its editors and
// records the exact file bytes it would publish plus what the site should
// show for them (CMS_CASES=<path>, set by `npm run test:contract` in
// cms-dashboard). Without CMS_CASES, the committed snapshot in cases.json runs.
// Every case is reverted when it finishes, and the suite asserts the content
// folder ends exactly as it started.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compile } from "@mdx-js/mdx";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { apply, contentStatus, restore, type CaseFile } from "./apply";
import { ROOT } from "./loader";
import { mockFetch, renderRoute } from "./routes";

vi.mock("astro:content", () => import("./loader"));

type Expectation = { route: string; status?: number; contains?: string[]; notContains?: string[]; order?: string[]; count?: Record<string, number> };
type ContractCase = {
  id: string;
  title: string;
  files: CaseFile[];
  expect: Expectation[];
  mdx?: { path: string; outline: Array<{ id: string; label: string }> };
  snippet?: { component: string; props: string[] };
  tags?: { accepted: string[]; hidden: string[] };
  parity?: Array<{ fn: "albumDetails" | "pieceMeta" | "languageFormat"; input: never; output: string }>;
};

const source = process.env.CMS_CASES ?? join(import.meta.dirname, "cases.json");
const cases: ContractCase[] = existsSync(source) ? JSON.parse(readFileSync(source, "utf8")) : [];

let initialStatus = "";
beforeAll(() => {
  initialStatus = contentStatus();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
  vi.stubEnv("CLOUDINARY_API_KEY", "key");
  vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
});
afterEach(() => restore());
afterAll(() => {
  restore();
  expect(contentStatus(), "src/content must end the run exactly as it started").toBe(initialStatus);
});

function expectOrder(body: string, needles: string[], route: string) {
  let at = -1;
  for (const needle of needles) {
    const next = body.indexOf(needle, at + 1);
    expect(next, `${route}: “${needle}” should appear after “${needles[needles.indexOf(needle) - 1] ?? "(start)"}”`).toBeGreaterThan(at);
    at = next;
  }
}

async function checkExpectation(e: Expectation) {
  const { status, body } = await renderRoute(e.route);
  expect(status, `${e.route} status`).toBe(e.status ?? 200);
  for (const s of e.contains ?? []) expect(body, `${e.route} should contain “${s}”`).toContain(s);
  for (const s of e.notContains ?? []) expect(body, `${e.route} should not contain “${s}”`).not.toContain(s);
  if (e.order) expectOrder(body, e.order, e.route);
  for (const [needle, n] of Object.entries(e.count ?? {})) {
    expect(body.split(needle).length - 1, `${e.route}: “${needle}” should appear ${n}×`).toBe(n);
  }
}

const propsOf = (component: string) => {
  const src = readFileSync(join(ROOT, `src/components/writeup/${component}.astro`), "utf8");
  const block = src.match(/interface Props\s*{([\s\S]*?)\n}/)?.[1] ?? "";
  return [...block.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]!);
};

describe.runIf(cases.length)(`CMS contract (${cases.length} cases from ${process.env.CMS_CASES ? "cms-dashboard" : "cases.json"})`, () => {
  it.each(cases.map((c) => [`${c.id}: ${c.title}`, c] as const))("%s", async (_name, c) => {
    apply(c.files);
    for (const e of c.expect) await checkExpectation(e);

    if (c.mdx) {
      const file = c.files.find((f) => f.path === c.mdx!.path)!;
      const body = file.content!.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
      const { tocFromBody } = await import("../../src/lib/toc");
      expect(tocFromBody(body), "the CMS outline must match the site's TOC").toEqual(c.mdx.outline);
      await expect(compile(body), "the write-up must compile as MDX").resolves.toBeDefined();
      const { mdxComponents } = await import("../../src/components/writeup/index");
      const imported = new Set([...body.matchAll(/^import\s+(?:\{([^}]*)\}|(\w+))/gm)].flatMap((m) => (m[1] ? m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()!) : [m[2]!])));
      const used = new Set([...body.matchAll(/<([A-Z]\w*)/g)].map((m) => m[1]!));
      for (const name of used) expect(name in mdxComponents || imported.has(name), `<${name}> must be a registered write-up component`).toBe(true);
    }

    if (c.snippet) {
      const { mdxComponents } = await import("../../src/components/writeup/index");
      expect(c.snippet.component in mdxComponents, `<${c.snippet.component}> exists`).toBe(true);
      const accepted = propsOf(c.snippet.component);
      for (const prop of c.snippet.props) expect(accepted, `<${c.snippet.component}> accepts ${prop}`).toContain(prop);
    }

    if (c.tags) {
      const { isPublicTag } = await import("../../src/lib/cloudinarySearchPolicy");
      const { publicTags } = await import("../../src/lib/cloudinaryServer");
      for (const tag of c.tags.accepted) {
        const hidden = c.tags.hidden.includes(tag);
        expect(isPublicTag(tag), `tag “${tag}” is ${hidden ? "hidden" : "public"} in the CMS`).toBe(!hidden);
      }
      expect(publicTags(c.tags.accepted)).toEqual(c.tags.accepted.filter((t) => !c.tags!.hidden.includes(t)).sort());
    }

    for (const p of c.parity ?? []) {
      const input = p.input as Record<string, unknown> | number;
      if (p.fn === "albumDetails") {
        const { albumDetails } = await import("../../src/lib/albums");
        expect(albumDetails(input as never)).toBe(p.output);
      } else if (p.fn === "pieceMeta") {
        const { pieceMeta } = await import("../../src/lib/content");
        const i = input as { kind: string; date: string; full?: boolean };
        expect(pieceMeta(i.kind, new Date(i.date), i.full)).toBe(p.output);
      } else {
        const LanguageBar = (await import("../../src/components/cards/LanguageBar.astro")).default;
        const html = await (await AstroContainer.create()).renderToString(LanguageBar, { props: { languages: [{ name: "X", pct: input as number }] } });
        expect(html).toContain(`X ${p.output}`);
      }
    }
  });
});

// The real Astro content layer, not the test loader, must accept what the CMS
// writes, and must reject what the CMS refuses to publish.
describe.runIf(cases.length)("real Astro content sync", () => {
  const sync = () => spawnSync("npx", ["astro", "sync"], { cwd: ROOT, encoding: "utf8", env: { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" } });

  // One retry: a genuine schema rejection fails both times; npx/cache hiccups don't.
  it("accepts one authored case per collection at once", { retry: 1, timeout: 120_000 }, () => {
    const picked = ["entries.featured.engineering", "entries.berlin", "sections.add", "career.text", "albums.cover"]
      .map((id) => cases.find((c) => c.id === id))
      .filter((c): c is ContractCase => !!c);
    expect(picked.length).toBeGreaterThan(0);
    for (const c of picked) apply(c.files);
    const res = sync();
    expect(res.status, res.stderr || res.stdout).toBe(0);
  });

  it("rejects a file the CMS would refuse", { timeout: 120_000 }, () => {
    const pnc = cases.find((c) => c.files.some((f) => f.path === "src/content/career/pnc.yaml" && f.content));
    expect(pnc).toBeDefined();
    const file = pnc!.files.find((f) => f.path === "src/content/career/pnc.yaml")!;
    apply([{ ...file, content: file.content!.replace(/^href: .*$/m, "href: not a url") }]);
    expect(sync().status).not.toBe(0);
  });
});
