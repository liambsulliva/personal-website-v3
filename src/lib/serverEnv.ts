// Server configuration, declared in astro.config.mjs `env.schema`.
//
// Why not `import.meta.env`: in a build, Astro compiles `import.meta.env.X`
// to a literal when X comes from a .env file (the secret ends up in dist/),
// to `process.env.X` when X is in the build's environment, and to nothing
// when X is absent, so an image built without secrets could never read them
// at runtime. astro:env secrets are always read from the environment the
// server runs in.
//
// Under Vitest, astro:env is a snapshot taken when the module first loads, so
// a test's vi.stubEnv would never reach it. Tests read the live process.env.
import { PHOTO_INDEX_FILE, RAWG_API_KEY } from "astro:env/server";

const testEnv = typeof process !== "undefined" && process.env.VITEST ? process.env : undefined;

const read = (key: string, value: string | undefined) =>
  (testEnv ? testEnv[key] : value)?.trim() || undefined;

/** The photo index the `photos` service writes (lib/photoIndex). */
export const photoIndexFile = () => read("PHOTO_INDEX_FILE", PHOTO_INDEX_FILE) ?? "/index/index.json";
export const rawgApiKey = () => read("RAWG_API_KEY", RAWG_API_KEY);
