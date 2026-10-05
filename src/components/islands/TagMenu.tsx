import { useEffect, useRef, useState, type CSSProperties } from "react";

// v2 CloudinaryMenu: one horizontally scrolling row of Figma Chips, with
// edge fades + chevron buttons that appear only while there is overflow.

type Props = {
  tags: string[];
  /** "" = All; null = none (an album fills the gallery). */
  selected: string | null;
  onSelect: (tag: string) => void;
};

const titleCase = (tag: string) =>
  tag
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

function Chip({ label, selected, onSelect }: { label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`chip squishy squishy-md flex shrink-0 items-center rounded-pill border px-4 py-2 text-[16px] leading-[1.5] whitespace-nowrap ${
        selected ? "chip--selected border-fg bg-fg text-bg" : "border-border bg-control text-muted"
      }`}
    >
      {label}
    </button>
  );
}

function ScrollButton({ direction, onClick }: { direction: "left" | "right"; onClick: () => void }) {
  return (
    <div
      className={`pointer-events-none absolute top-0 z-10 flex h-full w-24 items-center ${
        direction === "left" ? "left-0 justify-start bg-gradient-to-r" : "right-0 justify-end bg-gradient-to-l"
      } from-bg to-transparent`}
    >
      <button
        type="button"
        onClick={onClick}
        className="squishy pointer-events-auto flex size-9 items-center justify-center text-fg"
        aria-label={`Scroll tags ${direction}`}
      >
        <span
          className="glyph"
          style={{ "--glyph": `url(/icons/chevron-${direction}.svg)`, width: 20, height: 20 } as CSSProperties}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

export default function TagMenu({ tags, selected, onSelect }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const check = () => {
      const overflow = row.scrollWidth > row.clientWidth + 1;
      setCanLeft(overflow && row.scrollLeft > 1);
      setCanRight(overflow && row.scrollLeft < row.scrollWidth - row.clientWidth - 1);
    };
    check();
    row.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      row.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, [tags]);

  const scrollBy = (delta: number) =>
    rowRef.current?.scrollBy({
      left: delta,
      behavior: document.documentElement.hasAttribute("data-reduced-motion") ? "auto" : "smooth",
    });

  return (
    <div className="relative w-full min-w-0" data-name="TagRow">
      {canLeft && <ScrollButton direction="left" onClick={() => scrollBy(-200)} />}
      <div
        ref={rowRef}
        className="tag-menu flex w-full flex-nowrap items-start gap-2 overflow-x-auto"
        role="group"
        aria-label="Filter photos by tag"
      >
        <Chip label="All" selected={selected === ""} onSelect={() => onSelect("")} />
        {tags.map((tag) => (
          <Chip key={tag} label={titleCase(tag)} selected={selected === tag} onSelect={() => onSelect(tag)} />
        ))}
      </div>
      {canRight && <ScrollButton direction="right" onClick={() => scrollBy(200)} />}
    </div>
  );
}
