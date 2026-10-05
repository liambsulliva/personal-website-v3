import { useId, type CSSProperties } from "react";
import type { AlbumCard, StackPhoto } from "../../lib/albums";
import { springEasing } from "./lightboxFlight";
import ProgressiveImage from "./ProgressiveImage";

// Figma AlbumStack (190:586): three prints of a shoot, fanned on hover. The
// button and its [data-album-stack] / [data-album-card] hooks are what
// PhotoGallery's explode flight measures; the motion itself lives in
// global.css (Album stacks).

type AlbumStackProps = {
  album: AlbumCard;
  /** State=Open: the cards have exploded into the gallery. */
  open: boolean;
  /** Request the card photos. False (off in the carousel): gray prints. */
  load: boolean;
  disabled?: boolean;
  onSelect: (album: AlbumCard, button: HTMLButtonElement) => void;
};

// Same spring family as the lightbox flights, so the stack and the explode
// feel like one material. 0.59 ≈ 10% overshoot (fan in, close settle); 0.8 is
// the calmer fan out.
const STACK_STYLE = {
  "--stack-spring": springEasing(0.59),
  "--stack-spring-out": springEasing(0.8),
} as CSSProperties;

// Back → front in DOM order, so the top card paints last.
const CARD_ORDER = [2, 1, 0];

function StackCard({ index, photo }: { index: number; photo?: StackPhoto }) {
  return (
    // 176×220 at the box's left edge; the room on the right (and the track's
    // padding above) is where the fan swings. Transform + opacity only (CSS).
    <span data-album-card={index} className="album-card absolute top-4 left-0 block h-[220px] w-[176px]">
      {/* Print: a 4px white border inside the box, so the photo sits within
          it. White in dark mode too: a print stays white on a dark table. */}
      <span className="album-card__print absolute inset-0 block overflow-hidden rounded-md border-4 border-white bg-skeleton">
        {photo && (
          <ProgressiveImage
            placeholderSrc={photo.src}
            // Decorative: the button's aria-label names the album.
            alt=""
            draggable={false}
          />
        )}
      </span>
    </span>
  );
}

export default function AlbumStack({ album, open, load, disabled, onSelect }: AlbumStackProps) {
  const detailsId = useId();
  return (
    <button
      type="button"
      data-album-stack={album.slug}
      aria-pressed={open}
      aria-label={`${open ? "Close" : "Open"} album ${album.title}`}
      aria-describedby={detailsId}
      disabled={disabled}
      onClick={(event) => onSelect(album, event.currentTarget)}
      className="album-stack squishy squishy-stack flex w-[232px] shrink-0 flex-col items-stretch gap-3 text-left"
      style={STACK_STYLE}
    >
      <span data-album-cards className="relative block h-[236px] w-full">
        {/* State=Open placeholder at the top card's footprint; behind the
            cards so they cover it as the flight brings them home. */}
        <span
          data-album-dropzone
          aria-hidden="true"
          className={`absolute top-4 left-0 block h-[220px] w-[176px] rounded-md border-[1.5px] border-dashed border-border bg-skeleton/60 ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        {CARD_ORDER.map((index) => (
          <StackCard key={index} index={index} photo={load ? album.previews[index] : undefined} />
        ))}
      </span>
      <span className="flex min-w-0 flex-col pl-1">
        <span className="truncate text-[16px] leading-6 font-semibold text-fg">{album.title}</span>
        <span id={detailsId} className="truncate text-[14px] leading-5 text-muted">{album.details}</span>
      </span>
    </button>
  );
}
