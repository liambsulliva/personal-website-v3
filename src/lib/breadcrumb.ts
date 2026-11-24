// The header's trail (Breadcrumb.astro), kept in step by an island that moves
// between levels without loading a page, and fitted to the header: the levels
// that would run into the menu button give way to a last "/ ...".

type Crumb = { label: string; href: string };

const items = () => [...document.querySelectorAll<HTMLElement>("[data-breadcrumb] [data-crumb]")];

const link = (item: HTMLElement) => item.querySelector("a")!;

/** Shows as many levels as fit on the line, from the top. `...` opens the first that doesn't. */
export function fitBreadcrumb() {
  const shown = items();
  const list = shown[0]?.parentElement;
  const more = list?.querySelector<HTMLElement>("[data-crumb-more]");
  if (!list || !more) return;
  // Both are rounded, so a line that just fits can be a pixel over.
  const over = () => list.scrollWidth > list.clientWidth + 1;
  shown.forEach((item) => (item.hidden = false));
  more.hidden = true;
  if (!over()) return;
  more.hidden = false;
  const hidden: HTMLElement[] = [];
  while (over() && shown.length) {
    const item = shown.pop()!;
    item.hidden = true;
    hidden.unshift(item);
  }
  if (!hidden.length) return void (more.hidden = true);
  const a = link(more);
  a.href = link(hidden[0]).href;
  a.setAttribute("aria-label", hidden.map((item) => link(item).textContent?.trim()).join(" / "));
  // Only the current page is behind it: it's that page's crumb.
  const current = hidden.length === 1;
  a.classList.toggle("breadcrumb__link--current", current);
  if (current) a.setAttribute("aria-current", "page");
  else a.removeAttribute("aria-current");
}

/** Keeps it fitted as the header's width or the fonts change. */
export function watchBreadcrumb() {
  const bar = document.querySelector("[data-breadcrumb]")?.parentElement;
  if (!bar) return;
  new ResizeObserver(fitBreadcrumb).observe(bar);
  void document.fonts?.ready.then(fitBreadcrumb);
}

/** Shows `crumbs`, the last one current. The server's own are left alone when they already say it. */
export function showBreadcrumb(crumbs: readonly Crumb[]) {
  const shown = items();
  const list = shown[0]?.parentElement;
  if (!list) return;
  if (shown.length === crumbs.length && crumbs.every(({ label, href }, i) => link(shown[i]).textContent?.trim() === label && link(shown[i]).getAttribute("href") === href)) return fitBreadcrumb();
  const next = crumbs.map(({ label, href }, i) => {
    const current = i === crumbs.length - 1;
    // Copied, so it keeps the attribute Breadcrumb's scoped styles match on.
    const item = shown[0].cloneNode(true) as HTMLElement;
    item.hidden = false;
    const a = link(item);
    a.textContent = label;
    a.setAttribute("href", href);
    a.classList.toggle("breadcrumb__link--current", current);
    if (current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
    return item;
  });
  shown.at(-1)!.after(...next);
  shown.forEach((item) => item.remove());
  fitBreadcrumb();
}

/** Calls `open(url)` for a plain click on a crumb; it returns true when it took the click. */
export function onBreadcrumb(open: (url: URL) => boolean) {
  const click = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const a = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("[data-breadcrumb] :is([data-crumb], [data-crumb-more]) a") : null;
    if (a && open(new URL(a.href))) event.preventDefault();
  };
  document.addEventListener("click", click);
  return () => document.removeEventListener("click", click);
}
