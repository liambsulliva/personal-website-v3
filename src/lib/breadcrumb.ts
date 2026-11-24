// The header's trail (Breadcrumb.astro), kept in step by an island that moves
// between levels without loading a page.

type Crumb = { label: string; href: string };

const items = () => [...document.querySelectorAll<HTMLElement>("[data-breadcrumb] [data-crumb]")];

/** Shows `crumbs`, the last one current. The server's own are left alone when they already say it. */
export function showBreadcrumb(crumbs: readonly Crumb[]) {
  const shown = items();
  const list = shown[0]?.parentElement;
  if (!list) return;
  const link = (item: HTMLElement) => item.querySelector("a")!;
  if (shown.length === crumbs.length && crumbs.every(({ label, href }, i) => link(shown[i]).textContent?.trim() === label && link(shown[i]).getAttribute("href") === href)) return;
  const next = crumbs.map(({ label, href }, i) => {
    const current = i === crumbs.length - 1;
    // Copied, so it keeps the attribute Breadcrumb's scoped styles match on.
    const item = shown[0].cloneNode(true) as HTMLElement;
    const a = link(item);
    a.textContent = label;
    a.setAttribute("href", href);
    a.classList.toggle("breadcrumb__link--current", current);
    if (current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
    return item;
  });
  shown.forEach((item) => item.remove());
  list.append(...next);
}

/** Calls `open(url)` for a plain click on a crumb; it returns true when it took the click. */
export function onBreadcrumb(open: (url: URL) => boolean) {
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const a = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("[data-breadcrumb] [data-crumb] a") : null;
    if (a && open(new URL(a.href))) event.preventDefault();
  };
  document.addEventListener("click", click);
  return () => document.removeEventListener("click", click);
}
