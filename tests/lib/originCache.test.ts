import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cached, clearOriginCache, FRESH_MS, MAX_ENTRIES, RETRY_MS, STALE_MS } from "../../src/lib/originCache";

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
