// Lobby background cube: a slowly rotating wireframe behind the UI, desktop
// only. Invisible until the first section link is hovered (or the cube toggle
// is switched on), then it takes the color of the last hovered link. Three.js
// is fetched lazily, so mobile, zap-off and cube-off visitors never load it.

const root = document.documentElement;
const canvas = document.querySelector<HTMLCanvasElement>(".lobby-cube");
const desktop = matchMedia("(min-width: 768px) and (hover: hover)");

// Matches the canvas opacity transition in pages/index.astro.
const FADE_MS = 700;

type Scene = import("./cubeScene").CubeScene;

let revealed = false;
// Whose computed `color` the cube wears: <html> (--fg) until a link is hovered.
let source: Element = root;
let scene: Promise<Scene | null> | null = null;
let current: Scene | null = null;
let raf = 0;
let last = 0;
let stopAt = Infinity;

const isReduced = () => root.hasAttribute("data-reduced-motion");
const enabled = () => desktop.matches && !isReduced() && !root.hasAttribute("data-cube-off");
const colorOf = (el: Element) => getComputedStyle(el).color;

const ensureScene = () => {
  if (!scene && canvas) {
    // No WebGL: stay hidden.
    scene = import("./cubeScene")
      .then(({ createScene }) => createScene(canvas))
      .catch(() => null)
      .then((s) => (current = s));
  }
  return scene ?? Promise.resolve(null);
};

const tick = (now: number) => {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  current?.frame(dt);
  if (now >= stopAt) {
    raf = 0;
    return;
  }
  raf = requestAnimationFrame(tick);
};

const startLoop = () => {
  stopAt = Infinity;
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
};

async function update() {
  if (!canvas) return;

  if (!(revealed && enabled())) {
    canvas.classList.remove("is-visible");
    // Keep drawing through the fade-out; zap-off has no fade.
    if (isReduced() || !desktop.matches) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else if (raf) {
      stopAt = performance.now() + FADE_MS;
    }
    return;
  }

  const s = await ensureScene();
  if (!s || !(revealed && enabled())) return;
  s.setColor(colorOf(source));
  s.frame(0);
  startLoop();
  canvas.classList.add("is-visible");
}

if (canvas) {
  document.querySelectorAll(".lobby-nav .navlink").forEach((link) => {
    const take = () => {
      source = link;
      revealed = true;
      void update();
    };
    link.addEventListener("pointerenter", take);
    link.addEventListener("focusin", take);
  });

  document.addEventListener("cubechange", (event) => {
    if ((event as CustomEvent<{ on: boolean }>).detail.on) revealed = true;
    void update();
  });
  document.addEventListener("motionchange", () => void update());
  desktop.addEventListener("change", () => void update());

  addEventListener("resize", () => current?.resize());

  // Accents differ per theme. Re-read once the token tween has settled.
  let recolor = 0;
  new MutationObserver(() => {
    clearTimeout(recolor);
    recolor = window.setTimeout(() => {
      current?.setColor(colorOf(source));
    }, 250);
  }).observe(root, { attributes: true, attributeFilter: ["class", "data-theme"] });
}

export {};
