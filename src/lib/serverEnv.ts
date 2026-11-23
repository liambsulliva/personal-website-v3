// Server configuration, declared in astro.config.mjs `env.schema`.
//
// Why not `import.meta.env`: in a build, Astro compiles `import.meta.env.X`
// to a literal when X comes from a .env file (the secret ends up in dist/),
// to `process.env.X` when X is in the build's environment, and to nothing
// when X is absent, so an image built without secrets could never read them
// at runtime. astro:env secrets are always read from the environment the
// server runs in.
//
// All four are declared `secret`, which in astro:env means "read where the
// code runs", not inlined. CLOUDINARY_CLOUD_NAME is not really secret (it is
// in every image URL) but is needed in both places: prerendered pages read it
// from the build's environment (a Docker build argument) and SSR routes from
// the server's (the container's .env).
//
// Under Vitest, astro:env is a snapshot taken when the module first loads, so
// a test's vi.stubEnv (the CMS contract stubs the Cloudinary credentials in
// beforeAll) would never reach it. Tests read the live process.env instead.
import {
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  CLOUDINARY_CLOUD_NAME,
  IMAGE_BACKEND,
  PHOTO_INDEX_FILE,
  RAWG_API_KEY,
} from "astro:env/server";

const testEnv = typeof process !== "undefined" && process.env.VITEST ? process.env : undefined;

const read = (key: string, value: string | undefined) =>
  (testEnv ? testEnv[key] : value)?.trim() || undefined;

/** The Cloudinary cloud, for image URLs (public, it is in every one). */
export const cloudName = () =>
  read("CLOUDINARY_CLOUD_NAME", CLOUDINARY_CLOUD_NAME) ??
  // Older Vercel setups exposed it under the PUBLIC_ name only.
  import.meta.env.PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() ??
  "";

export const cloudinaryApiKey = () => read("CLOUDINARY_API_KEY", CLOUDINARY_API_KEY);
export const cloudinaryApiSecret = () => read("CLOUDINARY_API_SECRET", CLOUDINARY_API_SECRET);

/** Where images come from; anything but "nas" is Cloudinary (lib/imageBackend). */
export const imageBackend = (): "cloudinary" | "nas" => (read("IMAGE_BACKEND", IMAGE_BACKEND) === "nas" ? "nas" : "cloudinary");
export const photoIndexFile = () => read("PHOTO_INDEX_FILE", PHOTO_INDEX_FILE) ?? "/index/index.json";
export const rawgApiKey = () => read("RAWG_API_KEY", RAWG_API_KEY);
