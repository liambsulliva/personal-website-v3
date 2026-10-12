import { useEffect, useRef, useState } from "react";
import { EASE_OUT, FADE_MS } from "./lightboxFlight";

// One short status line, bottom center over the page, in the Chip's default
// colors. Rises in, holds, fades out; with motion off it just appears and
// goes. The live region is always mounted so screen readers announce it.

export type ToastMessage = { id: number; text: string };

const HOLD_MS = 2500;
const RISE_PX = 8;

const isReduced = () => document.documentElement.hasAttribute("data-reduced-motion");

export default function Toast({ message }: { message: ToastMessage | null }) {
  const [shown, setShown] = useState<ToastMessage | null>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  // A new message replaces the one showing and restarts the hold.
  useEffect(() => {
    if (message) setShown(message);
  }, [message]);

  useEffect(() => {
    const pill = pillRef.current;
    if (!shown || !pill) return;
    const reduced = isReduced();
    if (!reduced) {
      pill.animate([{ opacity: 0, transform: `translateY(${RISE_PX}px)` }, { opacity: 1, transform: "none" }], {
        duration: FADE_MS,
        easing: EASE_OUT,
      });
    }
    let exit: Animation | null = null;
    const timer = window.setTimeout(() => {
      if (reduced) return setShown(null);
      exit = pill.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EASE_OUT, fill: "forwards" });
      exit.finished.then(() => setShown(null), () => {});
    }, HOLD_MS);
    return () => {
      window.clearTimeout(timer);
      exit?.cancel();
    };
  }, [shown]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4"
      data-name="Toast"
    >
      {shown && (
        <div
          key={shown.id}
          ref={pillRef}
          className="rounded-pill border border-border bg-control px-4 py-2 text-[16px] leading-[1.5] text-fg"
        >
          {shown.text}
        </div>
      )}
    </div>
  );
}
