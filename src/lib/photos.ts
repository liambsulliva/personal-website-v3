// Photo shaping for the photography page (server) and its islands. Ported 1:1
// from v2 commit d0baf91 (CloudinaryFetcher / CloudinaryCarousel): 480px
// placeholders, 160px width steps, v2's exact transformation strings (so the
// derived assets are shared with v2's Cloudinary cache).
import {
  PLACEHOLDER_WIDTH,
  cappedWidths,
  cloudinaryTransform,
  toSrcSet,
  widthSteps,
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

export type FeaturedSlide = {
  key: string;
  placeholderSrc: string;
  srcSet: string;
};

// ── Gallery (v2 CloudinaryFetcher) ──────────────────────────────
const PREVIEW_TRANSFORM = "c_limit,f_auto,q_auto";
const LIGHTBOX_TRANSFORM = "c_limit,f_auto,q_auto:best";
const PREVIEW_WIDTHS = widthSteps(PLACEHOLDER_WIDTH, 1280);
const PREVIEW_MAX_WIDTH = PREVIEW_WIDTHS[PREVIEW_WIDTHS.length - 1];
const LIGHTBOX_WIDTHS = [...PREVIEW_WIDTHS, ...widthSteps(1440, 3840)];

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
  const lightboxSrcSet = cappedWidths(LIGHTBOX_WIDTHS, rw).map((width) =>
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

// ── Featured carousel (v2 CloudinaryCarousel) ───────────────────
// v2 cropped 16:9; v3's Figma frame is 1312×560, so the crop ratio follows
// the frame and keeps g_auto smart cropping.
const SLIDE_WIDTHS = widthSteps(PLACEHOLDER_WIDTH, 2240);
const SLIDE_RATIO = 560 / 1312;

function slideUrl(secureUrl: string, width: number): string {
  return cloudinaryTransform(
    secureUrl,
    `c_fill,g_auto,w_${width},h_${Math.round(width * SLIDE_RATIO)},q_auto,f_auto`,
  );
}

export function toFeaturedSlide(resource: PhotoResource): FeaturedSlide {
  const maxCropWidth = Math.min(resource.width, resource.height / SLIDE_RATIO, SLIDE_WIDTHS[SLIDE_WIDTHS.length - 1]);
  const widths = cappedWidths(SLIDE_WIDTHS, maxCropWidth);
  return {
    key: resource.public_id,
    placeholderSrc: slideUrl(resource.secure_url, widths[0]),
    srcSet: toSrcSet(widths.map((width) => ({ src: slideUrl(resource.secure_url, width), width }))),
  };
}
