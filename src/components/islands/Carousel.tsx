import React, { useCallback, useEffect, useRef, useState } from "react";

type CarouselTransition = "fade" | "slide";

export interface CarouselRenderContext<T> {
  item: T;
  index: number;
  isActive: boolean;
  currentIndex: number;
}

interface SharedCarouselProps<T> {
  items: T[];
  renderSlide: (context: CarouselRenderContext<T>) => React.ReactNode;
  getKey?: (item: T, index: number) => React.Key;
  currentIndex?: number;
  defaultIndex?: number;
  onCurrentIndexChange?: (index: number) => void;
  loop?: boolean;
  transition?: CarouselTransition;
  aspectRatio?: number | string;
  className?: string;
  viewportClassName?: string;
  slideClassName?: string;
  isLoading?: boolean;
  loadingContent?: React.ReactNode;
  emptyContent?: React.ReactNode;
  showNavigation?: boolean;
  showDots?: boolean;
  keyboardNavigation?: boolean;
  disabled?: boolean;
  previousLabel?: string;
  nextLabel?: string;
  dotLabel?: (index: number) => string;
  onViewportWidthChange?: (width: number) => void;
  renderOverlay?: (context: {
    currentIndex: number;
    itemCount: number;
    goTo: (index: number) => void;
    next: () => void;
    previous: () => void;
  }) => React.ReactNode;
}

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

const clampIndex = (index: number, itemCount: number) => {
  if (itemCount <= 0) return 0;
  return Math.min(Math.max(index, 0), itemCount - 1);
};

// Figma FeaturedCarousel (25:518) controls: 40px bg circle, 1px border, 20px chevron.
export const CarouselNavigationButton: React.FC<{
  direction: "prev" | "next";
  onSelect: () => void;
  disabled?: boolean;
  label: string;
}> = ({ direction, onSelect, disabled, label }) => (
  <button
    type="button"
    onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}
    disabled={disabled}
    className="carousel-nav squishy flex size-10 shrink-0 items-center justify-center overflow-clip rounded-[20px] border border-border bg-bg text-fg disabled:pointer-events-none disabled:opacity-40"
    aria-label={label}
  >
    <span
      className="glyph"
      style={
        {
          "--glyph": `url(/icons/chevron-${direction === "next" ? "right" : "left"}.svg)`,
          width: 20,
          height: 20,
        } as React.CSSProperties
      }
      aria-hidden="true"
    />
  </button>
);

const DefaultLoadingSkeleton = () => <div className="absolute inset-0 bg-skeleton" />;

const Carousel = <T,>({
  items,
  renderSlide,
  getKey,
  currentIndex,
  defaultIndex = 0,
  onCurrentIndexChange,
  loop = true,
  transition = "fade",
  aspectRatio,
  className,
  viewportClassName,
  slideClassName,
  isLoading = false,
  loadingContent,
  emptyContent,
  showNavigation = true,
  showDots = true,
  keyboardNavigation = true,
  disabled = false,
  previousLabel = "Previous slide",
  nextLabel = "Next slide",
  dotLabel = (index) => `Go to slide ${index + 1}`,
  onViewportWidthChange,
  renderOverlay,
}: SharedCarouselProps<T>) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [uncontrolledIndex, setUncontrolledIndex] = useState(defaultIndex);
  const itemCount = items.length;
  const activeIndex = clampIndex(currentIndex ?? uncontrolledIndex, itemCount);
  const hasMultipleItems = itemCount > 1;
  const canGoPrevious = hasMultipleItems && (loop || activeIndex > 0);
  const canGoNext = hasMultipleItems && (loop || activeIndex < itemCount - 1);

  const updateIndex = useCallback(
    (requestedIndex: number) => {
      if (itemCount === 0) return;

      let nextIndex = requestedIndex;
      if (loop) {
        nextIndex = (requestedIndex + itemCount) % itemCount;
      } else {
        nextIndex = clampIndex(requestedIndex, itemCount);
      }

      if (currentIndex === undefined) {
        setUncontrolledIndex(nextIndex);
      }
      onCurrentIndexChange?.(nextIndex);
    },
    [currentIndex, itemCount, loop, onCurrentIndexChange],
  );

  const previous = useCallback(() => {
    if (!disabled && canGoPrevious) {
      updateIndex(activeIndex - 1);
    }
  }, [activeIndex, canGoPrevious, disabled, updateIndex]);

  const next = useCallback(() => {
    if (!disabled && canGoNext) {
      updateIndex(activeIndex + 1);
    }
  }, [activeIndex, canGoNext, disabled, updateIndex]);

  useEffect(() => {
    if (itemCount === 0) return;

    const rawIndex = currentIndex ?? uncontrolledIndex;
    const clamped = clampIndex(rawIndex, itemCount);
    if (rawIndex !== clamped) {
      updateIndex(clamped);
    }
  }, [currentIndex, itemCount, uncontrolledIndex, updateIndex]);

  useEffect(() => {
    if (!keyboardNavigation || disabled) return;

    const element = viewportRef.current;
    if (!element) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const active = element.contains(document.activeElement) || element.matches(":hover");
      if (!active) return;
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") previous();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, keyboardNavigation, next, previous]);

  useEffect(() => {
    if (!onViewportWidthChange) return;

    const element = viewportRef.current;
    if (!element) return;

    const reportWidth = () => onViewportWidthChange(element.clientWidth);
    const resizeObserver = new ResizeObserver(reportWidth);

    resizeObserver.observe(element);
    reportWidth();

    return () => resizeObserver.disconnect();
  }, [onViewportWidthChange]);

  const shouldShowControls =
    !isLoading && hasMultipleItems && (showNavigation || showDots);
  const rootStyle =
    aspectRatio !== undefined
      ? ({ aspectRatio } as React.CSSProperties)
      : undefined;

  return (
    <div
      ref={viewportRef}
      className={cx(
        "relative w-full overflow-hidden",
        aspectRatio === undefined && !viewportClassName?.includes("aspect-") && "aspect-video",
        viewportClassName,
        className,
      )}
      style={rootStyle}
    >
      {isLoading && (loadingContent ?? <DefaultLoadingSkeleton />)}

      {!isLoading && itemCount === 0 && (
        <>{emptyContent ?? <DefaultLoadingSkeleton />}</>
      )}

      {!isLoading && itemCount > 0 && (
        <>
          {transition === "slide" ? (
            <div
              className="flex h-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ transform: `translateX(-${activeIndex * 100}%)` }}
            >
              {items.map((item, index) => (
                <div
                  key={getKey?.(item, index) ?? index}
                  className={cx("h-full w-full flex-shrink-0", slideClassName)}
                  aria-hidden={index !== activeIndex}
                >
                  {renderSlide({
                    item,
                    index,
                    isActive: index === activeIndex,
                    currentIndex: activeIndex,
                  })}
                </div>
              ))}
            </div>
          ) : (
            items.map((item, index) => (
              <div
                key={getKey?.(item, index) ?? index}
                className={cx(
                  "absolute inset-0 transition-opacity duration-500 ease-in-out",
                  index === activeIndex ? "z-10 opacity-100" : "z-0 opacity-0",
                  slideClassName,
                )}
                aria-hidden={index !== activeIndex}
              >
                {renderSlide({
                  item,
                  index,
                  isActive: index === activeIndex,
                  currentIndex: activeIndex,
                })}
              </div>
            ))
          )}

          {renderOverlay?.({
            currentIndex: activeIndex,
            itemCount,
            goTo: updateIndex,
            next,
            previous,
          })}
        </>
      )}

      {shouldShowControls && showNavigation && (
        <>
          <div className="absolute left-4 top-1/2 z-20 -translate-y-1/2">
            <CarouselNavigationButton
              direction="prev"
              onSelect={previous}
              disabled={disabled || !canGoPrevious}
              label={previousLabel}
            />
          </div>
          <div className="absolute right-4 top-1/2 z-20 -translate-y-1/2">
            <CarouselNavigationButton
              direction="next"
              onSelect={next}
              disabled={disabled || !canGoNext}
              label={nextLabel}
            />
          </div>
        </>
      )}

      {shouldShowControls && showDots && (
        <div className="absolute bottom-4 left-1/2 z-20 flex max-w-[90%] -translate-x-1/2 flex-wrap justify-center gap-2">
          {items.map((item, index) => (
            <button
              key={getKey?.(item, index) ?? index}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                updateIndex(index);
              }}
              disabled={disabled}
              aria-label={dotLabel(index)}
              aria-current={index === activeIndex}
              className={cx(
                "squishy size-2 shrink-0 rounded-full disabled:pointer-events-none disabled:opacity-40",
                index === activeIndex ? "bg-black" : "bg-white/70 hover:bg-white",
              )}
            />
          ))}
        </div>
      )}

      {!isLoading && itemCount > 0 && (
        <p className="sr-only" aria-live="polite">
          Slide {activeIndex + 1} of {itemCount}
        </p>
      )}
    </div>
  );
};

export default Carousel;
