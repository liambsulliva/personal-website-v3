/**
 * Figma glyph export → inline <svg> parts. Every painted fill/stroke becomes
 * currentColor (what the old alpha mask did), and ids are dropped so repeated
 * icons don't collide. Inline markup paints with the document; a masked
 * url() had to load (or revalidate) first, so icons blanked on every page
 * switch in iOS Safari.
 */
export function glyph(raw: string) {
  const viewBox = raw.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 24 24";
  const body = raw
    .replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, "")
    .replace(/\s+id="[^"]*"/g, "")
    .replace(/\b(fill|stroke)="(?!none")[^"]*"/g, '$1="currentColor"')
    // Figma writes 4+ decimals; 2 is 1/100px at 24px and keeps inlined HTML lean.
    .replace(/\bd="[^"]*"/g, (d) => d.replace(/\d*\.\d{3,}/g, (n) => String(+(+n).toFixed(2))))
    .replace(/<\/?g>/g, "") // Figma's bare wrapper group
    .replace(/>\s+</g, "><")
    .trim();
  return { viewBox, body };
}
