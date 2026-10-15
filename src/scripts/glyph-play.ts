// One-shot glyph animations (/me Marks, lobby NavLinks and hero marks). A glyph
// carries data-glyph="<kind>"; its CSS animation runs while data-playing is
// set, and the attribute comes off once every animation inside has finished,
// so a hover that lands mid-play lets it finish instead of restarting it.

const reduced = () => document.documentElement.hasAttribute("data-reduced-motion");

export function play(glyph: HTMLElement): void {
  if (reduced() || glyph.hasAttribute("data-playing")) return;
  glyph.setAttribute("data-playing", "");
  const running = glyph.getAnimations({ subtree: true }).map((animation) => animation.finished);
  Promise.allSettled(running).then(() => glyph.removeAttribute("data-playing"));
}

/** Plays on mouse hover of the trigger (touch taps navigate instead). */
export function playOnHover(trigger: HTMLElement, glyph: HTMLElement): void {
  trigger.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") play(glyph);
  });
}

/** Where there's no hover (phones, tablets), plays each glyph once, the
 *  first time it's fully on screen, staggered in document order so a run of
 *  them reads in order. Hover devices only play on hover. */
export function playOnArrival(glyphs: HTMLElement[], delay = 150, stagger = 140): void {
  if (matchMedia("(hover: hover)").matches) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries
        .filter((entry) => entry.isIntersecting)
        .forEach((entry, index) => {
          observer.unobserve(entry.target);
          setTimeout(() => play(entry.target as HTMLElement), delay + index * stagger);
        });
    },
    { threshold: 1 },
  );
  glyphs.forEach((glyph) => observer.observe(glyph));
}
