// Gallery tile ↔ lightbox shared-element flight. The flyer is a fixed clone of
// the photo laid out at its *lightbox* rect and FLIP-transformed from the
// tile's rect, the same scale trick as Logomark's panel. It sits above the YARL
// portal (z 9999), so the lightbox can mount underneath it and take over
// without a visible swap.

export const LIGHTBOX_PADDING = 16; // YARL carousel.padding, passed explicitly
export const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)"; // --ease-out
// Every flight phase is capped at 200ms. The backdrop darken (250ms, global.css)
// is not a flight phase: it runs behind the already-visible photo.
export const PRESS_MS = 60;
export const STRETCH_MS = 200;
export const FADE_MS = 200; // close: the backdrop lightens under the flyer
export const CORRECT_MS = 100;
export const TILE_RADIUS = 8; // --radius-md (gallery-tile rounded-md)
const TILE_PRESS = 0.982; // .squishy-tile --press-scale

export type Box = { left: number; top: number; width: number; height: number };

/** LightboxSlide sizing: contain inside `rect`, never upscale. */
export function fitSlide(naturalWidth: number, naturalHeight: number, rect: { width: number; height: number }) {
  const fit = Math.min(rect.width / naturalWidth, rect.height / naturalHeight, 1);
  return { width: Math.round(naturalWidth * fit), height: Math.round(naturalHeight * fit) };
}

/** Where LightboxSlide will render: YARL's container is the viewport (scroll
 *  locked, so no scrollbar), inset by the carousel padding, content centered. */
export function lightboxTargetBox(naturalWidth: number, naturalHeight: number): Box {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const { width, height } = fitSlide(naturalWidth, naturalHeight, {
    width: viewportWidth - 2 * LIGHTBOX_PADDING,
    height: viewportHeight - 2 * LIGHTBOX_PADDING,
  });
  return { left: (viewportWidth - width) / 2, top: (viewportHeight - height) / 2, width, height };
}

export function boxOf(element: Element): Box {
  const { left, top, width, height } = element.getBoundingClientRect();
  return { left, top, width, height };
}

export const sameBox = (a: Box, b: Box) =>
  Math.abs(a.left - b.left) <= 1 &&
  Math.abs(a.top - b.top) <= 1 &&
  Math.abs(a.width - b.width) <= 1 &&
  Math.abs(a.height - b.height) <= 1;

export const inViewport = (box: Box) =>
  box.width > 0 && box.top < window.innerHeight && box.top + box.height > 0 && box.left < window.innerWidth && box.left + box.width > 0;

const centerShift = (box: Box, layout: Box) =>
  `translate(${box.left + box.width / 2 - (layout.left + layout.width / 2)}px, ${box.top + box.height / 2 - (layout.top + layout.height / 2)}px)`;

/** Scale (about the center) and per-axis counter-scaled corner radius that make
 *  an element laid out at `layout` cover `box` with a visual radius `radius`. */
function sizeFrame(box: Box, layout: Box, radius: number): Keyframe {
  const scaleX = box.width / layout.width;
  const scaleY = box.height / layout.height;
  return { transform: `scale(${scaleX}, ${scaleY})`, borderRadius: `${radius / scaleX}px / ${radius / scaleY}px` };
}

// ── Springs ─────────────────────────────────────────────────────
// iOS app-launch feel: the photo's *size* runs on an underdamped spring around
// its center while its *position* glides on a critically damped one. Both are
// sampled on the same timeline into CSS linear(), so a flight can be simulated
// before it runs.
const SAMPLES = 32;
const SPAN = 11; // in 1/ω: the softest spring below settles within 0.2%
const sampleAt = (i: number) => (i / SAMPLES) ** 1.25; // denser at the fast start

function springValues(damping: number) {
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    if (i === SAMPLES) return 1;
    const t = SPAN * sampleAt(i);
    if (damping >= 1) return 1 - Math.exp(-t) * (1 + t);
    const damped = Math.sqrt(1 - damping * damping);
    return 1 - Math.exp(-damping * t) * (Math.cos(damped * t) + (damping / damped) * Math.sin(damped * t));
  });
}

const toLinear = (values: number[]) =>
  `linear(${values.map((value, i) => (i === 0 ? "0" : i === SAMPLES ? "1" : `${value.toFixed(4)} ${(100 * sampleAt(i)).toFixed(2)}%`)).join(", ")})`;

const GLIDE = springValues(1);
// Most → least elastic. 0.59 ≈ 10% overshoot, one soft dip; 1 = none.
const DAMPINGS = [0.59, 0.63, 0.68, 0.74, 0.8, 0.88, 1];
const SPRINGS = DAMPINGS.map(springValues);

/** How far `box` pokes outside the viewport, in px (0 when fully on screen). */
function offscreen(box: Box) {
  return Math.max(0, -box.left, -box.top, box.left + box.width - window.innerWidth, box.top + box.height - window.innerHeight);
}

/** The most elastic size spring whose overshoot keeps the flyer on screen (no
 *  further off than its start or end already are). */
function springFor(from: Box, to: Box) {
  const allowed = Math.max(offscreen(from), offscreen(to)) + 0.5;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  return (
    SPRINGS.find((grow) =>
      grow.every((size, i) => {
        const width = lerp(from.width, to.width, size);
        const height = lerp(from.height, to.height, size);
        const centerX = lerp(from.left + from.width / 2, to.left + to.width / 2, GLIDE[i]);
        const centerY = lerp(from.top + from.height / 2, to.top + to.height / 2, GLIDE[i]);
        return offscreen({ left: centerX - width / 2, top: centerY - height / 2, width, height }) <= allowed;
      }),
    ) ?? GLIDE
  );
}

/** Flies `flyer` (laid out at `layout`) from covering `from` to covering `to`.
 *  Position glides; size springs (unless `elastic` is false), composited on
 *  top so the two curves stay independent. */
export function fly(
  flyer: HTMLElement,
  layout: Box,
  from: Box,
  to: Box,
  { duration = STRETCH_MS, elastic = true, fromRadius = 0, toRadius = 0 } = {},
): Animation[] {
  const timing = { duration, fill: "forwards" as const };
  return [
    flyer.animate([{ transform: centerShift(from, layout) }, { transform: centerShift(to, layout) }], {
      ...timing,
      easing: toLinear(GLIDE),
    }),
    flyer.animate([sizeFrame(from, layout, fromRadius), sizeFrame(to, layout, toRadius)], {
      ...timing,
      easing: toLinear(elastic ? springFor(from, to) : GLIDE),
      composite: "add",
    }),
  ];
}

const SQUASH = 0.3; // off-screen exit: the tile's height squashed to 30%

/** Close target when the photo's tile is scrolled out of view: a squashed pill
 *  just past the viewport edge the tile lies beyond (bottom, or top when the
 *  tile is above), lined up with the tile's column. iOS's pull into the
 *  Dynamic Island, aimed at where the photo lives. */
export function exitToward(tile: Box | null, from: Box): Box {
  const width = tile?.width ?? from.width * 0.4;
  const height = (tile?.height ?? from.height * 0.4) * SQUASH;
  const centerX = tile ? tile.left + tile.width / 2 : from.left + from.width / 2;
  const above = tile !== null && tile.top + tile.height <= 0;
  return { left: centerX - width / 2, top: above ? -height : window.innerHeight, width, height };
}

export const allFinished = (animations: Animation[]) =>
  Promise.all(animations.map((animation) => animation.finished)).then(
    () => {},
    () => {},
  );

/** The sharpest image layer the element has finished loading. */
export function bestLoadedSrc(element: Element): string | null {
  const loaded = [...element.querySelectorAll("img")].filter((img) => img.complete && img.naturalWidth > 0);
  const best = loaded[loaded.length - 1];
  return best ? best.currentSrc || best.src : null;
}

/** Resolves once `src` is decoded (so the next <img> with it paints on its
 *  first frame), or after `timeout` ms, whichever comes first. */
export function decodeWithin(src: string, timeout: number) {
  const image = new Image();
  image.src = src;
  return Promise.race([image.decode().catch(() => {}), new Promise<void>((resolve) => setTimeout(resolve, timeout))]);
}

/** Resolves on the first frame `ready()` is true, or after `timeout` ms. Used to
 *  queue a phase on a *measured* end state (an opacity reaching 0 or 1) rather
 *  than on a timer that can fire a frame early. */
export function whenFrame(ready: () => boolean, timeout: number) {
  return new Promise<void>((resolve) => {
    const deadline = performance.now() + timeout;
    const check = () => (ready() || performance.now() > deadline ? resolve() : requestAnimationFrame(check));
    check();
  });
}

/** Computed opacity of an element, or of its background color's alpha. */
export const alphaOf = (element: Element | null, property: "opacity" | "backgroundColor") => {
  if (!element) return null;
  const value = getComputedStyle(element)[property];
  if (property === "opacity") return Number(value);
  const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
  return channels.length === 4 ? channels[3] : 1;
};

/** Resolves once `img` has loaded, or after `timeout` ms. */
export function loadedWithin(img: HTMLImageElement | null, timeout: number) {
  if (!img || (img.complete && img.naturalWidth > 0)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => {
      img.removeEventListener("load", done);
      img.removeEventListener("error", done);
      resolve();
    };
    img.addEventListener("load", done);
    img.addEventListener("error", done);
    setTimeout(done, timeout);
  });
}

export function createFlyer(src: string, box: Box) {
  const flyer = document.createElement("div");
  // yarl__no_scroll_padding: YARL's NoScroll pads every fixed element by the
  // scrollbar width on open unless it carries this class.
  flyer.className = "lightbox-flyer yarl__no_scroll_padding";
  flyer.setAttribute("aria-hidden", "true");
  placeFlyer(flyer, box);
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.decoding = "sync";
  img.draggable = false;
  flyer.append(img);
  document.body.append(flyer);
  return flyer;
}

export function placeFlyer(flyer: HTMLElement, box: Box) {
  Object.assign(flyer.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  });
}

/** Tile acknowledgement. No from-keyframe, so it takes over from wherever the
 *  CSS :active press left the tile (keyboard clicks start at rest). */
export const pressPulse = (tile: HTMLElement) =>
  tile.animate([{ transform: `scale(${TILE_PRESS})`, offset: 0.4 }, { transform: "scale(1)" }], {
    duration: PRESS_MS,
    easing: EASE_OUT,
  });

export const mark = (name: string) => {
  if (import.meta.env.DEV) performance.mark(`lb:${name}`);
};
