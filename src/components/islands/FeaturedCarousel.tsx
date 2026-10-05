import { useState } from "react";
import Carousel from "./Carousel";
import ProgressiveImage from "./ProgressiveImage";
import type { FeaturedSlide } from "../../lib/photos";

// Figma FeaturedCarousel (25:518) with v2's progressive loading: every slide
// shows its 480px placeholder; the active slide upgrades first, neighbours
// only once the active one is sharp. Slides are SSR'd (no fetch on mount).
const SLIDE_SIZES = "(min-width: 768px) min(calc(100vw - 128px), 1144px), calc(100vw - 48px)";

export default function FeaturedCarousel({ slides }: { slides: FeaturedSlide[] }) {
  const [current, setCurrent] = useState(0);
  const [sharp, setSharp] = useState<Set<string>>(new Set());

  const currentIsSharp = slides[current] ? sharp.has(slides[current].key) : false;
  const neighbours =
    slides.length > 1
      ? new Set([(current + 1) % slides.length, (current - 1 + slides.length) % slides.length])
      : new Set<number>();

  const markSharp = (key: string) =>
    setSharp((previous) => (previous.has(key) ? previous : new Set(previous).add(key)));

  return (
    <Carousel
      items={slides}
      getKey={(slide) => slide.key}
      currentIndex={current}
      onCurrentIndexChange={setCurrent}
      transition="slide"
      loop
      viewportClassName="aspect-[4/3] md:aspect-auto md:h-[560px] rounded-md bg-skeleton"
      slideClassName="relative"
      previousLabel="Previous photo"
      nextLabel="Next photo"
      dotLabel={(index) => `Show featured photo ${index + 1}`}
      renderSlide={({ item, index, isActive }) => (
        <ProgressiveImage
          placeholderSrc={item.placeholderSrc}
          srcSet={item.srcSet}
          sizes={SLIDE_SIZES}
          alt={`Featured photo ${index + 1}`}
          upgrade={isActive || (currentIsSharp && neighbours.has(index))}
          loading={index === 0 ? "eager" : "lazy"}
          draggable={false}
          onUpgradeLoad={() => markSharp(item.key)}
        />
      )}
    />
  );
}
