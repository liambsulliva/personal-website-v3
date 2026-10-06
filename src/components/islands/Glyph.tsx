import { glyph } from "../../lib/glyph";

/** Island twin of icons/Icon.astro: pass a `?raw` import of one ../icons/svg glyph. */
export default function Glyph({ svg, size = 24 }: { svg: string; size?: number }) {
  const { viewBox, body } = glyph(svg);
  return (
    <svg
      className="glyph"
      viewBox={viewBox}
      fill="none"
      preserveAspectRatio="none"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
