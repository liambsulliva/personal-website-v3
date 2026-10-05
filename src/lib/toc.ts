/**
 * Write-up TOC: generated from the MDX body's <SectionHeading /> h2s.
 * Label = toc ?? eyebrow ?? title (Figma "Contents" column uses short labels).
 */
export type TocItem = { id: string; label: string };

const ATTR = /(\w+)=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g;

export function tocFromBody(body: string | undefined): TocItem[] {
  if (!body) return [];
  const items: TocItem[] = [];
  for (const match of body.matchAll(/<SectionHeading\b([^>]*?)\/>/g)) {
    const attrs: Record<string, string> = {};
    for (const [, key, a, b, c] of match[1].matchAll(ATTR)) attrs[key] = a ?? b ?? c ?? "";
    if (!attrs.id) continue;
    const label = attrs.toc ?? attrs.eyebrow ?? attrs.title ?? attrs.id;
    items.push({ id: attrs.id, label: label.charAt(0).toUpperCase() + label.slice(1) });
  }
  return items;
}
