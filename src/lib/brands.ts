// Native artboard sizes of the Figma brand/* glyphs (public/brand).
export const BRANDS = {
  React: { file: "react.svg", width: 32, height: 32 },
  TypeScript: { file: "typescript.svg", width: 32, height: 32 },
  "Next.js": { file: "nextjs.svg", width: 32, height: 32 },
  MongoDB: { file: "mongodb.svg", width: 24, height: 24 },
  Svelte: { file: "svelte.svg", width: 28, height: 28 },
  Vite: { file: "vite.svg", width: 24, height: 23.65 },
  OpenAI: { file: "openai.svg", width: 24, height: 24 },
  "nx.js": { file: "nxjs.svg", width: 24, height: 23.55 },
  Express: { file: "express.svg", width: 32, height: 32 },
  Astro: { file: "astro.svg", width: 20, height: 25.18 },
  Tailwind: { file: "tailwind.svg", width: 32, height: 32 },
  Figma: { file: "figma.svg", width: 22.24, height: 32 },
  Docusaurus: { file: "docusaurus.svg", width: 32, height: 32 },
  Swift: { file: "swift.svg", width: 22, height: 22 },
  D3: { file: "d3.svg", width: 22, height: 22 },
  Photoshop: { file: "photoshop.svg", width: 24, height: 24 },
  CSS: { file: "css.svg", width: 24, height: 24 },
  esbuild: { file: "esbuild.svg", width: 24, height: 24 },
} as const;

export type BrandKey = keyof typeof BRANDS;

export const isBrand = (name: string): name is BrandKey => name in BRANDS;

// Tool labels that borrow a parent brand's glyph.
const BRAND_ALIASES: Record<string, BrandKey> = {
  "OpenAI API": "OpenAI",
  "react-tela": "React",
  "CSS 3D": "CSS",
};

/** Glyph for a badge label (direct brand or alias), if any. */
export const brandFor = (label: string): BrandKey | undefined =>
  isBrand(label) ? label : BRAND_ALIASES[label];

// GitHub linguist colors (Figma lang/* variables).
export const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  CSS: "#663399",
  HTML: "#e34c26",
  Svelte: "#ff3e00",
  Swift: "#f05138",
  Astro: "#ff5a03",
};

// Documentation for each tool badge (Engineering cards + write-up tool rows).
const DOCS: Record<string, string> = {
  react: "https://react.dev/learn",
  typescript: "https://www.typescriptlang.org/docs/",
  nextjs: "https://nextjs.org/docs",
  nodejs: "https://nodejs.org/docs/latest/api/",
  tailwind: "https://tailwindcss.com/docs",
  astro: "https://docs.astro.build/",
  svelte: "https://svelte.dev/docs",
  mongodb: "https://www.mongodb.com/docs/",
  figma: "https://help.figma.com/",
  photoshop: "https://helpx.adobe.com/photoshop/user-guide.html",
  express: "https://expressjs.com/en/guide/routing.html",
  openai: "https://platform.openai.com/docs",
  openaiapi: "https://platform.openai.com/docs",
  css3d: "https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_transforms/Using_CSS_transforms#3d_specific_css_properties",
  vite: "https://vite.dev/guide/",
  nxjs: "https://nxjs.n8.io/",
  reacttela: "https://github.com/TooTallNate/react-tela#readme",
  esbuild: "https://esbuild.github.io/getting-started/",
  docusaurus: "https://docusaurus.io/docs",
  swift: "https://www.swift.org/documentation/",
  d3: "https://d3js.org/getting-started",
};

export const docsUrl = (tool: string) => DOCS[tool.toLowerCase().replace(/[.\s-]/g, "")];
