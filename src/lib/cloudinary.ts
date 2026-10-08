import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import bundled from "../data/cloudinary-manifest.json";

/**
 * Cloudinary delivery URLs for site imagery (public_id under site/…, see
 * scripts/cloudinary-map.mjs). Every URL is f_auto,q_auto. Fixed slots use
 * c_fill + g_auto (smart crop); free-aspect figures use c_limit.
 *
 * CldImage skips ids that aren't in this file. The CMS writes new covers
 * here on upload so `npm run cloudinary:seed` isn't required for dashboard
 * imagery. Vitest re-reads the file from disk so a contract case that
 * stages the manifest is what CldImage sees.
 */

export const CLOUD_NAME: string =
  import.meta.env.CLOUDINARY_CLOUD_NAME ?? import.meta.env.PUBLIC_CLOUDINARY_CLOUD_NAME ?? "";

const BASE = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload`;

export type Crop = "fill" | "limit";

export type CldOptions = {
  width?: number;
  /** "16:9", "4:5", … (fill only) */
  aspect?: string;
  crop?: Crop;
  gravity?: "auto" | "auto:subject" | "face" | "center";
  quality?: string;
  blur?: number;
};

type Sizes = Record<string, { width: number; height: number }>;
const bundledSizes = bundled as Sizes;
const MANIFEST_FILE = fileURLToPath(new URL("../data/cloudinary-manifest.json", import.meta.url));

function sizes(): Sizes {
  if (typeof process !== "undefined" && (process.env.CMS_CASES || process.env.VITEST)) {
    try {
      return JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as Sizes;
    } catch {
      return bundledSizes;
    }
  }
  return bundledSizes;
}

export const assetSize = (id: string) => sizes()[id];

/** Ratio as "w / h" for CSS aspect-ratio. */
export const assetRatio = (id: string, fallback = "16 / 9") => {
  const size = sizes()[id];
  return size ? `${size.width} / ${size.height}` : fallback;
};

export function cldTransform({
  width,
  aspect,
  crop = aspect ? "fill" : "limit",
  gravity = "auto",
  quality = "auto",
  blur,
}: CldOptions = {}) {
  const parts = ["f_auto", `q_${quality}`, `c_${crop}`];
  if (crop === "fill") parts.push(`g_${gravity}`);
  if (aspect) parts.push(`ar_${aspect}`);
  if (width) parts.push(`w_${Math.round(width)}`);
  const chain = [parts.join(",")];
  if (blur) chain.push(`e_blur:${blur}`);
  return chain.join("/");
}

export const cldUrl = (id: string, options: CldOptions = {}) =>
  `${BASE}/${cldTransform(options)}/${id}`;

/** Re-transform a full secure_url from the API (photography). */
export const cldFromSecureUrl = (secureUrl: string, options: CldOptions = {}) =>
  secureUrl.replace("/upload/", `/upload/${cldTransform(options)}/`);

export const DEFAULT_WIDTHS = [320, 480, 640, 800, 960, 1200, 1600, 2000];

export function cldSrcSet(id: string, options: CldOptions = {}, widths = DEFAULT_WIDTHS) {
  const max = sizes()[id]?.width;
  const usable = max ? widths.filter((w) => w <= max) : widths;
  const list = usable.length ? usable : [max ?? widths[0]];
  if (max && options.crop !== "fill" && !list.includes(max) && max < widths[widths.length - 1]) {
    list.push(max);
  }
  return list.map((w) => `${cldUrl(id, { ...options, width: w })} ${w}w`).join(", ");
}

/** Tiny blurred LQIP painted behind the real image (progressive upscale). */
export const cldPlaceholder = (id: string, options: CldOptions = {}) =>
  cldUrl(id, { ...options, width: 48, quality: "auto:low", blur: 600 });

/** react-photo-album photos (with srcSet) for Cloudinary site assets. */
export function albumPhotos(items: { id: string; alt: string }[], widths = [480, 768, 1200, 1600]) {
  return items.map(({ id, alt }) => {
    const size = sizes()[id] ?? { width: 1600, height: 900 };
    const usable = widths.filter((w) => w < size.width);
    const list = [...usable, Math.min(size.width, widths[widths.length - 1])];
    return {
      src: cldUrl(id, { width: list[0] }),
      width: size.width,
      height: size.height,
      alt,
      srcSet: list.map((w) => ({
        src: cldUrl(id, { width: w }),
        width: w,
        height: Math.round((w / size.width) * size.height),
      })),
    };
  });
}
