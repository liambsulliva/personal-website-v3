import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import PhotoAlbum from "react-photo-album";
import Lightbox from "yet-another-react-lightbox";
import type { RenderSlideProps, SlideImage } from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import ProgressiveImage from "./ProgressiveImage";
import TagMenu from "./TagMenu";
import Loader from "./Loader";
import AlbumCarousel from "./AlbumCarousel";
import { toGalleryPhoto, type GalleryPhoto, type PhotoResource } from "../../lib/photos";
import { albumExpression, type AlbumCard } from "../../lib/albums";
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
  type Box,
} from "./lightboxFlight";
import {
  MAX_FLYERS,
  STAGGER_MS,
  cardOf,
  clearOut,
  createCardFlyer,
  fadeIn,
  flyCard,
  mark as albumMark,
  redirect,
  sleep,
  stackPulse,
  type Card,
} from "./albumFlight";

// Figma AlbumCarousel (190:3925) + Chip (14:198) row + GalleryTile masonry
// (25:544). The album stacks, first page and tag list arrive SSR'd; fetching
// only happens for the next page, a new tag or an opened album.

const PAGE_SIZE = 20;
const ALBUM_PAGE_SIZE = 50; // the public search route's max
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
  albums: AlbumCard[];
  tags: string[];
  initialPhotos: GalleryPhoto[];
  initialCursor: string | null;
};

// What fills the gallery: a tag ("" = All) or an album. Plain data, so it can
// back a `?album=` URL later.
type Source = { kind: "tag"; tag: string } | { kind: "album"; slug: string };
// A chip or stack click. `restore`: the open stack's empty slot, back to the
// tag the album replaced.
type Request = Source | { kind: "restore" };
type Page = { photos: GalleryPhoto[]; cursor: string | null };

function searchUrl(source: Source, cursor: string | null) {
  return source.kind === "album"
    ? publicCloudinarySearchUrl({
        expression: albumExpression(source.slug),
        max_results: ALBUM_PAGE_SIZE,
        next_cursor: cursor,
        sort: "asc",
      })
    : publicCloudinarySearchUrl({
        expression: source.tag ? `resource_type:image AND tags=${source.tag}` : "resource_type:image",
        max_results: PAGE_SIZE,
        next_cursor: cursor,
      });
}

async function fetchPage(source: Source, cursor: string | null, signal?: AbortSignal): Promise<Page> {
  const response = await fetch(searchUrl(source, cursor), { signal });
  if (!response.ok) throw new Error(`Search responded with ${response.status}`);
  const data: { resources?: PhotoResource[]; next_cursor?: string } = await response.json();
  return { photos: (data.resources ?? []).map(toGalleryPhoto), cursor: data.next_cursor ?? null };
}

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

// Album stack ↔ gallery transition. One runs at a time (a serial queue; a
// request that arrives mid-run replaces the one waiting, latest wins), each
// phase starting on the previous one's measured end.
//   explode:  press (stack pulse; the album's first page is already loading)
//             → clear (gallery fades back) → swap (album fills the gallery)
//             → fly (each on-screen tile's card leaves the stack, staggered,
//             the stack turning into its dashed slot) → land (tile shown,
//             flyer removed)
//   collapse: fly back (on-screen tiles into the stack, or squashed out the
//             viewport edge toward it; the gallery fades back meanwhile)
//             → settle (cards back in the stack) → fill (the next tag or album)
// Closing mid-explode reverses the cards from wherever they are.
type AlbumPhase = "press" | "clear" | "fetch" | "fly" | "collapse" | "fill";
type AlbumTransition = { phase: AlbumPhase; slug: string | null; reversed: boolean };
/** A card between the stack and gallery tile `index`. */
type CardFlight = { index: number; tile: HTMLElement | null; flyer: HTMLElement; animations: Animation[]; landed: boolean };

/** The stack card a tile's photo flies from / back to: previews are the
 *  album's first three photos, the rest leave from the top card. */
const stackCardFor = (cards: HTMLElement[], photoIndex: number) => cards[photoIndex] ?? cards[0];

export default function PhotoGallery({ albums, tags, initialPhotos, initialCursor }: Props) {
  const [source, setSource] = useState<Source>({ kind: "tag", tag: "" });
  // The selected chip: "" = All, null = none (an album fills the gallery).
  const [chip, setChip] = useState<string | null>("");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
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
  const rootRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);
  const albumRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<Flight | null>(null);
  const viewIndexRef = useRef(-1);
  const zoomRef = useRef(1);
  // Album transitions read these mid-run, between renders.
  const sourceRef = useRef(source);
  const openSlugRef = useRef(openSlug);
  const photosRef = useRef(photos);
  const cursorRef = useRef(cursor);
  const queueRef = useRef<{ running: boolean; pending: Request | null }>({ running: false, pending: null });
  const transitionRef = useRef<AlbumTransition | null>(null);
  const cardsRef = useRef<CardFlight[]>([]);
  const clearRef = useRef<Animation | null>(null); // the gallery is faded back while set
  // The tag page an album replaced, so its empty slot restores it unfetched.
  const snapshotRef = useRef<{ tag: string } & Page | null>(null);

  useEffect(() => {
    photosRef.current = photos;
    cursorRef.current = cursor;
  }, [photos, cursor]);

  const loadPage = useCallback(async (nextSource: Source, nextCursor: string | null) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const page = await fetchPage(nextSource, nextCursor, controller.signal);
      setPhotos((previous) => (nextCursor ? [...previous, ...page.photos] : page.photos));
      setCursor(page.cursor);
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

  // Infinite scroll: only ever fetches the *next* page, and never mid-transition.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || loading || error || transitioning || cursor === null) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) loadPage(source, cursor);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, error, transitioning, cursor, source, loadPage]);

  // ── Album transitions ─────────────────────────────────────────
  /** Sets the gallery's source and contents in one synchronous commit, so
   *  the new tiles can be measured on the next line. */
  const showSource = (next: Source, page: Page | null, extra?: () => void) => {
    sourceRef.current = next;
    flushSync(() => {
      setSource(next);
      if (page) {
        setPhotos(page.photos);
        setCursor(page.cursor);
      }
      extra?.();
    });
  };

  const setOpen = (slug: string | null) => {
    openSlugRef.current = slug;
    flushSync(() => setOpenSlug(slug));
  };

  const stackCards = (slug: string) => {
    const stack = rootRef.current?.querySelector<HTMLElement>(`[data-album-stack="${CSS.escape(slug)}"]`) ?? null;
    const cards = stack ? [...stack.querySelectorAll<HTMLElement>("[data-album-card]")] : [];
    return { stack, cards: cards.sort((a, b) => Number(a.dataset.albumCard) - Number(b.dataset.albumCard)) };
  };

  /** Gallery tiles in photo order, with their rects. */
  const tiles = () =>
    [...(galleryRef.current?.querySelectorAll<HTMLElement>("[data-photo-index]") ?? [])]
      .map((tile) => ({ tile, index: Number(tile.dataset.photoIndex), box: boxOf(tile) }))
      .sort((a, b) => a.index - b.index);

  const clearGallery = async () => {
    const gallery = albumRef.current;
    if (!gallery || clearRef.current || isReducedMotion()) return;
    const clear = clearOut(gallery);
    clearRef.current = clear;
    await clear.finished.catch(() => {});
  };

  /** Brings a cleared gallery back: instantly when cards are about to land in
   *  it, else with a fade. */
  const revealGallery = async ({ fade = true } = {}) => {
    const clear = clearRef.current;
    if (!clear) return;
    clear.cancel();
    clearRef.current = null;
    if (fade && albumRef.current) await fadeIn(albumRef.current).finished.catch(() => {});
  };

  const landCard = (card: CardFlight) => {
    card.landed = true;
    card.flyer.remove();
    if (card.tile) card.tile.style.opacity = "";
  };

  const explode = async (slug: string) => {
    const transition: AlbumTransition = { phase: "press", slug, reversed: false };
    transitionRef.current = transition;
    const reduced = isReducedMotion();
    const current = sourceRef.current;
    if (current.kind === "tag") snapshotRef.current = { tag: current.tag, photos: photosRef.current, cursor: cursorRef.current };
    requestRef.current?.abort();
    const controller = new AbortController();
    const pending = fetchPage({ kind: "album", slug }, null, controller.signal);
    pending.catch(() => {});

    // Press: acknowledge the click while the album loads.
    albumMark("E1-press");
    const { stack } = stackCards(slug);
    if (stack && !reduced) {
      stack.style.transition = "none"; // the pulse replaces the CSS :active spring
      await stackPulse(stack).finished.catch(() => {});
      stack.style.transition = "";
    }
    if (transition.reversed) return controller.abort();

    // Clear: the current gallery steps back.
    transition.phase = "clear";
    albumMark("E2-clear");
    await clearGallery();
    if (transition.reversed) return controller.abort();

    transition.phase = "fetch";
    setLoading(true);
    let page: Page;
    try {
      page = await pending;
      await Promise.all(page.photos.slice(0, MAX_FLYERS).map((photo) => decodeWithin(photo.src, 300)));
    } catch (err) {
      console.error("PhotoGallery: failed to load album", err);
      showSource({ kind: "album", slug }, { photos: [], cursor: null }, () => {
        setChip(null);
        setLoading(false);
        setError(true);
      });
      setOpen(slug);
      await revealGallery();
      return;
    }
    if (transition.reversed) return setLoading(false);

    // Swap: the album fills the (still invisible) gallery.
    albumMark("E3-swap");
    showSource({ kind: "album", slug }, page, () => {
      setChip(null);
      setLoading(false);
      setError(false);
    });
    if (reduced) {
      setOpen(slug);
      return;
    }
    await afterPaint(); // masonry settles on its measured width
    if (transition.reversed) return;

    // Fly: measured with the gallery back at full size, in one task, so the
    // tiles never paint before their cards cover them.
    transition.phase = "fly";
    albumMark("E4-fly");
    void revealGallery({ fade: false });
    const all = tiles();
    const onScreen = all.filter(({ box }) => inViewport(box)).slice(0, MAX_FLYERS);
    // Below the fold: the preview cards still leave, out the bottom edge.
    const flights = onScreen.length ? onScreen : all.slice(0, 3);
    const targets = new Set(flights.map(({ index }) => index));
    flights.forEach(({ tile }) => (tile.style.opacity = "0"));
    all.filter(({ index, box }) => !targets.has(index) && inViewport(box)).forEach(({ tile }) => fadeIn(tile));

    const { cards } = stackCards(slug);
    cardsRef.current = [];
    const landings: Promise<void>[] = [];
    for (const [i, { tile, index: photoIndex, box }] of flights.entries()) {
      if (transition.reversed) break;
      const card = stackCardFor(cards, photoIndex);
      const from: Card = card ? cardOf(card) : { ...box, angle: 0 };
      const to: Card = inViewport(box) ? { ...box, angle: 0 } : { ...exitToward(box, from), angle: 0 };
      const flyer = createCardFlyer(page.photos[photoIndex].src, to);
      const flight: CardFlight = { index: photoIndex, tile: inViewport(box) ? tile : null, flyer, animations: flyCard(flyer, from, to), landed: false };
      if (!flight.tile) tile.style.opacity = "";
      cardsRef.current.push(flight);
      // Each card leaves the stack the frame its flyer appears; the stack
      // becomes its dashed slot once the last preview card is gone.
      if (card && photoIndex < 3) card.style.opacity = "0";
      if (i === Math.min(flights.length, 3) - 1) {
        setOpen(slug);
        cards.forEach((element) => (element.style.opacity = ""));
      }
      const animations = flight.animations;
      landings.push(
        allFinished(animations).then(async () => {
          if (flight.animations !== animations || flight.landed) return; // redirected by a collapse
          await loadedWithin(flight.tile?.querySelector("img") ?? null, 300);
          if (flight.animations === animations && !flight.landed) landCard(flight);
        }),
      );
      await sleep(STAGGER_MS);
    }
    if (!openSlugRef.current) {
      setOpen(slug);
      cards.forEach((element) => (element.style.opacity = ""));
    }
    if (transition.reversed) return; // the collapse takes over the cards in flight
    await Promise.all(landings);
    albumMark("E5-land");
    cardsRef.current = [];
  };

  const collapse = async (slug: string) => {
    const transition: AlbumTransition = { phase: "collapse", slug, reversed: false };
    transitionRef.current = transition;
    albumMark("C1-collapse");
    if (isReducedMotion()) {
      cardsRef.current.forEach(landCard);
      cardsRef.current = [];
      setOpen(null);
      return;
    }
    const { cards } = stackCards(slug);
    const top = cards[0] ? cardOf(cards[0]) : null;
    const homeFor = (photoIndex: number, from: Box): Card => {
      const card = stackCardFor(cards, photoIndex);
      if (top && card && inViewport(top)) return cardOf(card);
      // The stack is scrolled away: squash out the edge toward it.
      return { ...exitToward(top, from), angle: 0 };
    };

    // Cards still on their way out turn around where they are; landed tiles
    // on screen fly back from their own rects, last one first.
    const inflight = cardsRef.current.filter((card) => !card.landed);
    const flying = new Set(inflight.map((card) => card.index));
    const returning = tiles()
      .filter(({ index, box }) => !flying.has(index) && inViewport(box))
      .slice(0, Math.max(0, MAX_FLYERS - inflight.length))
      .reverse();
    const flights: CardFlight[] = [];
    for (const card of inflight) {
      card.animations = redirect(card.flyer, card.animations, homeFor(card.index, boxOf(card.flyer)));
      flights.push(card);
    }
    void clearGallery();
    for (const { tile, index: photoIndex, box } of returning) {
      const from: Card = { ...box, angle: 0 };
      const to = homeFor(photoIndex, box);
      const flyer = createCardFlyer(bestLoadedSrc(tile) ?? photosRef.current[photoIndex]?.src ?? "", to);
      tile.style.opacity = "0";
      flights.push({ index: photoIndex, tile, flyer, animations: flyCard(flyer, from, to), landed: false });
      await sleep(STAGGER_MS);
    }
    await allFinished(flights.flatMap((card) => card.animations));
    // Settle: the cards are home; the stack takes over from the flyers. The
    // cards turn opaque in the same frame the flyers go (no fade, or the
    // dashed slot would show through); only the print's settle spring runs.
    albumMark("C2-settle");
    cards.forEach((card) => (card.style.transition = "none"));
    setOpen(null);
    flights.forEach((card) => {
      card.flyer.remove();
      if (card.tile) card.tile.style.opacity = "";
    });
    cardsRef.current = [];
    await afterPaint();
    cards.forEach((card) => (card.style.transition = ""));
  };

  /** Fills the gallery with tag `tag`. From an album (gallery cleared), the
   *  page fades in; tag → tag keeps the original instant swap + loader. */
  const fill = async (tag: string) => {
    transitionRef.current = { phase: "fill", slug: null, reversed: false };
    albumMark("C3-fill");
    const current = sourceRef.current;
    const cleared = clearRef.current !== null;
    setChip(tag);
    if (current.kind === "tag" && current.tag === tag) {
      await revealGallery(); // an explode reversed before its swap
      return;
    }
    const snapshot = current.kind === "album" && snapshotRef.current?.tag === tag ? snapshotRef.current : null;
    if (!cleared && !snapshot) {
      showSource({ kind: "tag", tag }, { photos: [], cursor: null });
      await loadPage({ kind: "tag", tag }, null);
      return;
    }
    let page: Page | null = snapshot;
    if (!page) {
      requestRef.current?.abort();
      setLoading(true);
      setError(false);
      try {
        page = await fetchPage({ kind: "tag", tag }, null);
      } catch (err) {
        console.error("PhotoGallery: failed to load photos", err);
        showSource({ kind: "tag", tag }, { photos: [], cursor: null }, () => {
          setLoading(false);
          setError(true);
        });
        await revealGallery();
        return;
      }
    }
    showSource({ kind: "tag", tag }, page, () => {
      setLoading(false);
      setError(false);
    });
    await revealGallery();
  };

  const run = async (next: Request) => {
    // Never over a lightbox flight (e.g. a chip clicked as the photo shrinks home).
    await whenFrame(() => flightRef.current === null, 2000);
    const open = openSlugRef.current;
    if (next.kind === "album" && next.slug === open) return;
    if (open) await collapse(open);
    if (next.kind === "album") await explode(next.slug);
    else await fill(next.kind === "tag" ? next.tag : (snapshotRef.current?.tag ?? ""));
  };

  const request = (next: Request) => {
    const queue = queueRef.current;
    if (queue.running) {
      const transition = transitionRef.current;
      // A second click on the album that's opening is a no-op.
      if (next.kind === "album" && transition?.slug === next.slug && !transition.reversed) return;
      // Anything else closes it: an explode in progress turns around.
      if (transition && transition.phase !== "collapse" && transition.phase !== "fill") transition.reversed = true;
      queue.pending = next;
      return;
    }
    queue.running = true;
    setTransitioning(true);
    void (async () => {
      let next_: Request | null = next;
      while (next_) {
        try {
          await run(next_);
        } catch (err) {
          console.error("PhotoGallery: album transition failed", err);
        }
        next_ = queue.pending;
        queue.pending = null;
      }
      transitionRef.current = null;
      queue.running = false;
      setTransitioning(false);
    })();
  };

  const selectTag = (next: string) => request({ kind: "tag", tag: next });
  const selectAlbum = (album: AlbumCard) =>
    request(album.slug === openSlugRef.current ? { kind: "restore" } : { kind: "album", slug: album.slug });

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
    if (flightRef.current || queueRef.current.running) return; // one transition at a time
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
    <div ref={rootRef} className="flex w-full min-w-0 flex-col gap-8">
      {albums.length > 0 && <AlbumCarousel albums={albums} openSlug={openSlug} onSelect={selectAlbum} />}

      <TagMenu tags={tags} selected={chip} onSelect={selectTag} />

      <div ref={galleryRef} className="w-full min-w-0" data-name="Gallery" aria-busy={loading}>
        {/* What an album transition fades back and brings forward. */}
        <div ref={albumRef} className="w-full min-w-0 origin-top">
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
        </div>
        <div ref={sentinelRef} aria-hidden />
        {loading && <Loader />}
        {error && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="m-0 text-[16px] text-muted">Couldn't load photos.</p>
            <button
              type="button"
              onClick={() => loadPage(source, cursor)}
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
