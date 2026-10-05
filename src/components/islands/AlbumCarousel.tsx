import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AlbumCard } from "../../lib/albums";
import AlbumStack from "./AlbumStack";
import { CarouselNavigationButton } from "./Carousel";

// Figma AlbumCarousel (desktop 190:3925, mobile 190:4535): one scroll-snapped
// row of album stacks. Desktop pages with Carousel.tsx's 40px buttons;
// mobile is swipe-only.

type AlbumCarouselProps = {
  albums: AlbumCard[];
  openSlug: string | null;
  disabled?: boolean;
  onSelect: (album: AlbumCard, button: HTMLButtonElement) => void;
};

// Stacks whose photos are requested on first render (SSR included): a
// desktop row is 5½ stacks. The rest load as they come within one track
// width of view, and stay loaded.
const EAGER_STACKS = 6;

const scrollBehavior = (): ScrollBehavior =>
  document.documentElement.hasAttribute("data-reduced-motion") ? "auto" : "smooth";

export default function AlbumCarousel({ albums, openSlug, disabled = false, onSelect }: AlbumCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  // SSR assumes the Figma state (overflowing, at the start) so hydration only
  // ever toggles the buttons, never moves anything.
  const [overflow, setOverflow] = useState(true);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);
  const [loaded, setLoaded] = useState(() => new Set(albums.slice(0, EAGER_STACKS).map((album) => album.slug)));

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const near = entries.filter((entry) => entry.isIntersecting).map((entry) => (entry.target as HTMLElement).dataset.albumStack);
        if (!near.length) return;
        setLoaded((previous) => {
          const next = new Set(previous);
          near.forEach((slug) => slug && next.add(slug));
          return next.size === previous.size ? previous : next;
        });
      },
      // Percentages are of the track: one full width ahead on either side.
      { root: track, rootMargin: "0px 100%" },
    );
    track.querySelectorAll("[data-album-stack]").forEach((stack) => observer.observe(stack));
    return () => observer.disconnect();
  }, [albums]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const check = () => {
      const max = track.scrollWidth - track.clientWidth;
      setOverflow(max > 1);
      setCanPrev(track.scrollLeft > 1);
      setCanNext(track.scrollLeft < max - 1);
    };
    check();
    track.addEventListener("scroll", check, { passive: true });
    const resizeObserver = new ResizeObserver(check);
    resizeObserver.observe(track);
    return () => {
      track.removeEventListener("scroll", check);
      resizeObserver.disconnect();
    };
  }, [albums]);

  const scrollByPage = useCallback((direction: 1 | -1) => {
    const track = trackRef.current;
    track?.scrollBy({ left: direction * track.clientWidth, behavior: scrollBehavior() });
  }, []);

  // One stack (232px + gap) per arrow key, while focus is inside the row.
  // preventDefault: the browser would otherwise also scroll the focused
  // button's scroller natively.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    const track = trackRef.current;
    const stack = track?.firstElementChild;
    if (!track || !(stack instanceof HTMLElement)) return;
    event.preventDefault();
    const step = stack.offsetWidth + parseFloat(getComputedStyle(track).columnGap || "0");
    track.scrollBy({ left: event.key === "ArrowRight" ? step : -step, behavior: scrollBehavior() });
  };

  return (
    <div className="relative w-full" data-name="AlbumCarousel" onKeyDown={handleKeyDown}>
      {/* overflow-x clips both axes, so the track is padded out past the
          stacks (hover fan, shadows, focus ring) and pulled back by the same
          margins; scroll-padding keeps snapped stacks on the content edge. */}
      <div
        ref={trackRef}
        className="album-track -mx-6 -my-8 flex snap-x snap-mandatory scroll-px-6 gap-4 overflow-x-auto overscroll-x-contain px-6 py-8 md:gap-6"
        role="group"
        aria-label="Photo albums"
      >
        {albums.map((album) => (
          <AlbumStack
            key={album.slug}
            album={album}
            open={album.slug === openSlug}
            load={loaded.has(album.slug)}
            disabled={disabled}
            onSelect={onSelect}
          />
        ))}
      </div>
      {overflow && (
        <>
          {/* Centered on the cards (16px inset + 220px), not the whole stack. */}
          <div className="absolute top-[126px] left-4 z-20 hidden -translate-y-1/2 md:flex">
            <CarouselNavigationButton
              direction="prev"
              onSelect={() => scrollByPage(-1)}
              disabled={disabled || !canPrev}
              label="Previous albums"
            />
          </div>
          <div className="absolute top-[126px] right-4 z-20 hidden -translate-y-1/2 md:flex">
            <CarouselNavigationButton
              direction="next"
              onSelect={() => scrollByPage(1)}
              disabled={disabled || !canNext}
              label="Next albums"
            />
          </div>
        </>
      )}
    </div>
  );
}
