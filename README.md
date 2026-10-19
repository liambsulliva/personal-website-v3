<p align="center">
  <a href="https://liambsullivan.com"><img alt="Live site" src="https://img.shields.io/badge/live-liambsullivan.com-2563EB"></a>
  <a href="https://astro.build"><img alt="Astro 5" src="https://img.shields.io/badge/Astro-5-FF5D01?logo=astro&amp;logoColor=white"></a>
  <a href="https://vercel.com"><img alt="Hosted on Vercel" src="https://img.shields.io/badge/hosted-Vercel-000000?logo=vercel&amp;logoColor=white"></a>
  <a href="https://react.dev"><img alt="React 18" src="https://img.shields.io/badge/React-18-149ECA?logo=react&amp;logoColor=white"></a>
  <a href="https://tailwindcss.com"><img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?logo=tailwindcss&amp;logoColor=white"></a>
  <a href=".nvmrc"><img alt="Node 24" src="https://img.shields.io/badge/Node-24-5FA04E?logo=nodedotjs&amp;logoColor=white"></a>
  <a href="#tests"><img alt="Tested with Vitest" src="https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&amp;logoColor=white"></a>
</p>

This is v3 of my portfolio. The home page is a lobby, and each component of my work has its own room: Me, Career, Engineering, Design, Photography, and Writing. Each room gets its own color, and the site has light and dark themes.

The earlier versions are still online at [v2](https://v2.liambsullivan.com) and [v1](https://v1.liambsullivan.com). The version switcher on the logo lists all three. v2 had an admin dashboard for uploads and tag editing, and v3 moves it into a separate instance. Content lives in files in this repo, and photo tagging is set from the terminal.

> [!NOTE]
> The site has no database. Its API routes are read-only, and its content ships as files in this repo. Photo tags change only when you run a script locally.

[Open liambsullivan.com](https://liambsullivan.com)

---

## What it does

**The lobby types itself in.** The lobby headline types in once per browser session. With motion off or JavaScript disabled, the finished text shows at once.

**Themes without a flash.** The site has light and dark themes and a system option. The theme applies before the first paint, so pages never show the wrong colors.

**Motion you can turn off.** The zap button turns off decorative animation. The site also follows the operating system's reduced-motion setting.

**Photos and posts without waiting for JavaScript.** Photography and Writing render their first photos and posts on the server. The photography page adds a featured carousel, tag filters, infinite scroll, and a lightbox.

**Write-ups with working demos.** Write-ups are MDX with a contents sidebar. Interactive demos include the HERL book, the Switch menu embed, a Bezier playground, and PDF carousels. Code blocks use Shiki in both themes.

**Berlin posts from WordPress.** The Writing page fetches study-abroad posts from WordPress on the server. The CDN caches the response for five minutes. If WordPress is down, the rest of the page still renders.

**A 404 page with a camera focus dial.** You can twist the dial for fun!

**Old links keep working.** 301 redirects send v2 URLs to their v3 pages, with or without a trailing slash. The site also serves a sitemap and robots.txt.

## The rooms

| Room        | Route          | Source                                                                    | What it shows                                |
| ----------- | -------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| Me          | `/me`          | `src/pages/me.astro`                                                      | The About text, written directly in the page |
| Career      | `/career`      | `src/content/career`                                                      | The timeline of jobs and education           |
| Engineering | `/engineering` | `src/content/entries` and `src/content/sections/engineering.yaml`         | Projects, as cards or write-ups              |
| Design      | `/design`      | `src/content/entries` and `src/content/sections/design.yaml`              | Design work, as cards or write-ups           |
| Photography | `/photography` | Cloudinary and `src/content/albums`                                       | Galleries and album stacks                   |
| Writing     | `/writing`     | `src/content/entries`, `src/content/sections/writing.yaml`, and WordPress | Posts and the Berlin study-abroad feed       |

## Content

Content lives in Astro content collections. Zod schemas in `src/content.config.ts` check every file.

| Collection | Path                   | Format | What it holds                                                               |
| ---------- | ---------------------- | ------ | --------------------------------------------------------------------------- |
| `entries`  | `src/content/entries`  | MDX    | Every card and write-up on Engineering, Design, and Writing                 |
| `sections` | `src/content/sections` | YAML   | One file per wing, with the page's sections, their layouts, and their order |
| `career`   | `src/content/career`   | YAML   | The Career timeline                                                         |
| `albums`   | `src/content/albums`   | YAML   | One album per shoot, for the Photography stacks                             |

Each entry names its `wing` and `section`. The section's `layout` decides which card the entry renders as. An entry with a body gets a write-up page at `/<wing>/<slug>`, and its `href`, if set, becomes the demo button. An entry without a body is a card that links to its `href`, or to its `github` repo when it has no `href`. Set `hidden: true` to keep an entry in the repo without a card, page, or sitemap URL.

## Images

Site images live in Cloudinary under `site/`. Photography lives at the root of the same cloud and is filtered by tag.

- `scripts/cloudinary-map.mjs` maps each image's public ID to its source file.
- `npm run cloudinary:seed` uploads the mapped images and writes their sizes to `src/data/cloudinary-manifest.json`.
- An ID that isn't in the manifest yet renders as a gray skeleton and doesn't request the image. The same skeleton appears if an uploaded image fails to load.
- `npm run photos:tags -- add featured <public_id>` tags a photo. The `featured` tag puts it in the Photography carousel. Run `npm run photos:tags` with no arguments for the full usage.

`npm run photos:albums` builds the album files in `src/content/albums` from the shoot folders listed in `scripts/album-folders.json`. Cloudinary doesn't link photos back to those folders, so the script matches photos to folders by capture date. The `propose` stage writes a proposal for you to review, and the `build` stage writes the albums from it. Run the four stages in order: `exif`, `flickr`, `propose`, and `build`. Most Cloudinary copies are Flickr originals that lost their EXIF data, so the `flickr` stage looks up each photo's capture date on Flickr.

## API routes

All routes are read-only.

- `GET /api/cloudinary/search` returns a page of photos for one tag. It only accepts the gallery's own query shapes.
- `GET /api/cloudinary/tags` returns the public photo tags. It leaves out `featured` and tags that start with `_`.
- `GET /api/cloudinary/pool` returns every photo for one tag, or for All when no tag is given. The gallery shuffles that set in the browser, so each tag shows a random selection.
- `GET /api/cloudinary/album?slug=` returns one album's photos in capture order.
- `GET /api/rawg/*` proxies RAWG for the Switch menu embed. It only answers requests from the embed, so the key never reaches the browser.

v2's upload, delete, and tag-editing routes and its admin dashboard are not part of this repo.

## The Switch menu embed

The Switch menu demo comes from [switch-react-menu](https://github.com/liambsulliva/switch-react-menu), a separate repo. A GitHub Action there publishes the bundle to `public/switch-menu` in this repo. The `MAIN_SITE_REPO` variable in that repo decides which site repo receives the bundle.

The embed reads its game data through `/api/rawg`, which answers only requests from the embed. The RAWG key stays on the server.

## The CMS dashboard

Content is edited through a separate dashboard repo, which uses this site as its content source. The dashboard mirrors the schemas in `src/content.config.ts` and the file format of its entries. A schema change here needs a matching change in the dashboard, and the reverse.

The dashboard's contract test, run with `npm run test:contract` in that repo, renders this site's routes against the dashboard's sample content and restores the original content afterward. If a run is interrupted, the `.contract/` folder in this repo holds the backup. Running the dashboard's contract test again restores the site.

## Requirements

To use the site, you need a current desktop or mobile browser and an internet connection.

To run it yourself, you need:

- Node.js 24, pinned in `.nvmrc` and `package.json`
- npm
- A Cloudinary account, for the photos

The Switch embed's game data needs a RAWG key, and the Flickr stage of the album script needs Flickr keys.

## Environment variables

Copy `.env.example` to `.env` in the project root, then fill in the values:

```bash
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
RAWG_API_KEY=your_rawg_api_key
FLICKR_API_KEY=your_flickr_api_key
FLICKR_USER_ID=your_flickr_user_id
```

| Variable                                                               | Needed for                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | The photo routes, the seed script, the tag script, and the album script             |
| `RAWG_API_KEY`                                                         | The Switch menu embed's game data. Without it, the embed's game data returns a 503. |
| `FLICKR_API_KEY`, `FLICKR_USER_ID`                                     | The `flickr` stage of `npm run photos:albums`                                       |

Set the Cloudinary and RAWG variables on the Vercel project too. Keep `RAWG_API_KEY` server-only, so don't prefix it with `PUBLIC_` or `VITE_`.

## Commands

Run these from the project root. The project targets Node 24.x.

| Command                   | What it does                                                                     |
| ------------------------- | -------------------------------------------------------------------------------- |
| `npm install`             | Installs dependencies                                                            |
| `npm run dev`             | Starts the development server                                                    |
| `npm run build`           | Runs `astro check`, then `astro build`. A type error fails the build.            |
| `npm run preview`         | Serves the last build locally                                                    |
| `npm test`                | Runs the Vitest suite once. The build checks skip when there is no build.        |
| `npm run test:watch`      | Runs the suite in watch mode                                                     |
| `npm run test:build`      | Builds first, then runs the suite, including the checks against the build output |
| `npm run cloudinary:seed` | Uploads the mapped images and writes their sizes to the manifest                 |
| `npm run photos:tags`     | Lists, adds, and removes photo tags in Cloudinary                                |
| `npm run photos:albums`   | Builds the album files in four stages. See [Images](#images).                    |

## Tests

Vitest runs every `.test.ts` file under `tests/`.

- `tests/lib` checks the helpers in `src/lib`, such as album parsing, shared photo links, the Berlin feed, and the redirect rules that accept a trailing slash.
- `tests/content` reads the content files directly and catches problems that only show at runtime, such as a skeleton where a photo should be, a dead PDF link, or a table-of-contents link that scrolls nowhere.
- `tests/components` renders the cards and the image component through Astro's container API.
- `tests/build` checks the Vercel build output, including the redirects, the prerendered pages, robots.txt, and the inlined critical CSS. It reads whatever the last build wrote, so run `npm run test:build` after you change a route.
- `tests/cms` holds the contract suite that the dashboard drives. It runs only when the dashboard passes its cases, so a normal run skips it.

## Stack

- [Astro](https://astro.build/) 5 with TypeScript, using the Vercel adapter for server-rendered pages and API routes
- [Tailwind CSS](https://tailwindcss.com/) 4
- [React](https://react.dev) 18 for the photography, PDF, and demo islands
- [Svelte](https://svelte.dev) for the HERL book only
- [MDX](https://mdxjs.com/) for write-ups
- [Geist Sans](https://vercel.com/font) and [Martian Mono](https://github.com/evilmartians/mono), self-hosted
- [React Photo Album](https://react-photo-album.com/) and [Yet Another React Lightbox](https://yet-another-react-lightbox.com/)
- [PDF.js](https://mozilla.github.io/pdf.js/) for slide carousels
- [Shiki](https://shiki.style/) for syntax highlighting
- [Cloudinary](https://cloudinary.com/) for images
- [Vitest](https://vitest.dev/) for tests

## Credits

- **Cloudinary** hosts every image, and its search API backs the photo routes.
- **WordPress.com** serves the Berlin posts through its public API, and Photon resizes their images.
- **RAWG** supplies the game data for the Switch menu embed.
- **Flickr** supplies capture dates for photos that lost their EXIF data.
- **Figma** holds the design, which sets the layout, components, and tokens.

## FAQ

**Why is a photo a gray box?**
An ID that isn't in the manifest yet renders as a skeleton. Map the image in `scripts/cloudinary-map.mjs`, then run `npm run cloudinary:seed`.

**Why are there no Berlin posts?**
The feed comes back empty when WordPress returns an error or can't be reached. The rest of the Writing page still renders.

**Why does the Switch embed's game data return a 503?**
`RAWG_API_KEY` is missing on the server. Set it in `.env` for local runs and on the Vercel project for production.

**Where is the admin dashboard?**
v2 had one. Content editing moved to a separate dashboard repo, described in [The CMS dashboard](#the-cms-dashboard). Photo tags come from `npm run photos:tags`.

**How do I hide an entry without deleting it?**
Set `hidden: true` in its frontmatter. The entry stays in the repo, with no card, page, or sitemap URL.

## AI usage

I use AI coding agents on this site to co-author content between the dashboard and the site. I use a local [`AGENTS.md`](AGENTS.md) file to hold the notes they follow, including the checks to run before a change is finished. An LLM-written test suite runs on every build to validate results and pin critical features before they ship.
