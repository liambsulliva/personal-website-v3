import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import svelte from "@astrojs/svelte";
import mdx from "@astrojs/mdx";
import vercel from "@astrojs/vercel";
import tailwindcss from "@tailwindcss/vite";
import rehypeExternalLinks from "rehype-external-links";
import slashSafeRedirects from "./integrations/slashSafeRedirects.mjs";

// https://astro.build/config
export default defineConfig({
  site: "https://liambsullivan.com",
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  integrations: [react(), svelte(), mdx(), slashSafeRedirects()],
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark-default" },
      wrap: false,
    },
    rehypePlugins: [
      [rehypeExternalLinks, { target: "_blank", rel: ["noopener", "noreferrer"] }],
    ],
  },
  adapter: vercel(),
  redirects: {
    "/other-work": { status: 301, destination: "/design" },
    "/projects/kingdra-app": { status: 301, destination: "/engineering/kingdra-app" },
    "/projects/herl-app": { status: 301, destination: "/engineering/herl-app" },
    "/projects/switch-react-menu": { status: 301, destination: "/engineering/switch-react-menu" },
    "/projects/the-invisible-hand-of-ux": { status: 301, destination: "/engineering/the-invisible-hand-of-ux" },
    "/projects/bridge-app": { status: 301, destination: "/engineering/bridge-app" },
    "/ux/kingdra-case-study": { status: 301, destination: "/design/kingdra-case-study" },
  },
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        // Dev JSX compiles to jsx-dev-runtime; if Vite discovers it (or the
        // island client) at runtime it re-bundles mid-session and pages end up
        // with two React copies ("Cannot read properties of null (useRef)").
        "react/jsx-dev-runtime",
        "@astrojs/react/client.js",
        "react-photo-album",
        "yet-another-react-lightbox",
        "yet-another-react-lightbox/plugins/zoom",
        "pdfjs-dist",
      ],
    },
  },
});
