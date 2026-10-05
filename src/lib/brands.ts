// Native artboard sizes of the Figma brand/* glyphs (public/brand).
// invertOnDark: black marks that vanish on the dark field (see BrandGlyph).
type BrandGlyph = {
  file: string;
  width: number;
  height: number;
  invertOnDark?: boolean;
};

const brands = {
  React: { file: "react.svg", width: 32, height: 32 },
  TypeScript: { file: "typescript.svg", width: 32, height: 32 },
  "Next.js": { file: "nextjs.svg", width: 32, height: 32, invertOnDark: true },
  MongoDB: { file: "mongodb.svg", width: 24, height: 24 },
  Svelte: { file: "svelte.svg", width: 28, height: 28 },
  Vite: { file: "vite.svg", width: 24, height: 23.65 },
  OpenAI: { file: "openai.svg", width: 24, height: 24 },
  "nx.js": { file: "nxjs.svg", width: 24, height: 23.55 },
  Express: { file: "express.svg", width: 32, height: 32 },
  Astro: { file: "astro.svg", width: 20, height: 25.18, invertOnDark: true },
  Tailwind: { file: "tailwind.svg", width: 32, height: 32 },
  Figma: { file: "figma.svg", width: 22.24, height: 32 },
  Docusaurus: { file: "docusaurus.svg", width: 32, height: 32 },
  Swift: { file: "swift.svg", width: 22, height: 22, invertOnDark: true },
  D3: { file: "d3.svg", width: 22, height: 22, invertOnDark: true },
  Photoshop: { file: "photoshop.svg", width: 24, height: 24 },
  CSS: { file: "css.svg", width: 24, height: 24 },
  esbuild: { file: "esbuild.svg", width: 24, height: 24 },
  Clojure: { file: "clojure.svg", width: 24, height: 24 },
  "Node.js": { file: "nodejs.svg", width: 24, height: 24 },
  Asana: { file: "asana.svg", width: 24, height: 24 },
  Elementor: { file: "elementor.svg", width: 24, height: 24 },
  WordPress: { file: "wordpress.svg", width: 24, height: 24 },
  Confluence: { file: "confluence.svg", width: 24, height: 24 },
  Jira: { file: "jira.svg", width: 24, height: 24 },
  "Adobe Experience Manager": { file: "aem.svg", width: 24, height: 24 },
  // Clarizen is now Planview AdaptiveWork; clarizen.com serves Planview's mark.
  Clarizen: { file: "clarizen.png", width: 24, height: 24 },
  Scrunch: { file: "scrunch.svg", width: 24, height: 24, invertOnDark: true },
} as const satisfies Record<string, BrandGlyph>;

export type BrandKey = keyof typeof brands;
export const BRANDS: Record<BrandKey, BrandGlyph> = brands;

export const isBrand = (name: string): name is BrandKey => name in BRANDS;

// Tool labels that borrow a parent brand's glyph.
const BRAND_ALIASES: Record<string, BrandKey> = {
  "OpenAI API": "OpenAI",
  "react-tela": "React",
  "CSS 3D": "CSS",
  "WordPress Elementor": "Elementor",
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
  clojure: "https://clojure.org/guides/getting_started",
  asana: "https://help.asana.com/",
  wordpresselementor: "https://elementor.com/help/",
  wordpress: "https://wordpress.org/documentation/",
  confluence: "https://support.atlassian.com/confluence-cloud/",
  jira: "https://support.atlassian.com/jira-software-cloud/",
  adobeexperiencemanager: "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service",
};

export const docsUrl = (tool: string) => DOCS[tool.toLowerCase().replace(/[.\s-]/g, "")];
