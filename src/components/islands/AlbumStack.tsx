import { useId, type CSSProperties } from "react";
import type { AlbumCard, StackPhoto } from "../../lib/albumData";
import { springEasing } from "./lightboxFlight";
import ProgressiveImage from "./ProgressiveImage";

// Figma AlbumStack (190:586): three prints of a shoot, fanned on hover; in the
// carousel, or as a sub-album's tile in its parent's masonry (`tile`), where
// the same proportions scale to the column. The
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
  /** A tile in the masonry: as wide as its column, with the layout's gap below. */
  tile?: Pick<CSSProperties, "marginBottom">;
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

// 176×220 at the box's left edge; the room on the right (and the track's
// padding above) is where the fan swings. A tile's print takes 86% of the
// column, which leaves just room for the prints behind it at rest; the fan
// swings into the masonry's gaps.
const CARD_BOX = "absolute top-4 left-0 block h-[220px] w-[176px]";
const TILE_CARD_BOX = "absolute bottom-0 left-0 block aspect-[4/5] w-[86%]";

function StackCard({ index, photo, box }: { index: number; photo?: StackPhoto; box: string }) {
  return (
    // Transform + opacity only (CSS).
    <span data-album-card={index} className={`album-card ${box}`}>
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

/** "Jul 2026 · 12 photos": too wide for a phone's column, so a line each there. */
function TileDetails({ details }: { details: string }) {
  return details.split(" · ").map((part, i) => (
    <span key={i} className="block truncate md:inline">
      {i > 0 && <span className="hidden md:inline"> · </span>}
      {part}
    </span>
  ));
}

export default function AlbumStack({ album, open, load, disabled, tile, onSelect }: AlbumStackProps) {
  const detailsId = useId();
  const box = tile ? TILE_CARD_BOX : CARD_BOX;
  return (
    <button
      type="button"
      data-album-stack={album.path}
      aria-pressed={open}
      aria-label={`${open ? "Close" : "Open"} album ${album.title}`}
      aria-describedby={detailsId}
      disabled={disabled}
      onClick={(event) => onSelect(album, event.currentTarget)}
      className={`album-stack squishy squishy-stack flex shrink-0 flex-col items-stretch text-left ${tile ? "w-full gap-2 md:gap-3" : "w-[232px] gap-3"}`}
      style={tile ? { ...STACK_STYLE, ...tile } : STACK_STYLE}
    >
      <span data-album-cards className={`relative block w-full ${tile ? "aspect-[100/117]" : "h-[236px]"}`}>
        {/* State=Open placeholder at the top card's footprint; behind the
            cards so they cover it as the flight brings them home. */}
        <span
          data-album-dropzone
          aria-hidden="true"
          className={`${box} rounded-md border-[1.5px] border-dashed border-border bg-skeleton/60 ${
            open ? "opacity-100" : "opacity-0"
          }`}
        />
        {CARD_ORDER.filter((index) => index < Math.max(1, album.previews.length)).map((index) => (
          <StackCard key={index} index={index} box={box} photo={load ? album.previews[index] : undefined} />
        ))}
      </span>
      <span className={`flex min-w-0 flex-col pl-1 ${tile ? "pb-2 md:pb-0" : ""}`}>
        <span className={`font-semibold text-fg ${tile ? "line-clamp-2 text-[13px] leading-[18px] wrap-anywhere md:text-[16px] md:leading-6" : "truncate text-[16px] leading-6"}`}>
          {album.title}
        </span>
        <span id={detailsId} className={`text-muted ${tile ? "text-[12px] leading-4 md:truncate md:text-[14px] md:leading-5" : "truncate text-[14px] leading-5"}`}>
          {tile ? <TileDetails details={album.details} /> : album.details}
        </span>
      </span>
    </button>
  );
}
