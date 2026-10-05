import { useState } from "react";

// v2 ProgressiveImage (commit d0baf91): skeleton → 480px placeholder → srcset
// upgrade that, once requested, stays requested. v3 additions: site tokens for
// the skeleton, and catching placeholders that finished loading before SSR
// hydration attached onLoad.
interface ProgressiveImageProps {
  placeholderSrc: string;
  srcSet?: string;
  sizes?: string;
  alt: string;
  upgrade?: boolean;
  loading?: "eager" | "lazy";
  draggable?: boolean;
  objectFit?: "cover" | "fill";
  /** false: the placeholder appears without its opacity fade (lightbox
   *  handoff, where it must be opaque on its first painted frame). */
  fadeIn?: boolean;
  onUpgradeLoad?: () => void;
}

export default function ProgressiveImage({
  placeholderSrc,
  srcSet,
  sizes,
  alt,
  upgrade = true,
  loading = "lazy",
  draggable,
  objectFit = "cover",
  fadeIn = true,
  onUpgradeLoad,
}: ProgressiveImageProps) {
  const baseClassName = `absolute inset-0 h-full w-full ${objectFit === "fill" ? "object-fill" : "object-cover"}`;
  const layerClassName = `${baseClassName} transition-opacity duration-300`;
  const placeholderClassName = fadeIn ? layerClassName : baseClassName;
  const [placeholderLoaded, setPlaceholderLoaded] = useState(false);
  const [upgradeRequested, setUpgradeRequested] = useState(upgrade);
  const [upgradeLoaded, setUpgradeLoaded] = useState(false);

  if (upgrade && !upgradeRequested) {
    setUpgradeRequested(true);
  }

  return (
    <>
      {!placeholderLoaded && <div className="absolute inset-0 animate-pulse bg-skeleton" />}
      <img
        src={placeholderSrc}
        alt={alt}
        loading={loading}
        decoding="async"
        draggable={draggable}
        className={`${placeholderClassName} ${placeholderLoaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setPlaceholderLoaded(true)}
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0 && !placeholderLoaded) setPlaceholderLoaded(true);
        }}
      />
      {srcSet && upgradeRequested && placeholderLoaded && (
        <img
          // `sizes` must be set before `srcSet` and `src` so the first
          // candidate selection sees it.
          sizes={sizes}
          srcSet={srcSet}
          src={placeholderSrc}
          alt=""
          aria-hidden
          loading={loading}
          decoding="async"
          draggable={draggable}
          className={`${layerClassName} ${upgradeLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => {
            setUpgradeLoaded(true);
            onUpgradeLoad?.();
          }}
        />
      )}
    </>
  );
}
