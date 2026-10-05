// Theme (light → dark → system) and motion (zap) controls. Icon and tooltip
// state is pure CSS keyed off
// html[data-theme] / html[data-reduced-motion].

type Theme = "light" | "dark" | "system";

const root = document.documentElement;
const systemDark = matchMedia("(prefers-color-scheme: dark)");
const systemReduced = matchMedia("(prefers-reduced-motion: reduce)");

const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const applyTheme = (theme: Theme) => {
  root.dataset.theme = theme;
  root.classList.toggle(
    "dark",
    theme === "dark" || (theme === "system" && systemDark.matches),
  );
};

const NEXT_THEME: Record<Theme, Theme> = {
  light: "dark",
  dark: "system",
  system: "light",
};

const isReduced = () => root.hasAttribute("data-reduced-motion");

const applyMotion = (reduced: boolean) => {
  root.toggleAttribute("data-reduced-motion", reduced);
  document.dispatchEvent(new CustomEvent("motionchange", { detail: { reduced } }));
};

document.addEventListener("click", (event) => {
  const target = event.target as Element | null;

  if (target?.closest("[data-theme-toggle]")) {
    const current = (root.dataset.theme as Theme) || "light";
    const next = NEXT_THEME[current] ?? "light";
    store("theme", next);
    applyTheme(next);
    return;
  }

  if (target?.closest("[data-motion-toggle]")) {
    const next = !isReduced();
    store("motion", next ? "reduced" : "full");
    applyMotion(next);
    return;
  }
});

systemDark.addEventListener("change", () => {
  if (root.dataset.theme === "system") applyTheme("system");
});

systemReduced.addEventListener("change", (event) => {
  if (!read("motion")) applyMotion(event.matches);
});

export {};
