import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyIndex, loadIndex, saveIndex } from "../../services/lib/index.mjs";
import { createApi, emptyTrash, signUpload, TRASH, uploadFolder, uploadName } from "../../services/photos/api.mjs";
import { createWatcher } from "../../services/photos/main.mjs";

const secret = "s".repeat(40);
const dashboard = "https://cms.example";
let dir: string, root: string, server: Server, base: string;
let watcher: ReturnType<typeof createWatcher>;
let warmed: any[];
let time: number;

const jpeg = (color = "red", size = 40) => sharp({ create: { width: size, height: 20, channels: 3, background: color } }).jpeg().toBuffer();
const filesIn = (path: string) => (existsSync(join(root, path)) ? readdirSync(join(root, path)).filter((name) => name !== "album.yaml").sort() : []);
const auth = { authorization: `Bearer ${secret}` };
const post = (path: string, body: unknown, headers: Record<string, string> = auth) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const form = (file: Buffer | null, fields: Record<string, string> = {}) => {
  const data = new FormData();
  if (file) data.append("file", new Blob([new Uint8Array(file)]), "../../evil name.jpg");
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
};
const uploadUrl = (tags = "", at = time, by = secret, to: { folder?: string; name?: string } = {}) => {
  const timestamp = String(Math.floor(at / 1000));
  return `/upload?${new URLSearchParams({ timestamp, tags, ...to, signature: signUpload({ timestamp, tags, ...to }, by) })}`;
};
const uploadTo = (folder: string, name = "") => uploadUrl("", time, secret, { folder, name });
const upload = (file: Buffer | null, url = uploadUrl(), headers: Record<string, string> = {}) => fetch(base + url, { method: "POST", body: form(file), headers });

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "api-"));
  root = join(dir, "Published");
  mkdirSync(join(root, "Shoot"), { recursive: true });
  writeFileSync(join(root, "Shoot/a.jpg"), await jpeg("blue"));
  writeFileSync(join(root, "Shoot/b.jpg"), await jpeg("green"));
  await saveIndex(join(dir, "index.json"), emptyIndex());
  watcher = createWatcher({ root, indexFile: join(dir, "index.json"), log: () => {} } as any);
  await watcher.tick();
  await watcher.tick();
  warmed = [];
  time = Date.now();
  const api = createApi({ watcher, root, secret, dashboardOrigin: dashboard, now: () => time, warm: (photos: any[]) => warmed.push(...photos), log: () => {} } as any);
  server = createServer(api);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true });
});
const scanNow = async () => (await watcher.tick()) as any;
const idOf = (path: string) => Object.keys(watcher.index.photos).find((id) => watcher.index.photos[id].path === path)!;

describe("authorisation", () => {
  it("refuses everything under /v1 without the secret", async () => {
    for (const path of ["/v1/photos", "/v1/site-images", "/v1/nope"]) {
      for (const headers of [{}, { authorization: "Bearer x" }, { authorization: secret }]) {
        const res = await fetch(base + path, { headers: headers as Record<string, string> });
        expect([res.status, res.headers.get("cache-control")]).toEqual([401, "no-store"]);
      }
    }
    expect((await post("/v1/delete", { ids: [idOf("Shoot/a.jpg")] }, {})).status).toBe(401);
    expect(filesIn("Shoot")).toEqual(["a.jpg", "b.jpg"]);
  });

  it("refuses an upload that isn't signed, is too old, or was signed for other tags", async () => {
    const file = await jpeg();
    const signed = uploadUrl("music");
    for (const url of ["/upload", uploadUrl("", time, "other".repeat(10)), uploadUrl("", time - 16 * 60_000), uploadUrl("", time + 5 * 60_000), signed.replace("music", "sports")]) {
      expect((await upload(file, url)).status, url).toBe(401);
    }
    expect(filesIn("_unsorted")).toEqual([]);
  });

  it("answers an unsigned upload without reading the file", async () => {
    const socket = connect(Number(new URL(base).port), "127.0.0.1");
    socket.write("POST /upload HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=b\r\nContent-Length: 15000000\r\n\r\n--b\r\n");
    const reply = await new Promise<string>((done) => socket.once("data", (data) => done(String(data))));
    socket.destroy();
    expect(reply).toMatch(/^HTTP\/1\.1 401 [\s\S]*connection: close/i);
  });

  it("lets only the dashboard upload from a browser", async () => {
    const ask = (origin: string) => fetch(`${base}/upload`, { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST" } });
    expect((await ask(dashboard)).headers.get("access-control-allow-origin")).toBe(dashboard);
    expect((await ask("https://evil.example")).headers.get("access-control-allow-origin")).toBeNull();
    expect((await upload(await jpeg(), uploadUrl(), { origin: dashboard })).headers.get("access-control-allow-origin")).toBe(dashboard);
    expect((await fetch(`${base}/v1/photos`, { headers: { ...auth, origin: dashboard } })).headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("library", () => {
  it("lists photos as the dashboard read them from Cloudinary", async () => {
    const { resources } = await (await fetch(`${base}/v1/photos`, { headers: auth })).json();
    expect(resources).toHaveLength(2);
    const photo = watcher.index.photos[resources[0].public_id];
    expect(resources[0]).toMatchObject({ secure_url: `https://liambsullivan.com/img/upload/v${photo.version}/${resources[0].public_id}.webp`, width: 40, height: 20, format: "jpg", tags: [], folder: "Shoot", album: "Shoot", version: photo.version });
    expect(resources.map(({ filename }: { filename: string }) => filename).sort()).toEqual(["a.jpg", "b.jpg"]);
    expect(new Date(resources[0].created_at).getTime()).toBeGreaterThan(0);
  });

  it("adds and removes tags, and keeps them over a re-export", async () => {
    const id = idOf("Shoot/a.jpg");
    expect(await (await post("/v1/tags", { ids: [id, "nope", id], tag: "music", command: "add" })).json()).toEqual({ public_ids: [id] });
    const saved = () => loadIndex(join(dir, "index.json"))!.photos[id];
    expect(saved().tagEdits).toEqual({ music: true });
    writeFileSync(join(root, "Shoot/a.jpg"), await jpeg("blue", 90));
    await watcher.tick();
    await watcher.tick();
    expect(saved()).toMatchObject({ tagEdits: { music: true }, width: 90 });
    await post("/v1/tags", { ids: [id], tag: "music", command: "remove" });
    expect(saved().tagEdits).toBeUndefined();
    for (const bad of [{ tag: "a b", command: "add" }, { tag: "a", command: "set" }]) expect((await post("/v1/tags", { ids: [id], ...bad })).status).toBe(400);
    for (const ids of [[], "x", [1], Array(2001).fill("x")]) expect((await post("/v1/tags", { ids, tag: "a", command: "add" })).status).toBe(400);
  });

  it("deletes into the trash, unpublishes at once, and empties it after 30 days", async () => {
    const id = idOf("Shoot/a.jpg");
    const body = readFileSync(join(root, "Shoot/a.jpg"));
    expect(await (await post("/v1/delete", { ids: [id, "nope", "__proto__"] })).json()).toEqual({ deleted: { [id]: "deleted", nope: "not_found", ["__proto__"]: "not_found" } });
    expect(filesIn("Shoot")).toEqual(["b.jpg"]);
    const [trashed] = filesIn(TRASH);
    expect(readFileSync(join(root, TRASH, trashed))).toEqual(body);
    await watcher.tick();
    const result = await scanNow();
    expect([result.events, watcher.index.photos[id].goneAt !== undefined, watcher.health().photos]).toEqual([[], true, 1]);
    writeFileSync(join(root, TRASH, "keep-me.txt"), "");
    await emptyTrash(root, time + 29 * 86_400_000);
    expect(filesIn(TRASH)).toHaveLength(2);
    await emptyTrash(root, time + 31 * 86_400_000);
    expect(filesIn(TRASH)).toEqual(["keep-me.txt"]);
  });

  it("restores a deleted photo, id and tags included, and the scan then has nothing to do", async () => {
    const id = idOf("Shoot/a.jpg");
    const body = readFileSync(join(root, "Shoot/a.jpg"));
    await post("/v1/tags", { ids: [id], tag: "music", command: "add" });
    await post("/v1/delete", { ids: [id] });
    expect(await (await post("/v1/restore", { ids: [id, "nope", "__proto__"] })).json()).toEqual({ restored: { [id]: "restored", nope: "not_found", ["__proto__"]: "not_found" } });
    expect([readFileSync(join(root, "Shoot/a.jpg")), filesIn(TRASH)]).toEqual([body, []]);
    for (let i = 0; i < 2; i++) expect((await scanNow()).events).toEqual([]);
    const { resources } = await (await fetch(`${base}/v1/photos`, { headers: auth })).json();
    expect(resources.find((photo: { public_id: string }) => photo.public_id === id)).toMatchObject({ folder: "Shoot", tags: ["music"] });
    // Not deleted any more, so there's nothing to restore.
    expect((await (await post("/v1/restore", { ids: [id] })).json()).restored).toEqual({ [id]: "not_found" });
  });

  it("won't restore over a file that took its place", async () => {
    const id = idOf("Shoot/a.jpg");
    await post("/v1/delete", { ids: [id] });
    const other = await jpeg("yellow");
    writeFileSync(join(root, "Shoot/a.jpg"), other);
    expect((await (await post("/v1/restore", { ids: [id] })).json()).restored).toEqual({ [id]: "taken" });
    expect([readFileSync(join(root, "Shoot/a.jpg")), filesIn(TRASH).length]).toEqual([other, 1]);
  });

  it("reports its state and what it skipped", async () => {
    writeFileSync(join(root, "Shoot/notes.txt"), "x");
    await scanNow();
    const status = await (await fetch(`${base}/v1/status`, { headers: auth })).json();
    expect(status).toMatchObject({ ok: true, photos: 2, blocked: null, skipped: [{ path: "Shoot/notes.txt" }] });
    expect((await fetch(`${base}/v1/status`)).status).toBe(401);
  });

  it("finishes a delete when the file is already gone", async () => {
    const id = idOf("Shoot/a.jpg");
    rmSync(join(root, "Shoot/a.jpg"));
    expect(await (await post("/v1/delete", { ids: [id] })).json()).toEqual({ deleted: { [id]: "deleted" } });
  });

  it("refuses bodies that aren't what it expects", async () => {
    expect((await fetch(`${base}/v1/tags`, { method: "POST", headers: auth, body: "{" })).status).toBe(400);
    expect((await fetch(`${base}/v1/tags`, { method: "POST", headers: auth, body: "x".repeat(2e6) })).status).toBe(413);
    expect((await fetch(`${base}/v1/nope`, { headers: auth })).status).toBe(404);
    expect((await fetch(`${base}/v1/photos`, { method: "DELETE", headers: auth })).status).toBe(404);
  });
});

describe("albums", () => {
  let colour = 0;
  async function photos(folder: string, n = 5) {
    mkdirSync(join(root, folder), { recursive: true });
    for (let i = 1; i <= n; i++) writeFileSync(join(root, folder, `${i}.jpg`), await jpeg(`#${(++colour * 4111).toString(16).padStart(6, "0").slice(-6)}`));
  }
  const settle = async () => {
    for (let i = 0; i < 3; i++) await scanNow();
  };
  const call = async (op: string, body: unknown) => {
    const res = await post(`/v1/albums/${op}`, body);
    return { status: res.status, ...(await res.json()) };
  };
  const list = async (): Promise<any[]> => (await (await fetch(`${base}/v1/albums`, { headers: auth })).json()).albums;
  const album = async (folder: string) => (await list()).find((item) => item.folder === folder);
  const yaml = (folder: string) => readFileSync(join(root, folder, "album.yaml"), "utf8");
  /** Nothing the API did looks like a change to the next scans. */
  const quiet = async () => {
    for (let i = 0; i < 3; i++) expect((await scanNow()).events).toEqual([]);
  };

  it("lists every album, hidden and empty ones too", async () => {
    await photos("Otakon 2026/Day 1");
    mkdirSync(join(root, "Empty"));
    await settle();
    expect((await list()).map(({ folder, title, parent, shown, count }) => [folder, title, parent, shown, count]).sort()).toEqual([
      ["Empty", "Empty", null, false, 0],
      ["Otakon 2026", "Otakon 2026", null, true, 5],
      ["Otakon 2026/Day 1", "Day 1", "Otakon 2026", true, 5],
      ["Shoot", "Shoot", null, false, 2],
    ]);
    expect(await album("Otakon 2026")).toMatchObject({ photos: [], subs: ["Otakon 2026/Day 1"], cover: [1, 2, 3].map((n) => idOf(`Otakon 2026/Day 1/${n}.jpg`)), broken: null });
    expect((await fetch(`${base}/v1/albums`)).status).toBe(401);
  });

  it("creates a folder, at the top or inside an album", async () => {
    expect(await call("create", { title: "Otakon 2026" })).toEqual({ status: 200, folder: "Otakon 2026" });
    expect(await call("create", { title: "Day 1", parent: "Otakon 2026" })).toEqual({ status: 200, folder: "Otakon 2026/Day 1" });
    expect([existsSync(join(root, "Otakon 2026/Day 1/album.yaml")), (await album("Otakon 2026/Day 1")).shown]).toEqual([true, false]);
    expect((await call("create", { title: "otakon 2026" })).status).toBe(409);
    expect((await call("create", { title: "x", parent: "Nowhere" })).status).toBe(404);
    for (const title of ["", " x", "_unsorted", ".x", "a/b", "..", "Bash 4-11", "x".repeat(101), undefined, 7, { a: 1 }]) expect([title, (await call("create", { title })).status]).toEqual([title, 400]);
    for (const parent of ["..", "../x", "_unsorted", ".site", null, ["Shoot"]]) expect([parent, (await call("create", { title: "x", parent })).status]).toEqual([parent, 404]);
    await quiet();
  });

  it("renames the folder, keeping its day and its link", async () => {
    await photos("Bash 4-11");
    await photos("Bash 4-11/Day 1");
    await settle();
    const before = [idOf("Bash 4-11/1.jpg"), (await album("Bash 4-11")).path, (await album("Bash 4-11/Day 1")).path];
    expect(await call("rename", { folder: "Bash 4-11", title: "Bigelow Bash" })).toEqual({ status: 200, folder: "Bigelow Bash 4-11" });
    expect([idOf("Bigelow Bash 4-11/1.jpg"), (await album("Bigelow Bash 4-11")).path, (await album("Bigelow Bash 4-11/Day 1")).path]).toEqual(before);
    expect([existsSync(join(root, "Bash 4-11")), yaml("Bigelow Bash 4-11")]).toEqual([false, expect.not.stringContaining("\nwas:")]);
    expect(await call("rename", { folder: "Shoot", title: "SHOOT" })).toEqual({ status: 200, folder: "SHOOT" });
    expect((await call("rename", { folder: "SHOOT", title: "Bigelow bash 4-11" })).status).toBe(400);
    expect((await call("rename", { folder: "Bigelow Bash 4-11", title: "a/b" })).status).toBe(400);
    expect((await call("rename", { folder: "Gone", title: "x" })).status).toBe(404);
    await photos("Other 4-11", 1);
    await settle();
    expect((await call("rename", { folder: "Other 4-11", title: "bigelow bash" })).status).toBe(409);
    await quiet();
  });

  it("moves an album into another and out again, its old link kept", async () => {
    await photos("Day 1 7-31");
    await photos("Otakon");
    await settle();
    const [otakon, old] = [(await album("Otakon")).path, (await album("Day 1 7-31")).path];
    await call("update", { folder: "Otakon", order: ["2.jpg"] });
    expect(await call("move", { folder: "Day 1 7-31", parent: "Otakon" })).toEqual({ status: 200, folder: "Otakon/Day 1 7-31" });
    expect(await album("Otakon/Day 1 7-31")).toMatchObject({ path: `${otakon}/${old}`, parent: "Otakon", count: 5 });
    expect(yaml("Otakon/Day 1 7-31")).toContain(`was:\n  - ${old}\n`);
    for (const parent of ["Otakon", "Otakon/Day 1 7-31"]) expect((await call("move", { folder: "Otakon", parent })).status).toBe(400);
    for (const parent of ["Nope", "_unsorted", "..", undefined]) expect((await call("move", { folder: "Otakon", parent })).status).toBe(404);
    await call("update", { folder: "Otakon", order: ["Day 1 7-31", "2.jpg"] });
    expect(await call("move", { folder: "Otakon/Day 1 7-31", parent: "" })).toEqual({ status: 200, folder: "Day 1 7-31" });
    expect([(await album("Day 1 7-31")).path, (await album("Otakon")).order]).toEqual([old, ["2.jpg"]]);
    expect((await call("create", { title: "Shoot", parent: "Otakon" })).status).toBe(200);
    expect((await call("move", { folder: "Shoot", parent: "Otakon" })).status).toBe(409);
    await quiet();
  });

  it("sets the date and the order, cover first, and takes them out", async () => {
    await photos("Bash");
    await settle();
    expect((await call("update", { folder: "Bash", date: "2019-03-04", order: ["4.jpg", "2.jpg"] })).status).toBe(200);
    expect(await album("Bash")).toMatchObject({ date: "2019-03-04", dateSet: "2019-03-04", year: 2019, order: ["4.jpg", "2.jpg"], cover: ["4.jpg", "2.jpg", "1.jpg"].map((name) => idOf(`Bash/${name}`)) });
    expect(yaml("Bash")).toMatch(/date: 2019-03-04\norder:\n  - 4\.jpg\n  - 2\.jpg\n/);
    await quiet();
    await call("update", { folder: "Bash", date: null });
    expect([(await album("Bash")).dateSet, (await album("Bash")).order]).toEqual([null, ["4.jpg", "2.jpg"]]);
    await call("update", { folder: "Bash", order: [] });
    expect(yaml("Bash")).not.toMatch(/^(date|order):/m);
    for (const bad of [{ date: "March" }, { date: 2019 }, { date: ["2019-03-04"] }, { order: "x" }, { order: ["a/b"] }, { order: [1] }, { order: [""] }]) expect([bad, (await call("update", { folder: "Bash", ...bad })).status]).toEqual([bad, 400]);
  });

  it("won't replace an album.yaml it can't read", async () => {
    await settle();
    writeFileSync(join(root, "Shoot/album.yaml"), "date: [\n");
    await settle();
    expect(await call("update", { folder: "Shoot", date: "2019-03-04" })).toMatchObject({ status: 409, error: { message: expect.stringContaining("Shoot/album.yaml") } });
    expect([yaml("Shoot"), (await album("Shoot")).broken]).toEqual(["date: [\n", expect.any(String)]);
  });

  it("moves photos between albums and _unsorted, with their ids, never over another", async () => {
    await photos("Bash");
    await settle();
    await call("update", { folder: "Bash", order: ["3.jpg", "1.jpg"] });
    const ids = [idOf("Bash/1.jpg"), idOf("Bash/2.jpg")];
    writeFileSync(join(root, "Shoot/1.jpg"), "not a photo yet");
    const move = async (body: object) => (await post("/v1/photos/move", body)).json();
    expect(await move({ ids: [...ids, "nope"], folder: "Shoot" })).toEqual({ moved: { [ids[0]]: "moved", [ids[1]]: "moved", nope: "not_found" } });
    expect(ids.map((id) => watcher.index.photos[id].path)).toEqual(["Shoot/1-2.jpg", "Shoot/2.jpg"]);
    expect([readFileSync(join(root, "Shoot/1.jpg"), "utf8"), (await album("Bash")).order, filesIn("Bash")]).toEqual(["not a photo yet", ["3.jpg"], ["3.jpg", "4.jpg", "5.jpg"]]);
    expect(await move({ ids, folder: "_unsorted" })).toEqual({ moved: { [ids[0]]: "moved", [ids[1]]: "moved" } });
    expect(filesIn("_unsorted")).toEqual(["1-2.jpg", "2.jpg"]);
    await quiet();
    for (const folder of ["Nope", "..", "_site", "", null]) expect((await post("/v1/photos/move", { ids, folder })).status).toBe(404);
    for (const bad of [[], "x"]) expect((await post("/v1/photos/move", { ids: bad, folder: "Shoot" })).status).toBe(400);
  });

  it("removes an album and keeps everything in it", async () => {
    await photos("Con");
    await photos("Con/Day 1");
    await photos("Con/_extras", 1);
    await photos("Day 1", 1);
    writeFileSync(join(root, "Con/notes.psd"), "mine");
    writeFileSync(join(root, "Con/.DS_Store"), "x");
    mkdirSync(join(root, "_unsorted"));
    writeFileSync(join(root, "_unsorted/1.jpg"), await jpeg("white"));
    await settle();
    const ids = Object.keys(watcher.index.photos).sort();
    const [one, deep, trashed, link] = [idOf("Con/1.jpg"), idOf("Con/Day 1/1.jpg"), idOf("Con/5.jpg"), (await album("Con/Day 1")).path];
    await post("/v1/delete", { ids: [trashed] });
    expect(await call("remove", { folder: "Con" })).toEqual({ status: 200, photos: 4, albums: 1 });
    expect([existsSync(join(root, "Con")), filesIn("_unsorted"), filesIn("Day 1 2"), filesIn("_extras")]).toEqual([false, ["1-2.jpg", "1.jpg", "2.jpg", "3.jpg", "4.jpg", "notes.psd"], ["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.jpg"], ["1.jpg"]]);
    expect([watcher.index.photos[one].path, watcher.index.photos[deep].path, Object.keys(watcher.index.photos).sort()]).toEqual(["_unsorted/1-2.jpg", "Day 1 2/1.jpg", ids]);
    expect([(await list()).map(({ folder }) => folder).sort(), yaml("Day 1 2")]).toEqual([["Day 1", "Day 1 2", "Shoot"], expect.stringContaining(`- ${link}`)]);
    expect((await (await post("/v1/restore", { ids: [trashed] })).json()).restored).toEqual({ [trashed]: "restored" });
    expect(watcher.index.photos[trashed].path).toBe("_unsorted/5.jpg");
    await quiet();
    // album.yaml and hidden files wait in the trash with the folder, then go.
    expect(filesIn(TRASH).filter((name) => name.endsWith("-album-Con"))).toHaveLength(1);
    await emptyTrash(root, time + 31 * 86_400_000);
    expect(filesIn(TRASH)).toEqual([]);
    expect((await call("remove", { folder: "Con" })).status).toBe(404);
  });

  it("refuses to act outside Published's albums", async () => {
    for (const folder of ["..", ".", "", "_unsorted", "_site", ".site", "Shoot/..", "/etc", null, 1, "__proto__"]) {
      for (const op of ["rename", "move", "update", "remove"]) expect([folder, op, (await call(op, { folder, title: "x", parent: "" })).status]).toEqual([folder, op, 404]);
    }
    expect((await post("/v1/albums/remove", { folder: "Shoot" }, {})).status).toBe(401);
    expect(filesIn("Shoot")).toEqual(["a.jpg", "b.jpg"]);
  });

  it("confirms only the removal that was shown", async () => {
    expect((await post("/v1/confirm-removal", { key: "x" })).status).toBe(409);
    const index: any = structuredClone(watcher.index);
    for (let i = 0; i < 100; i++) index.photos[`p${i}`] = { path: `Big/${i}.jpg`, kind: "photo", sig: "1:1", hash: `h${i}`, version: `h${i}`, bytes: 999, createdAt: "2026-01-01T00:00:00Z" };
    await watcher.mutate((live: any) => void Object.assign(live, index));
    await settle();
    const status = async () => (await fetch(`${base}/v1/status`, { headers: auth })).json();
    const { blocked } = await status();
    expect(blocked).toEqual({ missing: 100, folders: [{ folder: "Big", count: 100 }], key: expect.any(String) });
    expect((await post("/v1/confirm-removal", { key: `${blocked.key}x` })).status).toBe(409);
    expect((await status()).photos).toBe(102);
    expect(await (await post("/v1/confirm-removal", { key: blocked.key })).json()).toEqual({ confirmed: 100 });
    expect(await status()).toMatchObject({ ok: true, photos: 2, blocked: null });
  });
});

describe("uploads", () => {
  it("publishes a photo with its tags at once, and the scan then has nothing to do", async () => {
    const res = await upload(await jpeg("red"), uploadUrl("music,sports"));
    const photo = await res.json();
    expect(photo).toMatchObject({ width: 40, height: 20, tags: ["music", "sports"], format: "jpg" });
    expect(filesIn("_unsorted")).toEqual([`${photo.public_id}.jpg`]);
    expect(warmed.length).toBe(1);
    const before = Object.keys(watcher.index.photos).sort();
    for (let i = 0; i < 2; i++) expect((await scanNow()).events).toEqual([]);
    expect(Object.keys(watcher.index.photos).sort()).toEqual(before);
  });

  it("puts a photo in its album's folder under its own name, next to one that has it", async () => {
    const first = await (await upload(await jpeg("red"), uploadTo("Shoot", "a.JPEG"))).json();
    expect(first).toMatchObject({ folder: "Shoot", filename: "a-2.jpg" });
    const second = await (await upload(await jpeg("pink"), uploadTo("New Shoot 11-23", "DSC 01 (edit).jpg"))).json();
    expect([second.folder, filesIn("New Shoot 11-23")]).toEqual(["New Shoot 11-23", ["DSC 01 (edit).jpg"]]);
    expect(filesIn("Shoot")).toEqual(["a-2.jpg", "a.jpg", "b.jpg"]);
    for (let i = 0; i < 2; i++) expect((await scanNow()).events).toEqual([]);
  });

  it("keeps uploads inside Published", async () => {
    for (const bad of ["..", "../x", "a/../b", "a//b", "/a", "a/", "a/_x", "A/album.yaml", "x.part", "_site", ".site", "@eaDir", "#recycle", "a\\b", " x", "x ", "x.", "a\u0000b", "x".repeat(101)]) {
      expect([bad, uploadFolder(bad)]).toEqual([bad, null]);
    }
    expect(["", "_unsorted", "St. Patrick's Day 2025 - Ginger Run 3-15", "Otakon 2026/Day 1"].map(uploadFolder)).toEqual(["_unsorted", "_unsorted", "St. Patrick's Day 2025 - Ginger Run 3-15", "Otakon 2026/Day 1"]);
    expect(["../../etc/passwd.jpg", ".hidden.jpg", "~tmp.jpg", "a/b.jpg", "Müller 1.jpg", "...", "x\n.jpg"].map(uploadName)).toEqual(["etc_passwd", "hidden", "tmp", "a_b", "Müller 1", "", "x_"]);
    const res = await upload(await jpeg("red"), uploadTo("../escape", "x.jpg"));
    expect([res.status, existsSync(join(dir, "escape"))]).toEqual([400, false]);
    // The folder and name are part of what was signed.
    expect((await upload(await jpeg("red"), `${uploadTo("Shoot", "x.jpg").replace("Shoot", "Other")}`)).status).toBe(401);
    const odd = await (await upload(await jpeg("red"), uploadTo("Shoot", "../../evil.jpg"))).json();
    expect([odd.folder, odd.filename]).toEqual(["Shoot", "evil.jpg"]);
  });

  it("refuses a photo that's already published, and what isn't a photo", async () => {
    const twin = await upload(await jpeg("blue"));
    expect([twin.status, (await twin.json()).error.message]).toEqual([409, "That photo is already published (Shoot/a.jpg)"]);
    for (const file of [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='9' height='9'/>"), Buffer.from("no"), null]) expect([415, 400]).toContain((await upload(file)).status);
    expect((await upload(Buffer.alloc(17 * 1024 * 1024))).status).toBe(413);
    expect(filesIn("_unsorted")).toEqual([]);
  });

  it("takes every one of many at once, failures in between included", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, async (_, i) => upload(i % 4 ? await jpeg("red", 41 + i) : Buffer.from("no"))));
    expect(results.map((res) => res.status)).toEqual(results.map((_, i) => (i % 4 ? 200 : 415)));
    expect([filesIn("_unsorted").length, Object.keys(watcher.index.photos).length]).toEqual([9, 11]);
    expect((await upload(await jpeg("red", 99))).status).toBe(200);
    expect(filesIn("_unsorted").some((name) => name.startsWith("."))).toBe(false);
  });

  it("makes a third upload wait for two slow ones, and frees their places when they hang up", async () => {
    const slow = Array.from({ length: 2 }, () => {
      const socket = connect(Number(new URL(base).port), "127.0.0.1");
      socket.write(`POST ${uploadUrl()} HTTP/1.1\r\nHost: x\r\nContent-Type: multipart/form-data; boundary=b\r\nContent-Length: 15000000\r\n\r\n--b\r\n`);
      return socket;
    });
    await new Promise((done) => setTimeout(done, 100));
    let status = 0;
    const third = jpeg("red").then((file) => upload(file)).then((res) => (status = res.status));
    await new Promise((done) => setTimeout(done, 200));
    expect(status).toBe(0);
    for (const socket of slow) socket.destroy();
    expect(await third).toBe(200);
  });

  it("works alongside a scan without losing either's change", async () => {
    writeFileSync(join(root, "Shoot/c.jpg"), await jpeg("yellow"));
    await watcher.tick();
    const [, photo] = await Promise.all([watcher.tick(), upload(await jpeg("red")).then((res) => res.json())]);
    expect(idOf("Shoot/c.jpg")).toBeDefined();
    expect(watcher.index.photos[photo.public_id]).toBeDefined();
    expect(Object.keys(loadIndex(join(dir, "index.json"))!.photos)).toHaveLength(4);
  });

  it("adds and replaces site images by id, whatever their type", async () => {
    const send = (file: Buffer, public_id: string) => fetch(`${base}/v1/site-image`, { method: "POST", headers: auth, body: form(file, { public_id }) });
    const first = await (await send(await jpeg("red"), "site/projects/x/cover")).json();
    expect(first).toMatchObject({ public_id: "site/projects/x/cover", format: "jpg", folder: "site/projects/x" });
    const png = await sharp({ create: { width: 9, height: 9, channels: 4, background: "#0000" } }).png().toBuffer();
    const second = await (await send(png, "site/projects/x/cover")).json();
    expect([second.format, second.secure_url === first.secure_url]).toEqual(["png", false]);
    expect([filesIn("_site/projects/x"), filesIn(TRASH).length]).toEqual([["cover.png"], 1]);
    for (let i = 0; i < 2; i++) expect((await scanNow()).events).toEqual([]);
    const { resources } = await (await fetch(`${base}/v1/site-images`, { headers: auth })).json();
    expect(resources.map(({ public_id }: any) => public_id)).toEqual(["site/projects/x/cover"]);
    for (const id of ["x", "site/x", "site/../x/y", "site/a/../../b", "site/a/.hidden", "site/a//b", "/site/a/b"]) expect((await send(png, id)).status, id).toBe(400);
  });

  it("reports a failure without publishing anything", async () => {
    rmSync(join(root, "_unsorted"), { recursive: true, force: true });
    writeFileSync(join(root, "_unsorted"), "in the way");
    const res = await upload(await jpeg("red"));
    expect([res.status, (await res.json()).error.message]).toEqual([500, "The photo service failed; nothing was confirmed"]);
    expect(Object.keys(watcher.index.photos)).toHaveLength(2);
    rmSync(join(root, "_unsorted"));
    expect((await upload(await jpeg("red"))).status).toBe(200);
  });
});
