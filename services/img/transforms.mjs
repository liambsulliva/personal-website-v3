// The part of Cloudinary's URL syntax this site and cms-dashboard use,
// reduced to a bounded set of outputs.
//
//   /img/upload[/<transform>[/<transform>]][/v<version>]/<id>[.<ext>]
//
// Widths snap up to WIDTHS and crop ratios must be in RATIOS, so a photo has
// a fixed number of possible outputs: a crawler inventing sizes can't fill the
// disk or the CPU. Anything else in a transform is refused (404), not ignored.

export const WIDTHS = [48, 96, 128, 168, 240, 320, 352, 480, 560, 640, 800, 960, 1200, 1280, 1600, 1920, 2000, 2560, 3200, 3840];
/** Bump when outputs change, so the disk cache and ETags do too. */
export const PIPELINE = 1;

/** The format's limit on either side. */
const WEBP_MAX = 16383;
const RATIOS = { "1:1": [1, 1], "4:5": [4, 5], "16:9": [16, 9], "40:21": [40, 21], "15:7": [15, 7] };
const QUALITY = { auto: 78, "auto:good": 78, "auto:eco": 65, "auto:low": 40, "auto:best": 85 };
const FORMATS = { auto: "webp", webp: "webp", jpg: "jpeg", jpeg: "jpeg", png: "png" };
const GRAVITY = new Set(["auto", "auto:subject", "face", "center"]);
const KEYS = new Set(["c", "g", "w", "h", "ar", "f", "q", "e"]);
const SEGMENT = /^[a-z]{1,2}_[^,/]+(,[a-z]{1,2}_[^,/]+)*$/;
const EXTENSIONS = /\.(jpe?g|png|webp|gif|svg|tiff?)$/i;

const isTransform = (segment) => SEGMENT.test(segment) && segment.split(",").every((part) => KEYS.has(part.slice(0, part.indexOf("_"))));
const isVersion = (segment) => /^v[0-9a-f]{6,16}$/.test(segment);
const snap = (width) => WIDTHS.find((step) => step >= width) ?? WIDTHS.at(-1);
const size = (value) => (/^[1-9]\d{0,3}$/.test(value) ? Number(value) : null);

/** { id, version, transform } of a request path, or null when it isn't one we serve. */
export function parsePath(pathname) {
  if (!pathname.startsWith("/img/upload/") || pathname.length > 600) return null;
  let segments;
  try {
    segments = pathname.slice("/img/upload/".length).split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
  const chain = [];
  while (segments.length > 1 && isTransform(segments[0])) chain.push(segments.shift());
  const version = segments.length > 1 && isVersion(segments[0]) ? segments.shift().slice(1) : null;
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === ".." || /[\\\0/]/.test(segment))) return null;
  const transform = parseTransform(chain);
  return transform && { id: segments.join("/").replace(EXTENSIONS, ""), rawId: segments.join("/"), version, transform };
}

/** The options in a transform chain, or null if any part isn't supported. */
export function parseTransform(chain) {
  const out = { crop: null, gravity: "center", width: null, height: null, ratio: null, format: "webp", quality: QUALITY.auto, blur: false };
  const seen = new Set();
  for (const part of chain.flatMap((segment) => segment.split(","))) {
    const key = part.slice(0, part.indexOf("_"));
    const value = part.slice(key.length + 1);
    if (seen.has(key)) return null;
    seen.add(key);
    if (key === "c" && ["fill", "limit", "pad"].includes(value)) out.crop = value;
    else if (key === "g" && GRAVITY.has(value)) out.gravity = value.startsWith("auto") ? "auto" : value;
    else if (key === "w" && size(value)) out.width = size(value);
    else if (key === "h" && size(value)) out.height = size(value);
    else if (key === "ar" && Object.hasOwn(RATIOS, value)) out.ratio = RATIOS[value];
    else if (key === "f" && Object.hasOwn(FORMATS, value)) out.format = FORMATS[value];
    else if (key === "q" && Object.hasOwn(QUALITY, value)) out.quality = QUALITY[value];
    else if (key === "e" && value === "blur:600") out.blur = true;
    else return null;
  }
  return out;
}

/**
 * What to render for a photo of `natural` size: a canonical spec with a string
 * key. Never larger than the source. Null when the crop isn't one we serve.
 */
export function resolve(transform, natural) {
  const { crop, width, height, ratio, format, quality, blur } = transform;
  const base = { format, quality, blur };
  let spec;
  if (crop === "fill" || crop === "pad") {
    const box = ratio ?? (width && height ? allowedBox(width, height) : null);
    if (!box || (ratio && height)) return null;
    let w = snap(width ?? natural.width);
    // The largest box of this ratio inside the source: cropping never enlarges.
    const most = crop === "fill" ? Math.min(natural.width, Math.floor((natural.height * box[0]) / box[1])) : Infinity;
    w = Math.max(1, Math.min(w, most));
    const h = Math.max(1, Math.round((w * box[1]) / box[0]));
    spec = { ...base, crop, gravity: crop === "fill" ? focus(transform.gravity, natural, w, h) : "center", width: w, height: h };
  } else {
    if (ratio) return null;
    // Fit inside the box: the width decides everything else.
    let w = width ?? Math.min(natural.width, WIDTHS.at(-1));
    if (height) w = Math.min(w, Math.ceil((height * natural.width) / natural.height));
    w = Math.min(width || height ? snap(w) : w, natural.width);
    spec = { ...base, crop: "limit", gravity: "center", width: w, height: null };
  }
  const { crop: c, gravity, width: w, height: h } = spec;
  // A very tall screenshot: WebP can't hold it, so it's a JPEG, as Cloudinary did.
  const tall = (h ?? (w * natural.height) / natural.width) > WEBP_MAX;
  const kind = format === "webp" && tall ? "jpeg" : format;
  return { ...spec, format: kind, natural: { width: natural.width, height: natural.height }, key: [c, gravity, w, h ?? "", kind, quality, blur ? "blur" : ""].join(",") };
}

/**
 * Which part of the source a crop keeps. Tall photos losing height keep their
 * upper part ("upper", 20% of the way down): on 10 published portraits sharp's
 * attention crop cut several heads off, and a fixed upper crop came closest to
 * Cloudinary's g_auto.
 */
function focus(gravity, natural, w, h) {
  if (gravity === "center") return "center";
  if (natural.height > natural.width && natural.height / natural.width > h / w) return "upper";
  return gravity === "face" ? "center" : "auto";
}

/** The explicit boxes in use: square, 4:5 cards (352×440, 264×330, …), the 1200×630 Open Graph card. */
function allowedBox(width, height) {
  if (width === 1200 && height === 630) return [40, 21];
  return Object.values(RATIOS).find(([a, b]) => Math.abs(width / height - a / b) < 0.005) ?? null;
}
