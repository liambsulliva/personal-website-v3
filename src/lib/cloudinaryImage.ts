export const PLACEHOLDER_WIDTH = 480;

export function cloudinaryTransform(
  secureUrl: string,
  transformation: string,
): string {
  return secureUrl.replace("/upload/", `/upload/${transformation}/`);
}

export function cappedWidths(
  steps: readonly number[],
  maxWidth: number,
): number[] {
  const cap = Math.round(maxWidth);
  return [...steps.filter((width) => width < cap), cap];
}

export function toSrcSet(
  candidates: ReadonlyArray<{ src: string; width: number }>,
): string {
  return candidates.map(({ src, width }) => `${src} ${width}w`).join(", ");
}
