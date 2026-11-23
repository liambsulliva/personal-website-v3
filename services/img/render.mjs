import sharp from "sharp";

// One thread per job and no pixel cache: jobs are the unit of parallelism
// (server.mjs runs two), and 4 GB is shared with the site and its builds.
sharp.cache(false);
sharp.concurrency(1);

/**
 * `input` (a path or buffer) rendered to `spec` (transforms.mjs). Upright,
 * sRGB, and with no metadata: sharp drops EXIF, XMP, IPTC and GPS unless asked
 * to keep them, and nothing here asks.
 */
export async function render(input, spec) {
  const image = sharp(input, { failOn: "error", limitInputPixels: 120e6, animated: spec.animated === true });
  image.autoOrient().toColourspace("srgb");
  const { crop, gravity, width, height } = spec;
  if (crop === "fill") {
    if (gravity === "upper") {
      const full = Math.max(height, Math.round((width * spec.natural.height) / spec.natural.width));
      image.resize({ width, height: full, fit: "fill" }).extract({ left: 0, top: Math.round((full - height) * 0.2), width, height });
    } else {
      image.resize({ width, height, fit: "cover", position: gravity === "auto" ? sharp.strategy.attention : "centre" });
    }
  } else if (crop === "pad") {
    image.resize({ width, height, fit: "contain", withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } });
  } else {
    image.resize({ width, withoutEnlargement: true });
  }
  if (spec.blur) image.blur(6);
  if (spec.format === "jpeg") image.flatten({ background: "#fff" }).jpeg({ quality: spec.quality, mozjpeg: false });
  else if (spec.format === "png") image.png();
  else image.webp({ quality: spec.quality, effort: 4 });
  return image.toBuffer();
}

export const CONTENT_TYPES = { webp: "image/webp", jpeg: "image/jpeg", png: "image/png" };
