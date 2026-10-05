// Album stack ↔ gallery card flights. Unlike the lightbox flyer (a scale
// trick between two rects of the same aspect), a card turns from a tilted 4:5
// print into a tile of any shape, so the flyer animates its real size and the
// photo re-crops (object-fit: cover) on every frame instead of stretching.
//
// The flyer sits at its target's center with `translate: -50% -50%`; the
// center glides on `translate`, the size springs on width/height, and the tilt
// rides `rotate` (applied inside `translate`, so it never swings the path).

import { EASE_OUT, PRESS_MS, STRETCH_MS, flightEasings, type Box } from "./lightboxFlight";

export const STAGGER_MS = 20;
export const MAX_FLYERS = 12;
export const CLEAR_MS = 150; // gallery fade out / in around a swap
const STACK_PRESS = 0.96; // .squishy-stack --press-scale

/** A box plus the tilt it's drawn at. */
export type Card = Box & { angle: number };

const center = (box: Box) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 });

/** Degrees of a computed `transform` matrix's rotation. */
function matrixAngle(transform: string) {
  const values = transform.match(/matrix\(([^)]+)\)/)?.[1].split(",").map(Number);
  return values ? (Math.atan2(values[1], values[0]) * 180) / Math.PI : 0;
}

/** A stack card's untransformed footprint centered where it's drawn, and its
 *  tilt. (Its bounding rect is the rotated card's, which is too big.) */
export function cardOf(card: HTMLElement): Card {
  const { x, y } = center(card.getBoundingClientRect());
  const width = card.offsetWidth;
  const height = card.offsetHeight;
  return { left: x - width / 2, top: y - height / 2, width, height, angle: matrixAngle(getComputedStyle(card).transform) };
}

/** Where a flyer is right now, mid-flight included. */
export function flyerCard(flyer: HTMLElement): Card {
  const { x, y } = center(flyer.getBoundingClientRect());
  const style = getComputedStyle(flyer);
  const width = parseFloat(style.width);
  const height = parseFloat(style.height);
  const angle = parseFloat(style.rotate) || 0;
  return { left: x - width / 2, top: y - height / 2, width, height, angle };
}

/** Puts `flyer`'s anchor at `card`'s center, at `card`'s size and tilt. */
export function placeCardFlyer(flyer: HTMLElement, card: Card) {
  const { x, y } = center(card);
  Object.assign(flyer.style, {
    left: `${x}px`,
    top: `${y}px`,
    width: `${card.width}px`,
    height: `${card.height}px`,
    translate: "-50% -50%",
    rotate: `${card.angle}deg`,
  });
}

export function createCardFlyer(src: string, card: Card) {
  const flyer = document.createElement("div");
  flyer.className = "album-flyer";
  flyer.setAttribute("aria-hidden", "true");
  // Card look in flight: --radius-md corners and the stack card's shadow.
  Object.assign(flyer.style, {
    position: "fixed",
    zIndex: "10000",
    margin: "0",
    overflow: "hidden",
    pointerEvents: "none",
    borderRadius: "8px",
    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.1), 0 6px 16px rgba(0, 0, 0, 0.08)",
    background: "var(--skeleton)",
  });
  placeCardFlyer(flyer, card);
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.decoding = "sync";
  img.draggable = false;
  Object.assign(img.style, { display: "block", width: "100%", height: "100%", objectFit: "cover" });
  flyer.append(img);
  document.body.append(flyer);
  return flyer;
}

/** Flies a flyer anchored at `to` (placeCardFlyer) from `from` to `to`. */
export function flyCard(flyer: HTMLElement, from: Card, to: Card, { duration = STRETCH_MS } = {}): Animation[] {
  const { glide, size } = flightEasings(from, to);
  const start = center(from);
  const end = center(to);
  const timing = { duration, fill: "forwards" as const };
  return [
    flyer.animate(
      [{ translate: `calc(-50% + ${start.x - end.x}px) calc(-50% + ${start.y - end.y}px)` }, { translate: "-50% -50%" }],
      { ...timing, easing: glide },
    ),
    flyer.animate(
      [
        { width: `${from.width}px`, height: `${from.height}px`, rotate: `${from.angle}deg` },
        { width: `${to.width}px`, height: `${to.height}px`, rotate: `${to.angle}deg` },
      ],
      { ...timing, easing: size },
    ),
  ];
}

/** Re-anchors a flyer that's mid-flight at `to` and flies it there from
 *  wherever it is now (reversing an explode). */
export function redirect(flyer: HTMLElement, animations: Animation[], to: Card, options?: { duration?: number }) {
  const from = flyerCard(flyer);
  animations.forEach((animation) => animation.cancel());
  placeCardFlyer(flyer, to);
  return flyCard(flyer, from, to, options);
}

/** Stack acknowledgement, like the tile's pressPulse. */
export const stackPulse = (stack: HTMLElement) =>
  stack.animate([{ transform: `scale(${STACK_PRESS})`, offset: 0.4 }, { transform: "scale(1)" }], {
    duration: PRESS_MS,
    easing: EASE_OUT,
  });

/** The gallery steps back (fade + slight shrink) before its contents swap. */
export const clearOut = (gallery: HTMLElement) =>
  gallery.animate([{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.96)" }], {
    duration: CLEAR_MS,
    easing: EASE_OUT,
    fill: "forwards",
  });

export const fadeIn = (element: HTMLElement) =>
  element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: CLEAR_MS, easing: EASE_OUT });

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const mark = (name: string) => {
  if (import.meta.env.DEV) performance.mark(`ab:${name}`);
};
