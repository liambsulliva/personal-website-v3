// Photo shaping for the photography page (server) and its islands. Ported from
// v2 commit d0baf91 (CloudinaryFetcher): 480px placeholders and v2's
// transformation strings.
import {
  PLACEHOLDER_WIDTH,
  cappedWidths,
  cloudinaryTransform,
  toSrcSet,
} from "./cloudinaryImage";

export type PhotoResource = {
  public_id: string;
  secure_url: string;
  width: number;
  height: number;
};

export type ImageSource = { src: string; width: number; height: number };

export type GalleryPhoto = {
  key: string;
  src: string;
  width: number;
  height: number;
  previewSrcSet: string;
  lightboxSrcSet: ImageSource[];
};


// ── Gallery (v2 CloudinaryFetcher) ──────────────────────────────
const PREVIEW_TRANSFORM = "c_limit,f_auto,q_auto";
const LIGHTBOX_TRANSFORM = "c_limit,f_auto,q_auto:best";
// The resizer's own widths (services/img/transforms.mjs): it snaps up to
// these, so anything else would be another URL for the same bytes.
const PREVIEW_WIDTHS = [PLACEHOLDER_WIDTH, 640, 800, 960, 1200, 1280];
const PREVIEW_MAX_WIDTH = 1280;
const LIGHTBOX_MAX_WIDTH = 3840;
const LIGHTBOX_WIDTHS = [...PREVIEW_WIDTHS, 1920, 2560, LIGHTBOX_MAX_WIDTH];

function scaledSource(src: string, width: number, naturalWidth: number, naturalHeight: number): ImageSource {
  return { src, width, height: Math.round((width / naturalWidth) * naturalHeight) };
}

export function toGalleryPhoto(resource: PhotoResource): GalleryPhoto {
  const { secure_url: baseUrl, width: rw, height: rh } = resource;
  const imageUrl = (width: number, transform: string) =>
    width >= rw
      ? cloudinaryTransform(baseUrl, transform)
      : cloudinaryTransform(baseUrl, `${transform},w_${width}`);
  const previewWidths = cappedWidths(PREVIEW_WIDTHS, Math.min(rw, PREVIEW_MAX_WIDTH));
  const lightboxSrcSet = cappedWidths(LIGHTBOX_WIDTHS, Math.min(rw, LIGHTBOX_MAX_WIDTH)).map((width) =>
    scaledSource(imageUrl(width, width > PREVIEW_MAX_WIDTH ? LIGHTBOX_TRANSFORM : PREVIEW_TRANSFORM), width, rw, rh),
  );

  return {
    key: resource.public_id,
    src: imageUrl(previewWidths[0], PREVIEW_TRANSFORM),
    width: rw,
    height: rh,
    previewSrcSet: toSrcSet(previewWidths.map((width) => ({ src: imageUrl(width, PREVIEW_TRANSFORM), width }))),
    lightboxSrcSet,
  };
}

/** A shuffled copy (Fisher–Yates). A tag chip shows a random set of its
 *  photos, so tags that share photos don't all open on the same newest ones. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
