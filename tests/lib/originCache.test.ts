import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cached, clearOriginCache, FRESH_MS, MAX_ENTRIES, RETRY_MS, STALE_MS } from "../../src/lib/originCache";
import { searchAlbumPhotos, searchAllPhotos, searchPhotos } from "../../src/lib/cloudinaryServer";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearOriginCache();
});

type Result = { ok: boolean; n: number };
/** An upstream that counts its calls and answers from `answer`. */
function upstream(answer: (call: number) => Result | Promise<Result>) {
  let calls = 0;
  const fn = vi.fn(async (_id: string) => answer(++calls));
  const get = cached(fn, { key: (id) => id, keep: (r) => r.ok });
  return { fn, get };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("cached (origin cache for upstream calls)", () => {
  it("answers from the cache while fresh", async () => {
    const { fn, get } = upstream((n) => ({ ok: true, n }));
    expect(await get("a")).toEqual({ ok: true, n: 1 });
    vi.advanceTimersByTime(FRESH_MS - 1);
    expect(await get("a")).toEqual({ ok: true, n: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    await get("b");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("shares one upstream call between concurrent misses", async () => {
    const { fn, get } = upstream(async (n) => ({ ok: true, n }));
    const results = await Promise.all([get("a"), get("a"), get("a")]);
    expect(results.map((r) => r.n)).toEqual([1, 1, 1]);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("serves stale while exactly one refresh runs, then the refreshed value", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { fn, get } = upstream(async (n) => {
      if (n === 2) await gate;
      return { ok: true, n };
    });
    await get("a");
    vi.advanceTimersByTime(FRESH_MS);
    expect((await get("a")).n).toBe(1);
    expect((await get("a")).n).toBe(1);
    expect(fn).toHaveBeenCalledTimes(2);
    release();
    await settle();
    expect((await get("a")).n).toBe(2);
  });

  it("keeps the last good value when a refresh fails, and retries later", async () => {
    const { fn, get } = upstream((n) => ({ ok: n === 1 || n === 3, n }));
    await get("a");
    vi.advanceTimersByTime(FRESH_MS);
    expect((await get("a")).n).toBe(1);
    await settle();
    expect((await get("a")).n).toBe(1);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(RETRY_MS);
    await get("a");
    await settle();
    expect((await get("a")).n).toBe(3);
  });

  it("also falls back when the refresh throws", async () => {
    const { get } = upstream((n) => {
      if (n === 2) throw new Error("down");
      return { ok: true, n };
    });
    await get("a");
    vi.advanceTimersByTime(FRESH_MS);
    await get("a");
    await settle();
    expect((await get("a")).n).toBe(1);
  });

  it("recovers after an upstream that throws synchronously", async () => {
    let calls = 0;
    const get = cached(
      ((id: string) => {
        if (++calls === 1) throw new Error("sync");
        return Promise.resolve({ ok: true, n: calls, id });
      }) as (id: string) => Promise<{ ok: boolean; n: number; id: string }>,
      { key: (id) => id, keep: (r) => r.ok },
    );
    await expect(get("a")).rejects.toThrow("sync");
    expect((await get("a")).n).toBe(2);
  });

  it("never caches a failure", async () => {
    const { fn, get } = upstream((n) => ({ ok: n > 1, n }));
    expect(await get("a")).toEqual({ ok: false, n: 1 });
    expect(await get("a")).toEqual({ ok: true, n: 2 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("stops serving a value older than STALE_MS", async () => {
    const { get } = upstream((n) => ({ ok: n === 1, n }));
    await get("a");
    vi.advanceTimersByTime(STALE_MS);
    expect(await get("a")).toEqual({ ok: false, n: 2 });
  });

  it(`keeps at most ${MAX_ENTRIES} keys`, async () => {
    const { fn, get } = upstream((n) => ({ ok: true, n }));
    for (let i = 0; i <= MAX_ENTRIES; i++) await get(`k${i}`);
    expect(fn).toHaveBeenCalledTimes(MAX_ENTRIES + 1);
    await get(`k${MAX_ENTRIES}`);
    expect(fn).toHaveBeenCalledTimes(MAX_ENTRIES + 1);
    await get("k0");
    expect(fn).toHaveBeenCalledTimes(MAX_ENTRIES + 2);
  });
});

describe("Cloudinary reads go through the cache", () => {
  const photo = (public_id: string) => ({ public_id, secure_url: `https://x/${public_id}`, width: 1, height: 1, tags: ["music"] });
  beforeEach(() => {
    vi.stubEnv("CLOUDINARY_CLOUD_NAME", "demo");
    vi.stubEnv("CLOUDINARY_API_KEY", "key");
    vi.stubEnv("CLOUDINARY_API_SECRET", "secret");
  });

  it("makes one Search call per distinct query per window", async () => {
    const fetch = vi.fn(async () => Response.json({ resources: [photo("b"), photo("a")] }));
    vi.stubGlobal("fetch", fetch);
    await searchAllPhotos("resource_type:image");
    await searchAllPhotos("resource_type:image");
    await searchPhotos({ expression: "resource_type:image AND tags=music", max_results: 20 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not cache an error from Cloudinary", async () => {
    const fetch = vi.fn(async () => Response.json({ error: { message: "rate limited" } }, { status: 420 }));
    vi.stubGlobal("fetch", fetch);
    expect((await searchAllPhotos("resource_type:image")).ok).toBe(false);
    expect((await searchAllPhotos("resource_type:image")).ok).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("opens every album for the All pool's one search", async () => {
    const fetch = vi.fn(async () => Response.json({ resources: [photo("c"), photo("b"), photo("a")] }));
    vi.stubGlobal("fetch", fetch);
    expect((await searchAlbumPhotos(["a", "c"])).resources.map((r) => r.public_id)).toEqual(["a", "c"]);
    expect((await searchAlbumPhotos(["b"])).resources.map((r) => r.public_id)).toEqual(["b"]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("searches for an album's photos when the All pool doesn't have them all", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      Response.json({ resources: String(init?.body).includes("public_id=") ? [photo("new"), photo("a")] : [photo("a")] }),
    );
    vi.stubGlobal("fetch", fetch);
    expect((await searchAlbumPhotos(["a", "new"])).resources.map((r) => r.public_id)).toEqual(["a", "new"]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("orders an album without reordering the shared cached result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ resources: [photo("b"), photo("a")] })));
    const album = await searchAlbumPhotos(["a", "b"]);
    expect(album.resources.map((r) => r.public_id)).toEqual(["a", "b"]);
    const again = await searchAllPhotos('resource_type:image AND (public_id="a" OR public_id="b")');
    expect(again.resources.map((r) => r.public_id)).toEqual(["b", "a"]);
  });
});
