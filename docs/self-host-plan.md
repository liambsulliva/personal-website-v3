# Self-hosting plan: NAS container behind Cloudflare Tunnel

Branch: `env/self-host`. Goal: serve https://liambsullivan.com from a Docker container on the DS923+, reached only through a Cloudflare Tunnel, with every page, redirect and API route behaving as it does on Vercel today. Cloudinary stays as the image host and search backend for now; moving the assets is a later project.

## What was checked before writing this

| Fact | Result |
|---|---|
| DNS | `liambsullivan.com` already uses Cloudflare nameservers, so a tunnel needs no registrar change. The apex currently resolves to Vercel. |
| Build on the NAS | `astro build` ran here in 43 s with a 931 MB peak (one process), on Node 24.22 and kernel 4.4.302. `astro check` was not included in that run. |
| NAS | x86_64, 4 cores, 4 GB RAM in total. T3 is capped at 2.5 GB and the sshd sidecar at 1 GB. |
| Server-rendered routes | `/photography`, `/writing`, `/api/cloudinary/{search,tags,pool,album}`, `/api/rawg/*`. Everything else is prerendered. |
| Outbound calls at request time | Cloudinary Search API, RAWG, the Berlin WordPress feed. |
| Secrets | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `RAWG_API_KEY`. There is no `.env` on the NAS; the values live in the Vercel project. |
| What triggers a deploy today | A push to `main`. Two things push without you: the CMS dashboard's Publish, and the `switch-react-menu` Action that writes `public/switch-menu`. |
| Vercel-only code | `@astrojs/vercel`, `vercel.json` (headers), `integrations/slashSafeRedirects.mjs`, `tests/build/output.test.ts` (reads `.vercel/output`), one test block in `tests/lib/server.test.ts`. |

## Target architecture

```
visitor ─ HTTPS ─▶ Cloudflare edge ─ tunnel (outbound from NAS) ─▶ cloudflared ─ http ─▶ site:4321
                                                                    └──── compose network, no published ports ────┘
```

- **`site`**: the Astro Node server (`@astrojs/node`). Serves `dist/client` and renders the SSR routes. Runs as a non-root user, `mem_limit` 384 MB, with a healthcheck on `/healthz`.
- **`cloudflared`**: `cloudflare/cloudflared`, a remotely managed tunnel run from a token. It is the only way in. Nothing is published on the NAS, the LAN or the tailnet.
- **Project folder**: `/volume1/docker/projects/personal-website/`, holding `compose.yaml`, `.env` (secrets and the tunnel token), its own clean clone of the repo, and `deploy.log`. It does not build from the agents' checkout in `nas-agents/workspace`, which is often on a feature branch or has uncommitted work.
- **Base image**: `node:24-bookworm-slim`. Node 24 is proven on this kernel with glibc; Alpine is not, so it is not worth the risk.

## Things that silently break if only the adapter is swapped

These are the reason this is a plan and not a one-line change.

1. **Legacy redirects become 200s.** Without the Vercel adapter, Astro prerenders each `redirects` entry as a meta-refresh HTML page (they already appear as `/other-work/index.html` in the build log). Search engines and old links need real 301s, with and without a trailing slash.
2. **The RAWG proxy returns 403.** `isRawgProxyRequestAllowed` compares the request's origin with the Referer's origin. Behind the tunnel the server sees `http://`, the browser sends `https://`. Astro only trusts `X-Forwarded-Proto` for hosts listed in `security.allowedDomains`.
3. **Every photography view hits Cloudinary.** The routes send `s-maxage=300, stale-while-revalidate=86400`, which Vercel's CDN honoured. Cloudflare does not cache HTML or JSON by default, so each `/photography` view would make two Admin Search calls, and that API is rate-limited per hour.
4. **Secrets could be baked into the image.** `import.meta.env.X` can be inlined at build time if the value is present. The image must build with no secrets and read them when it starts.
5. **`/switch-menu/*` loses its frame headers**, which come from `vercel.json`.
6. **Nothing redeploys on push.** CMS publishes and Switch-menu updates would sit in `main` unserved.

## Repo changes (this branch)

### 1. Adapter and server entry
- Add `@astrojs/node`. In `astro.config.mjs` choose the adapter from `DEPLOY_TARGET` (`node` or `vercel`, default `vercel`). `main` keeps deploying to Vercel until cutover, the branch can merge early, and rollback is a DNS change. A final cleanup removes the Vercel path.
- Use the adapter's `middleware` mode with a small `server.mjs` (plain `node:http`, no framework) that handles, in order:
  - `GET /healthz` → 200.
  - Legacy redirects → 301, matching an optional trailing slash. The table moves to `src/lib/redirects.mjs`, imported by both `astro.config.mjs` and `server.mjs`, so there is one list.
  - `/switch-menu/*` → the three frame headers from `vercel.json`.
  - Everything else → Astro's handler (static files, SSR, `404.html`). The adapter already sends `immutable` on `/_astro/*`.
- `security.allowedDomains` for `liambsullivan.com`, `www` and the staging hostname, all `https`.
- `slashSafeRedirects` and `vercel.json` stay only while `DEPLOY_TARGET=vercel` exists.

### 2. Runtime secrets
- Declare the four variables in an `astro:env` schema as server secrets and read them through it in `cloudinaryServer.ts`, `cloudinary.ts` and the RAWG route. `CLOUDINARY_CLOUD_NAME` is also used when prerendering image URLs, so it is passed as a build argument; it is public (it is in every image URL). The API key, API secret and RAWG key exist only in the NAS `.env`.

### 3. Origin-side cache for the dynamic routes
- A small in-memory TTL cache around `searchPhotos`, `searchAllPhotos`, `listPhotoTags` and `getBerlinPosts`: fresh for 300 s, served stale while one refresh runs. This makes the origin safe whatever the CDN does, and keeps the page up if Cloudinary or WordPress has a bad minute.
- Response `Cache-Control` headers stay as they are, so Cloudflare can cache too (see Cloudflare setup).

### 4. Container files
- `Dockerfile`, three stages: `deps` (`npm ci`), `build` (`npm run build`, which includes `astro check`; `NODE_OPTIONS=--max-old-space-size=1024`), `runtime` (`dist/`, `server.mjs`, production `node_modules`, `USER node`, `HEALTHCHECK`).
- `.dockerignore`: `node_modules`, `.git`, `.env*`, `.vercel`, `dist`, `docs`, `assets/**/*.psd`, `tests`.
- `deploy/compose.yaml`: `site` and `cloudflared`, `restart: unless-stopped`, memory limits, DSM's default log driver, `image: personal-website:${SITE_SHA}`.
- `deploy/deploy.sh`: see Deploys below.
- `deploy/.env.example`: the four secrets, `TUNNEL_TOKEN`, `SITE_SHA`.

### 5. Tests
- `tests/build/output.test.ts` reads `dist/client` instead of `.vercel/output/static` for the file checks (prerendered pages, robots, critical CSS, font preloads, lobby without React, flourishes chunk).
- The routing checks (301s, SSR routes answer, `/dashboard` is 404, frame headers, `/_astro` caching) start the built server on a free port and use `fetch`. That tests the real server instead of a config file.
- New cases: a 301 for each legacy path with and without the slash; `/api/rawg/platforms` returns 200 when sent `X-Forwarded-Proto: https` and a same-origin `/switch-menu/` Referer, and 403 without the Referer; a second `/photography` render makes no upstream call.
- `slashSafeRoute` tests go when the Vercel path goes.

### 6. Docs
- README: hosting badge, the "set the variables on Vercel" lines, the tech stack line, the tests section, and a short "Deploying" section pointing here.
- The `switch-react-menu` workflow only mentions Vercel in a log line; no functional change.

## Deploys

Vercel deployed on every push. The replacement is a poller, because it needs no inbound endpoint and no GitHub secret on the NAS:

- A DSM Task Scheduler task runs `deploy/deploy.sh` every 5 minutes as root, the same pattern as `T3 register repos`.
- The script runs `git ls-remote origin main`. If the SHA equals the running image's tag it exits. Otherwise it fetches into the project's own clone, runs `nice -n 15 docker build -t personal-website:<sha>`, starts the new container, waits for `/healthz` and a 200 from `/photography`, then switches over. A `flock` stops overlapping runs.
- A failed build or failed health check leaves the old container serving and writes to `deploy.log`, which matches how Vercel keeps the last good deployment.
- It keeps the last three images and prunes the rest. Rollback is `SITE_SHA=<old> docker compose up -d`.
- Expected delay from push to live: up to 5 minutes of polling plus about 2 minutes of build. If that feels slow after a CMS publish, add a GitHub webhook through the tunnel later; the script stays the same.

The CMS dashboard stays on Vercel. It only commits to this repo, so nothing in it changes.

## Cloudflare setup

1. Zero Trust → Networks → Tunnels: create tunnel `nas-site`, copy the token into the NAS `.env`.
2. Public hostname `staging.liambsullivan.com` → `http://site:4321`. Put a Cloudflare Access policy on it (your email only) so it is never indexed.
3. Cache Rules: make `/photography`, `/writing` and `/api/cloudinary/*` eligible for cache, respecting the origin's `Cache-Control`. Leave `/api/rawg/*` alone (it is `private`).
4. SSL/TLS: Always Use HTTPS on, HSTS matching today's `max-age=63072000`.
5. At cutover: add `liambsullivan.com` (and `www`, if it has a record today) as public hostnames on the tunnel, replacing the Vercel records. Both sides are in Cloudflare, so the switch takes effect within seconds.

## Phases and gates

| Phase | Work | Gate before moving on |
|---|---|---|
| 1. App | Repo changes 1–3 and 5 | `DEPLOY_TARGET=node npm run test:build` passes in this container; `node server.mjs` answers every route in the parity list; the default (Vercel) build and tests still pass |
| 2. Image | Dockerfile, compose, deploy script | Image builds on the NAS; build peak memory recorded with `astro check` included; `site` idles under 150 MB |
| 3. Staging | Tunnel, staging hostname behind Access | Parity list passes on `staging.` from outside the LAN; a test commit to a throwaway branch deploys through the poller; a deliberately broken build leaves the old container up |
| 4. Cutover | Merge to `main`, switch the apex and `www` to the tunnel | Parity list passes on the real domain; CMS Publish reaches the site; Switch menu loads games |
| 5. Soak | Leave the Vercel project in place, untouched, for two weeks | No unexplained downtime; then remove `@astrojs/vercel`, `vercel.json`, `slashSafeRedirects`, the `DEPLOY_TARGET` switch, and the Vercel project |

**Parity list**, compared against the live Vercel site: status and `Location` for the six legacy redirects with and without a slash; 200 and matching `<title>`/canonical for `/`, `/me`, `/career`, `/engineering`, `/design`, `/writing`, `/photography`, one write-up per wing; `/photography?album=<slug>` and `?tag=<tag>` render that source; the four Cloudinary routes return the same JSON shape; the Switch menu embed in `/engineering/switch-react-menu` loads game data; opening `/switch-menu/` directly redirects to the write-up; unknown paths return 404 with the 404 page; `sitemap.xml` and `robots.txt` match; `/_astro/*` is `immutable`; `Resume.pdf` and the PDF carousels load.

## Risks

- **Memory is the tight one.** 4 GB total, with T3 allowed 2.5 GB and sshd 1 GB. A 1 GB build while several agent threads run could push the NAS into swap. Mitigations: the Node heap cap, `nice`, one build at a time. If phase 2 shows the peak is too high, the fallback is to build the image in GitHub Actions and have the poller pull it from GHCR instead of building; nothing else in the plan changes.
- **Availability is now your uplink, power and DSM updates.** Vercel had none of those. Cloudflare keeps serving cached static assets during a blip but not SSR pages. An external uptime check on `/healthz` is worth adding in phase 3.
- **Kernel 4.4.** `cloudflared` defaults to QUIC; if the tunnel flaps, set `--protocol http2`.
- **Cloudflare cache differs from Vercel's.** If the Cache Rules misbehave, the origin cache in change 3 already bounds upstream calls, so this is a performance question, not a correctness one.

## Needs you

- The four secret values, copied from the Vercel project into the NAS `.env` (agents cannot see the `docker` share, by design).
- The Cloudflare dashboard steps, or an authorized Cloudflare connector so they can be done for you.
- An OK for each `ssh nas-ssh` command in phases 2–4, and creating the DSM scheduled task.
