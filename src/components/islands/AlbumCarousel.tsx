import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AlbumCard } from "../../lib/albumData";
import AlbumStack from "./AlbumStack";
import { CarouselNavigationButton } from "./Carousel";

// Figma AlbumCarousel (desktop 190:3925, mobile 190:4535): one scroll-snapped
// row of album stacks. Desktop pages with Carousel.tsx's 40px buttons;
// mobile is swipe-only. The top-level albums, or an open album's sub-albums.

type AlbumCarouselProps = {
  albums: AlbumCard[];
  openPath: string | null;
  disabled?: boolean;
  label?: string;
  /** Sub-albums: a smaller row on a phone, in a .sub-albums. */
  compact?: boolean;
  /** Where the row is scrolled to, for a row that unmounts and comes back. */
  position?: { left: number };
  onSelect: (album: AlbumCard, button: HTMLButtonElement) => void;
};

// Stacks whose photos are requested on first render (SSR included): a
// desktop row is 5½ stacks. The rest load as they come within one track
// width of view, and stay loaded.
const EAGER_STACKS = 6;
// Stacks that fit the widest row (1144px). Until the row is measured, more than
// this counts as overflowing.
const FITTING_STACKS = 4;

const scrollBehavior = (): ScrollBehavior =>
  document.documentElement.hasAttribute("data-reduced-motion") ? "auto" : "smooth";

export default function AlbumCarousel({
  albums,
  openPath,
  disabled = false,
  label = "Photo albums",
  compact = false,
  position,
  onSelect,
}: AlbumCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  // SSR assumes the Figma state (a full row, at the start) so hydration only
  // ever toggles the buttons, never moves anything.
  const [overflow, setOverflow] = useState(albums.length > FITTING_STACKS);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);
  const [loaded, setLoaded] = useState(() => new Set(albums.slice(0, EAGER_STACKS).map((album) => album.path)));

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const near = entries.filter((entry) => entry.isIntersecting).map((entry) => (entry.target as HTMLElement).dataset.albumStack);
        if (!near.length) return;
        setLoaded((previous) => {
          const next = new Set(previous);
          near.forEach((path) => path && next.add(path));
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
    if (position) track.scrollLeft = position.left;
    const check = () => {
      const max = track.scrollWidth - track.clientWidth;
      if (position) position.left = track.scrollLeft;
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
  }, [albums, position]);

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
        className={`album-track -mx-6 -my-8 flex snap-x snap-mandatory scroll-px-6 overflow-x-auto overscroll-x-contain px-6 py-8 md:gap-6 ${compact ? "gap-3" : "gap-4"}`}
        role="group"
        aria-label={label}
      >
        {albums.map((album) => (
          <AlbumStack
            key={album.path}
            album={album}
            open={album.path === openPath}
            load={loaded.has(album.path)}
            disabled={disabled}
            compact={compact}
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
