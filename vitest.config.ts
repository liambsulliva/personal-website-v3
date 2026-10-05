/// <reference types="vitest" />
import { getViteConfig } from "astro/config";

// Astro's Vite config, so tests can import `astro:content` and render
// components through the Container API.
export default getViteConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
