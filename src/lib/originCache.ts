// In-memory cache for the upstream call an SSR page makes at request time (the
// Berlin WordPress feed). It bounds upstream calls at the origin whatever the
// CDN does:
//
// - a result is fresh for FRESH_MS; concurrent misses share one call;
// - after that it is served stale while one background refresh runs;
// - a failed refresh keeps the last good result (retried after RETRY_MS), so a
//   bad minute upstream doesn't blank the page, for up to STALE_MS;
// - failures are never cached, and at most MAX_ENTRIES keys are kept (keys
//   come from query strings, so they must be bounded).
//
// Callers get the cached object itself: treat results as read-only.

/** For a page whose upstream is cached here. */
export const PUBLIC_CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=86400";

export const FRESH_MS = 300_000; // the routes' s-maxage
export const RETRY_MS = 30_000;
export const STALE_MS = 86_400_000; // the routes' stale-while-revalidate
export const MAX_ENTRIES = 300;

type Entry<T> = {
  value?: T;
  /** When `value` was fetched. */
  at: number;
  /** No refresh before this, after a failed one. */
  retryAt: number;
  pending?: Promise<T>;
};

const caches = new Set<Map<string, Entry<unknown>>>();

/** Forget every cached result (tests). */
export function clearOriginCache() {
  for (const entries of caches) entries.clear();
}

/**
 * `fn` with its results cached by `key(...args)`. Only results for which
 * `keep` is true are stored; anything else (or a throw) is returned to the
 * caller as is, unless there is an earlier good result to fall back on.
 */
export function cached<A extends unknown[], T>(
  fn: (...args: A) => Promise<T>,
  { key, keep }: { key: (...args: A) => string; keep: (value: T) => boolean },
): (...args: A) => Promise<T> {
  const entries = new Map<string, Entry<T>>();
  caches.add(entries as Map<string, Entry<unknown>>);

  const store = (id: string, entry: Entry<T>) => {
    entries.delete(id);
    entries.set(id, entry);
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  };

  /** One upstream call for `id`, shared by everyone who asks meanwhile. */
  const load = (id: string, args: A, entry: Entry<T> | undefined): Promise<T> => {
    // The body starts on a later microtask, after `pending` is assigned and
    // stored, even if `fn` throws synchronously.
    const pending: Promise<T> = Promise.resolve().then(async () => {
      try {
        const value = await fn(...args);
        if (keep(value)) {
          store(id, { value, at: Date.now(), retryAt: 0 });
          return value;
        }
        if (entry && "value" in entry) {
          entry.retryAt = Date.now() + RETRY_MS;
          return entry.value as T;
        }
        return value;
      } catch (error) {
        if (entry && "value" in entry) {
          entry.retryAt = Date.now() + RETRY_MS;
          return entry.value as T;
        }
        throw error;
      } finally {
        const current = entries.get(id);
        if (current?.pending === pending) delete current.pending;
        if (current && !("value" in current)) entries.delete(id);
      }
    });
    if (entry) entry.pending = pending;
    else store(id, { at: 0, retryAt: 0, pending });
    return pending;
  };

  return (...args: A) => {
    const id = key(...args);
    const now = Date.now();
    const entry = entries.get(id);
    if (entry && "value" in entry && now - entry.at < STALE_MS) {
      const stale = now - entry.at >= FRESH_MS;
      if (stale && !entry.pending && now >= entry.retryAt) {
        load(id, args, entry).catch(() => {});
      }
      return Promise.resolve(entry.value as T);
    }
    if (entry?.pending) return entry.pending;
    // Nothing cached, or older than STALE_MS: too old to fall back on.
    return load(id, args, undefined);
  };
}
