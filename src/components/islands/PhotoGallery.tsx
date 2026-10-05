import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PhotoAlbum from "react-photo-album";
import Lightbox from "yet-another-react-lightbox";
import type { RenderSlideProps, SlideImage } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import ProgressiveImage from "./ProgressiveImage";
import TagMenu from "./TagMenu";
import Loader from "./Loader";
import { toGalleryPhoto, type GalleryPhoto, type PhotoResource } from "../../lib/photos";
import { publicCloudinarySearchUrl } from "../../lib/cloudinarySearchPolicy";
import { toSrcSet } from "../../lib/cloudinaryImage";

// Figma Chip (14:198) row + GalleryTile masonry (25:544). The first page and
// tag list arrive SSR'd; fetching only happens for the next page or a new tag.

const PAGE_SIZE = 20;
const LIGHTBOX_MIN_ZOOM_HEADROOM = 2;

// v2: the album's `sizes` describe the *container*; the album derives each
// column's size from it. Content is inset 64px (desktop) / 24px (mobile).
const ALBUM_SIZES = {
  size: "calc(100vw - 128px)",
  sizes: [{ viewport: "(max-width: 767px)", size: "calc(100vw - 48px)" }],
};

// v2 LightboxSlide: progressive slide whose `sizes` track the zoom level so
// zooming fetches a sharper candidate (never a smaller one).
function LightboxSlide({ slide, offset, rect, zoom = 1 }: RenderSlideProps & { slide: SlideImage }) {
  const naturalWidth = slide.width ?? rect.width;
  const naturalHeight = slide.height ?? rect.height;
  const fit = Math.min(rect.width / naturalWidth, rect.height / naturalHeight, 1);
  const displayWidth = Math.round(naturalWidth * fit);
  const displayHeight = Math.round(naturalHeight * fit);
  const requestedZoom = offset === 0 ? 2 ** Math.ceil(Math.log2(Math.max(zoom, LIGHTBOX_MIN_ZOOM_HEADROOM))) : 1;
  const [sizesZoom, setSizesZoom] = useState(requestedZoom);
  if (requestedZoom > sizesZoom) setSizesZoom(requestedZoom);

  return (
    <div
      className="relative squishy squishy-xl overflow-hidden"
      style={{ width: displayWidth, height: displayHeight }}
    >
      <ProgressiveImage
        placeholderSrc={slide.src}
        srcSet={toSrcSet(slide.srcSet ?? [])}
        sizes={`${displayWidth * sizesZoom}px`}
        alt={slide.alt ?? ""}
        upgrade={Math.abs(offset) <= 1}
        loading="eager"
        draggable={false}
        objectFit="fill"
      />
    </div>
  );
}

type Props = {
  tags: string[];
  initialPhotos: GalleryPhoto[];
  initialCursor: string | null;
};

const isReducedMotion = () =>
  typeof document !== "undefined" && document.documentElement.hasAttribute("data-reduced-motion");

export default function PhotoGallery({ tags, initialPhotos, initialCursor }: Props) {
  const [tag, setTag] = useState("");
  const [photos, setPhotos] = useState(initialPhotos);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [index, setIndex] = useState(-1);
  const requestRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadPage = useCallback(async (nextTag: string, nextCursor: string | null) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(
        publicCloudinarySearchUrl({
          expression: nextTag ? `resource_type:image AND tags=${nextTag}` : "resource_type:image",
          max_results: PAGE_SIZE,
          next_cursor: nextCursor,
        }),
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error(`Search responded with ${response.status}`);
      const data: { resources?: PhotoResource[]; next_cursor?: string } = await response.json();
      const page = (data.resources ?? []).map(toGalleryPhoto);
      setPhotos((previous) => (nextCursor ? [...previous, ...page] : page));
      setCursor(data.next_cursor ?? null);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error("PhotoGallery: failed to load photos", err);
      setError(true);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // Infinite scroll: only ever fetches the *next* page.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || loading || error || cursor === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadPage(tag, cursor);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, error, cursor, tag, loadPage]);

  const selectTag = (next: string) => {
    if (next === tag) return;
    setTag(next);
    setPhotos([]);
    setCursor(null);
    loadPage(next, null);
  };

  const slides = useMemo(
    () =>
      photos.map(({ src, width, height, lightboxSrcSet }) => ({
        src,
        width,
        height,
        srcSet: lightboxSrcSet,
      })),
    [photos],
  );

  const reduced = isReducedMotion();

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <TagMenu tags={tags} selected={tag} onSelect={selectTag} />

      <div className="w-full min-w-0" data-name="Gallery" aria-busy={loading}>
        {photos.length > 0 ? (
          <PhotoAlbum
            layout="masonry"
            photos={photos}
            spacing={(containerWidth) => (containerWidth < 640 ? 12 : 24)}
            columns={(containerWidth) => (containerWidth < 640 ? 2 : 3)}
            defaultContainerWidth={1312}
            sizes={ALBUM_SIZES}
            renderPhoto={({ photo, layout, wrapperStyle, imageProps: { sizes } }) => (
              <button
                type="button"
                aria-label={`Open photo ${layout.index + 1}`}
                className="gallery-tile squishy squishy-tile relative block appearance-none overflow-hidden rounded-md border-0 bg-skeleton p-0"
                style={wrapperStyle}
                onClick={() => setIndex(layout.index)}
              >
                <ProgressiveImage placeholderSrc={photo.src} srcSet={photo.previewSrcSet} sizes={sizes} alt={`Photo ${layout.index + 1}`} />
              </button>
            )}
          />
        ) : !loading && !error ? (
          <p className="m-0 py-12 text-center text-[16px] text-muted">No photos found.</p>
        ) : null}
        <div ref={sentinelRef} aria-hidden />
        {loading && <Loader />}
        {error && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="m-0 text-[16px] text-muted">Couldn't load photos.</p>
            <button
              type="button"
              onClick={() => loadPage(tag, cursor)}
              className="chip squishy squishy-md rounded-pill border border-border bg-control px-4 py-2 text-[16px] leading-[1.5] text-fg"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <Lightbox
        plugins={[Zoom]}
        index={index}
        slides={slides}
        open={index >= 0}
        close={() => setIndex(-1)}
        animation={reduced ? { fade: 0, swipe: 0, zoom: 0, navigation: 0 } : undefined}
        controller={{ closeOnBackdropClick: true }}
        render={{ slide: (props) => <LightboxSlide {...props} slide={props.slide as SlideImage} /> }}
      />
    </div>
  );
}
