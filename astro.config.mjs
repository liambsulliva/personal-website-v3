import { defineConfig, envField } from "astro/config";
import react from "@astrojs/react";
import svelte from "@astrojs/svelte";
import mdx from "@astrojs/mdx";
import vercel from "@astrojs/vercel";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import rehypeExternalLinks from "rehype-external-links";
import slashSafeRedirects from "./integrations/slashSafeRedirects.mjs";
import criticalCss from "./integrations/criticalCss.mjs";
import { astroRedirects } from "./src/lib/redirects.mjs";

// Where this build runs: `vercel` (default, what main deploys today) or
// `node` (the NAS container, docs/self-host-plan.md). The Vercel path and
// everything only it needs go once the cutover has soaked.
const DEPLOY_TARGET = process.env.DEPLOY_TARGET || "vercel";
if (DEPLOY_TARGET !== "vercel" && DEPLOY_TARGET !== "node") {
  throw new Error(`DEPLOY_TARGET must be "vercel" or "node", not "${DEPLOY_TARGET}"`);
}
const onNode = DEPLOY_TARGET === "node";

// Hosts the server may take its URL from. Without a match Astro ignores the
// Host and X-Forwarded-Host headers and the request URL becomes
// https://localhost/…, which fails every same-origin check (the RAWG proxy).
// The protocol pattern also limits which X-Forwarded-Proto values it trusts.
const ALLOWED_HOSTS = ["liambsullivan.com", "www.liambsullivan.com", "staging.liambsullivan.com"];

// https://astro.build/config
export default defineConfig({
  site: "https://liambsullivan.com",
  trailingSlash: "ignore",
  devToolbar: { enabled: false },
  // slashSafeRedirects rewrites .vercel/output, which only the Vercel build writes.
  integrations: [react(), svelte(), mdx(), ...(onNode ? [] : [slashSafeRedirects()]), criticalCss()],
  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark-default" },
      wrap: false,
    },
    rehypePlugins: [
      [rehypeExternalLinks, { target: "_blank", rel: ["noopener", "noreferrer"] }],
    ],
  },
  // Standalone, not middleware: its handler serves dist/client before the app.
  // server.mjs imports that handler with autostart off and wraps it.
  adapter: onNode ? node({ mode: "standalone" }) : vercel(),
  security: {
    allowedDomains: ALLOWED_HOSTS.map((hostname) => ({ protocol: "https", hostname })),
  },
  env: {
    // Read through src/lib/serverEnv.ts, which says why.
    schema: {
      CLOUDINARY_CLOUD_NAME: envField.string({ context: "server", access: "secret", optional: true }),
      CLOUDINARY_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      CLOUDINARY_API_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
      IMAGE_BACKEND: envField.string({ context: "server", access: "secret", optional: true }),
      PHOTO_INDEX_FILE: envField.string({ context: "server", access: "secret", optional: true }),
      RAWG_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
  // Legacy v2 URLs: src/lib/redirects.mjs.
  redirects: astroRedirects(),
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
