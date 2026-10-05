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
import {
  CORRECT_MS,
  EASE_OUT,
  FADE_MS,
  LIGHTBOX_PADDING,
  TILE_RADIUS,
  allFinished,
  alphaOf,
  bestLoadedSrc,
  boxOf,
  createFlyer,
  exitToward,
  decodeWithin,
  fitSlide,
  fly,
  inViewport,
  lightboxTargetBox,
  loadedWithin,
  mark,
  placeFlyer,
  pressPulse,
  sameBox,
  whenFrame,
} from "./lightboxFlight";

// Figma Chip (14:198) row + GalleryTile masonry (25:544). The first page and
// tag list arrive SSR'd; fetching only happens for the next page or a new tag.

const PAGE_SIZE = 20;
const LIGHTBOX_MIN_ZOOM_HEADROOM = 2;

// v2: the album's `sizes` describe the *container*; the album derives each
// column's size from it. Content is inset 64px (desktop) / 24px (mobile) and
// clamped to 1144px by SubpageLayout's 1272px <main>.
const ALBUM_SIZES = {
  size: "min(calc(100vw - 128px), 1144px)",
  sizes: [{ viewport: "(max-width: 767px)", size: "calc(100vw - 48px)" }],
};

// v2 LightboxSlide: progressive slide whose `sizes` track the zoom level so
// zooming fetches a sharper candidate (never a smaller one). `handoffSrc` is the
// flyer's image: the slide shows it opaque on its first frame so the flyer can
// be removed without a visible swap.
function LightboxSlide({
  slide,
  offset,
  rect,
  zoom = 1,
  handoffSrc,
}: RenderSlideProps & { slide: SlideImage; handoffSrc?: string }) {
  const { width: displayWidth, height: displayHeight } = fitSlide(
    slide.width ?? rect.width,
    slide.height ?? rect.height,
    rect,
  );
  const requestedZoom = offset === 0 ? 2 ** Math.ceil(Math.log2(Math.max(zoom, LIGHTBOX_MIN_ZOOM_HEADROOM))) : 1;
  const [sizesZoom, setSizesZoom] = useState(requestedZoom);
  if (requestedZoom > sizesZoom) setSizesZoom(requestedZoom);

  return (
    <div
      className="relative squishy squishy-xl overflow-hidden"
      style={{ width: displayWidth, height: displayHeight }}
      data-lightbox-slide
    >
      <ProgressiveImage
        placeholderSrc={handoffSrc ?? slide.src}
        fadeIn={!handoffSrc}
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

const currentSlideElement = () => document.querySelector<HTMLElement>(".yarl__slide_current [data-lightbox-slide]");

const afterPaint = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

// Staged tile ↔ lightbox transition. Each phase starts when the previous one
// finishes; nothing overlaps.
//   open:  press (tile pulse) → stretch (flyer: tile rect → lightbox rect)
//          → mount (lightbox under the flyer, no backdrop) → handoff (flyer
//          removed, real slide showing) → darken (backdrop + chrome fade in
//          behind the photo, global.css) → tile restored in the grid, only
//          once the backdrop measures fully opaque
//   close: lighten (YARL portal fade under the flyer) → shrink (flyer → tile)
//          → settle (tile back; the spring's landing dip is the settle)
type FlightPhase = "press" | "stretch" | "mount" | "handoff" | "darken" | "lighten" | "shrink";
type Flight = {
  phase: FlightPhase;
  tile: HTMLElement | null;
  flyer: HTMLElement | null;
  animations: Animation[];
};

export default function PhotoGallery({ tags, initialPhotos, initialCursor }: Props) {
  const [tag, setTag] = useState("");
  const [photos, setPhotos] = useState(initialPhotos);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [index, setIndex] = useState(-1);
  const [handoff, setHandoff] = useState<{ key: string; src: string } | null>(null);
  // false from mount until the handoff: transparent backdrop, hidden chrome,
  // and no portal fade (the photo must be fully opaque at the handoff).
  const [backdrop, setBackdrop] = useState(true);
  const requestRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<Flight | null>(null);
  const viewIndexRef = useRef(-1);
  const zoomRef = useRef(1);

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

  const slidesRef = useRef(slides);
  useEffect(() => {
    slidesRef.current = slides;
  }, [slides]);

  /** Ends a flight: flyer removed and tile restored in the same task. */
  const land = useCallback((flight: Flight) => {
    if (flightRef.current === flight) flightRef.current = null;
    flight.animations.forEach((animation) => animation.cancel());
    flight.flyer?.remove();
    if (flight.tile) {
      flight.tile.style.opacity = "";
      flight.tile.style.transition = "";
    }
  }, []);

  useEffect(
    () => () => {
      if (flightRef.current) land(flightRef.current);
    },
    [land],
  );

  const tileAt = (photoIndex: number) =>
    galleryRef.current?.querySelector<HTMLElement>(`[data-photo-index="${photoIndex}"]`) ?? null;

  const show = (slideIndex: number) => {
    viewIndexRef.current = slideIndex;
    zoomRef.current = 1;
    setIndex(slideIndex);
  };

  const openPhoto = async (tile: HTMLElement, photoIndex: number) => {
    if (flightRef.current) return;
    if (isReducedMotion()) {
      show(photoIndex);
      return;
    }
    const photo = photos[photoIndex];
    const flight: Flight = { phase: "press", tile, flyer: null, animations: [] };
    flightRef.current = flight;

    // Press: acknowledge the click. The flyer's image decodes meanwhile so it
    // (and the lightbox slide that reuses it) paints on its first frame.
    mark("O1-press");
    tile.style.transition = "none"; // the WAAPI pulse replaces the CSS :active spring
    const src = bestLoadedSrc(tile) ?? photo.src;
    const press = pressPulse(tile);
    flight.animations = [press];
    await Promise.all([press.finished.catch(() => {}), decodeWithin(src, 300)]);
    if (flightRef.current !== flight) return;

    // Stretch: the photo lifts out of its tile and grows into its lightbox rect.
    mark("O2-stretch");
    flight.phase = "stretch";
    const from = boxOf(tile);
    const to = lightboxTargetBox(photo.width, photo.height);
    // opacity, not visibility: YARL restores focus to this tile on close.
    tile.style.opacity = "0";
    flight.flyer = createFlyer(src, to);
    flight.animations = fly(flight.flyer, to, from, to, { fromRadius: TILE_RADIUS });
    await allFinished(flight.animations);
    if (flightRef.current !== flight) return;

    // Mount: the lightbox opens underneath the flyer with no backdrop yet.
    const slideIndex = slidesRef.current.findIndex((slide) => slide.src === photo.src);
    if (slideIndex < 0) {
      land(flight); // the gallery changed (new tag) mid-flight
      return;
    }
    mark("O3-mount");
    flight.phase = "mount";
    setHandoff({ key: photo.src, src });
    setBackdrop(false);
    show(slideIndex);
  };

  /** Handoff done: the real slide is showing, so the backdrop can darken in.
   *  The tile stays hidden until the backdrop is fully opaque, so it never
   *  reappears in the grid while the lightbox is see-through. */
  const landOpen = async (flight: Flight) => {
    flight.animations.forEach((animation) => animation.cancel());
    flight.animations = [];
    flight.flyer?.remove();
    flight.flyer = null;
    flight.phase = "darken";
    mark("O5-darken");
    setBackdrop(true);
    await whenFrame(() => alphaOf(document.querySelector(".yarl__container"), "backgroundColor") === 1, 1000);
    if (flightRef.current !== flight) return;
    mark("O6-tile");
    land(flight);
  };

  // Handoff: the slide under the flyer is painted at the flyer's rect, so the
  // flyer can go. Corrects the flyer first if the real rect differs (resize,
  // mobile toolbars).
  const handOff = async (flight: Flight) => {
    flight.phase = "handoff";
    const slide = currentSlideElement();
    const flyer = flight.flyer;
    if (slide && flyer) {
      await loadedWithin(slide.querySelector("img"), 500);
      await afterPaint();
      if (flightRef.current !== flight) return;
      const actual = boxOf(slide);
      const current = boxOf(flyer);
      if (import.meta.env.DEV) console.debug("[lightbox] handoff", { flyer: current, slide: actual });
      if (!sameBox(current, actual)) {
        flight.animations.forEach((animation) => animation.cancel());
        placeFlyer(flyer, actual);
        flight.animations = fly(flyer, actual, current, actual, { duration: CORRECT_MS, elastic: false });
        await allFinished(flight.animations);
        if (flightRef.current !== flight) return;
      }
    }
    mark("O4-handoff");
    landOpen(flight);
  };

  // Shrink → settle: the flyer springs back into its tile, then the tile takes
  // over. If the tile is scrolled out of view (e.g. after paging through the
  // lightbox), the flyer squashes into a pill and is pulled out through the
  // viewport edge toward it instead.
  const shrink = async (flight: Flight, flyer: HTMLElement) => {
    mark("C2-shrink");
    flight.phase = "shrink";
    const from = boxOf(flyer);
    const tileBox = flight.tile ? boxOf(flight.tile) : null;
    if (tileBox && inViewport(tileBox)) {
      flight.animations = fly(flyer, from, from, tileBox, { toRadius: TILE_RADIUS });
    } else {
      const exit = exitToward(tileBox, from);
      flight.animations = fly(flyer, from, from, exit, { toRadius: exit.height / 2 });
    }
    await allFinished(flight.animations);
    if (flightRef.current !== flight) return;
    mark("C3-settle");
    land(flight);
  };

  /** Navigating or zooming while the flyer still covers the slide: hand off now. */
  const interruptOpen = () => {
    const flight = flightRef.current;
    if (flight && (flight.phase === "mount" || flight.phase === "handoff")) landOpen(flight);
  };

  const lightboxOn = {
    entered: () => {
      const flight = flightRef.current;
      if (flight?.phase === "mount") handOff(flight);
    },
    // Both also fire on mount, so only react to real changes.
    view: ({ index: viewed }: { index: number }) => {
      if (viewed === viewIndexRef.current) return;
      viewIndexRef.current = viewed;
      zoomRef.current = 1;
      interruptOpen();
    },
    zoom: ({ zoom }: { zoom: number }) => {
      if (zoom === zoomRef.current) return;
      zoomRef.current = zoom;
      interruptOpen();
    },
    // Lighten. Runs synchronously in YARL's close handler, after it has
    // restored focus and started the portal fade, before anything paints.
    // (Closed before the handoff, there's no backdrop and the fade is 0.)
    exiting: () => {
      const open = flightRef.current;
      if (open?.flyer && (open.phase === "mount" || open.phase === "handoff")) {
        // Closed mid-open: adopt that flyer, which already covers the slide.
        open.animations.forEach((animation) => animation.cancel());
        flightRef.current = { phase: "lighten", tile: open.tile, flyer: open.flyer, animations: [] };
        mark("C1-lighten");
        return;
      }
      // Closed mid-darken: the open flight only still holds the tile hidden.
      if (open?.phase === "darken") land(open);
      else if (open) return;
      if (isReducedMotion() || zoomRef.current > 1) return; // plain portal fade
      const slide = currentSlideElement();
      const src = slide && bestLoadedSrc(slide);
      if (!slide || !src) return;
      const tile = tileAt(viewIndexRef.current);
      const flyer = createFlyer(src, boxOf(slide));
      if (tile) tile.style.opacity = "0";
      flightRef.current = { phase: "lighten", tile, flyer, animations: [] };
      mark("C1-lighten");
    },
    exited: () => {
      setHandoff(null);
      setBackdrop(true);
      const flight = flightRef.current;
      if (flight?.phase !== "lighten" || !flight.flyer) return;
      const flyer = flight.flyer;
      // YARL's exited timer can fire a frame before the CSS fade reaches 0;
      // shrink only once the portal has measurably finished lightening.
      whenFrame(() => (alphaOf(document.querySelector(".yarl__portal"), "opacity") ?? 0) === 0, 300).then(() => {
        if (flightRef.current === flight) shrink(flight, flyer);
      });
    },
  };

  const reduced = isReducedMotion();

  return (
    <div className="flex w-full min-w-0 flex-col gap-8">
      <TagMenu tags={tags} selected={tag} onSelect={selectTag} />

      <div ref={galleryRef} className="w-full min-w-0" data-name="Gallery" aria-busy={loading}>
        {photos.length > 0 ? (
          <PhotoAlbum
            layout="masonry"
            photos={photos}
            spacing={(containerWidth) => (containerWidth < 640 ? 8 : containerWidth < 1024 ? 16 : 24)}
            columns={(containerWidth) => (containerWidth < 640 ? 3 : containerWidth < 1024 ? 4 : 5)}
            defaultContainerWidth={1312}
            sizes={ALBUM_SIZES}
            renderPhoto={({ photo, layout, wrapperStyle, imageProps: { sizes } }) => (
              <button
                type="button"
                aria-label={`Open photo ${layout.index + 1}`}
                className="gallery-tile squishy squishy-tile relative block appearance-none overflow-hidden rounded-md border-0 bg-skeleton p-0"
                style={wrapperStyle}
                data-photo-index={layout.index}
                onClick={(event) => openPhoto(event.currentTarget, layout.index)}
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
        animation={
          reduced
            ? { fade: 0, swipe: 0, zoom: 0, navigation: 0 }
            : { fade: backdrop ? FADE_MS : 0, easing: { fade: EASE_OUT } }
        }
        className={backdrop ? undefined : "lightbox-undimmed"}
        carousel={{ padding: `${LIGHTBOX_PADDING}px` }}
        controller={{ closeOnBackdropClick: true }}
        on={lightboxOn}
        render={{
          slide: (props) => {
            const slide = props.slide as SlideImage;
            return <LightboxSlide {...props} slide={slide} handoffSrc={handoff?.key === slide.src ? handoff.src : undefined} />;
          },
        }}
      />
    </div>
  );
}
