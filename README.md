## Introduction

This is v3 of my portfolio. The home page is a lobby, and each part of my work has its own room: Me, Career, Engineering, Design, Photography, and Writing. Each room has its own color, and the site has light and dark themes.

## Demo

The site is live at [liambsullivan.com](https://liambsullivan.com), hosted on Vercel.

Earlier versions are still published: [v2](https://v2.liambsullivan.com) and [v1](https://v1.liambsullivan.com). The "v3." button in the footer links to both.

## Features

- Light and dark themes, plus a system option. The theme is applied before the first paint, so pages never flash the wrong colors.
- A motion toggle (the zap button) that turns off decorative animation. The site also respects the operating system's reduced-motion setting.
- A lobby headline that types itself in once per browser session. With motion off or JavaScript disabled, the finished text shows immediately.
- Photography and Writing render their first photos and posts on the server, so they appear without waiting for JavaScript.
- A photography page with a featured carousel, tag filters, infinite scroll, and a lightbox.
- Berlin study-abroad posts pulled from WordPress on the server and cached for five minutes.
- Write-ups in MDX with a contents sidebar, interactive demos (the HERL book, the Switch menu embed, a Bezier playground, and PDF carousels), and Shiki code blocks in both themes.
- A 404 page with a camera focus dial you can twist.
- 301 redirects from v2 URLs, with or without a trailing slash, plus a sitemap and robots.txt.

## Content

Content lives in Astro content collections, validated with Zod in `src/content.config.ts`.

- `src/content/projects` holds Engineering and Design projects as MDX. A project with a body gets a write-up page. A project without one is a card that links out.
- `src/content/pieces` holds the Design and Writing cards as YAML.
- `src/content/career` holds the Career timeline as YAML.
- `src/pages/me.astro` holds the About text directly.

## Images

Site images live in Cloudinary under `site/`. Photography lives at the root of the same cloud and is filtered by tag.

- `scripts/cloudinary-map.mjs` maps each image's public ID to its source file.
- `npm run cloudinary:seed` uploads the mapped images and writes their sizes to `src/data/cloudinary-manifest.json`.
- An ID that isn't in the manifest yet renders as a gray skeleton and does not request the image. The same skeleton appears if an uploaded image fails to load.
- `npm run photos:tags -- add featured <public_id>` tags photos. The `featured` tag puts a photo in the Photography carousel. Run `npm run photos:tags` with no arguments for the full usage.

## API routes

All routes are read-only.

- `GET /api/cloudinary/search` returns a page of photos for one tag. It only accepts the gallery's own query shapes.
- `GET /api/cloudinary/tags` returns the public photo tags. It leaves out `featured` and tags that start with `_`.
- `GET /api/rawg/*` proxies RAWG for the Switch menu embed. It only answers requests from the embed, so the key never reaches the browser.

v2's upload, delete, and tag-editing routes and its admin dashboard are not part of this repo.

## Stack

- [Astro](https://astro.build/) with TypeScript, using the Vercel adapter for server-rendered pages and API routes
- [Tailwind CSS](https://tailwindcss.com/) 4
- [React](https://react.dev) for the photography, PDF, and demo islands
- [Svelte](https://svelte.dev) for the HERL book only
- [MDX](https://mdxjs.com/) for write-ups
- [Geist Sans](https://vercel.com/font) and [Martian Mono](https://github.com/evilmartians/mono), self-hosted
- [React Photo Album](https://react-photo-album.com/) and [Yet Another React Lightbox](https://yet-another-react-lightbox.com/)
- [PDF.js](https://mozilla.github.io/pdf.js/) for slide carousels
- [Shiki](https://shiki.style/) for syntax highlighting
- [Cloudinary](https://cloudinary.com/) for images
- [Vitest](https://vitest.dev/) for tests

## Environment variables

Create a `.env` file in the project root:

```bash
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
RAWG_API_KEY=your_rawg_api_key
```

Set the same variables on the Vercel project. Keep `RAWG_API_KEY` server-only, so don't prefix it with `PUBLIC_` or `VITE_`. Without it, the Switch embed's game data returns a 503.

The Switch menu bundle in `public/switch-menu` is published from the [switch-react-menu](https://github.com/liambsulliva/switch-react-menu) repo by a GitHub Action. Its `MAIN_SITE_REPO` variable decides which site repo receives the bundle.

## Commands

Run these from the project root. The project targets Node 24.x.

- `npm install` installs dependencies.
- `npm run dev` starts the development server.
- `npm run build` type-checks and builds for production.
- `npm test` runs the Vitest suite.
- `npm run test:build` builds first, then runs the suite, including the checks against the build output.
