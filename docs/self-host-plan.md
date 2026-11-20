# Self-hosting plan: NAS container behind Cloudflare Tunnel

Branch: `env/self-host`. Goal: serve https://liambsullivan.com from a Docker container on the DS923+, reached only through a Cloudflare Tunnel, with every page, redirect and API route behaving as it does on Vercel today. Cloudinary stays as the image host and search backend for now; moving the assets is a later project.

## What was checked before writing this

| Fact | Result |
|---|---|
| DNS | `liambsullivan.com` already uses Cloudflare nameservers, so a tunnel needs no registrar change. The apex currently resolves to Vercel. |
| Build on the NAS | `astro build` ran here in 43 s with a 931 MB peak (one process), on Node 24.22 and kernel 4.4.302. With `astro check` included (`npm run build`, Node target, phase 1): 37–59 s, 908–950 MB for the largest process, 1.04–1.13 GB for the whole process tree; also passes under `--max-old-space-size=1024`. |
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

These are the reason this is a plan and not a one-line change. Phase 1 tested each against a plain adapter swap; items 1, 2 and 4 turned out different from what was first written here, and the corrections are inline.

1. **~~Legacy redirects become 200s.~~ Legacy redirects lose their query string.** *Corrected in phase 1.* The original claim was that Astro prerenders each `redirects` entry as a meta-refresh page under the Node adapter. It doesn't: `@astrojs/node` 9.5 sets `build.redirects: false` (as the Vercel adapter does), so no page is written and the server answers each legacy path with a real 301, with or without the slash. The `/other-work/index.html` lines in the build log are printed even though no file is written. The real gap: Astro's redirect drops the query string (`/other-work/?ref=x` → `/design`), Vercel keeps it (`/design?ref=x`). `server.mjs` answers the list itself to match.
2. **The RAWG proxy returns 403.** *Mechanism corrected in phase 1; the fix stands.* `isRawgProxyRequestAllowed` compares the request's origin with the Referer's origin. Astro trusts `X-Forwarded-Proto` (`http`/`https`) even with no `security.allowedDomains`; what it refuses without a matching entry is the `Host` and `X-Forwarded-Host` headers, so the request URL becomes `https://localhost/...` and never matches the browser's `https://liambsullivan.com` Referer. With `allowedDomains` listing the hosts (protocol `https`), the Host is trusted and the check passes; the protocol pattern also narrows which `X-Forwarded-Proto` values are accepted. **This is broken on Vercel today too**: the live proxy answers 403 to the embed, and a request that passes the check (Referer `https://localhost/switch-menu/`) gets 503 "RAWG proxy not configured", so the RAWG key isn't reaching the function at runtime either. The Switch menu loads no game data in production right now.
3. **Every photography view hits Cloudinary.** The routes send `s-maxage=300, stale-while-revalidate=86400`, which Vercel's CDN honoured. Cloudflare does not cache HTML or JSON by default, so each `/photography` view would make two Admin Search calls, and that API is rate-limited per hour.
4. **Secrets are baked in, or never read.** *Mechanism corrected in phase 1.* In Astro 5.18, `import.meta.env.X` in server code compiles to a literal when X comes from a `.env` file (baked into `dist/`), to `process.env.X` when X is in the build's environment, and to nothing when X is absent at build. An image built without secrets would therefore 500 on every Cloudinary route even with the secrets set in the container. Reading them through `astro:env` secrets fixes both.
5. **`/switch-menu/*` loses its frame headers**, which come from `vercel.json`. (On Vercel, `/switch-menu/:path*` matches the assets and `/switch-menu` but not `/switch-menu/`, the document the headers exist to protect; the Node server sends them on all three.)
6. **Nothing redeploys on push.** CMS publishes and Switch-menu updates would sit in `main` unserved.
7. **A published album keeps its old photos for a day.** *Found in the cms-dashboard check (2026-11-19).* `/api/cloudinary/album` is cached for a day (`s-maxage=86400`, a week stale) on the grounds that album membership only changes with a deploy, "which clears the CDN". Vercel's did; Cloudflare's isn't cleared by a NAS deploy. The gallery now asks for `?slug=<slug>&v=<albumVersion>`, a hash of the album's photo list (`src/lib/albumData.ts`), so a publish that changes an album changes its URL; only the current version is kept for a day, a missing or old `v` for five minutes.

## Repo changes (this branch)

### 1. Adapter and server entry
- Add `@astrojs/node`. In `astro.config.mjs` choose the adapter from `DEPLOY_TARGET` (`node` or `vercel`, default `vercel`). `main` keeps deploying to Vercel until cutover, the branch can merge early, and rollback is a DNS change. A final cleanup removes the Vercel path.
- ~~Use the adapter's `middleware` mode~~ Use the adapter's `standalone` mode, imported with `ASTRO_NODE_AUTOSTART=disabled`, with a small `server.mjs` (plain `node:http`, no framework). *Corrected in phase 1:* middleware mode's handler renders the app only and expects another server to serve `dist/client`; standalone's handler serves static files, then SSR, then `404.html`. `server.mjs` handles, in order:
  - `GET /healthz` → 200.
  - Legacy redirects → 301, matching an optional trailing slash and keeping the query string. The table moves to `src/lib/redirects.mjs`, imported by both `astro.config.mjs` and `server.mjs`, so there is one list.
  - `/switch-menu`, `/switch-menu/` and `/switch-menu/*` → the three frame headers from `vercel.json`.
  - Everything else → Astro's handler. The adapter already sends `immutable` on `/_astro/*`.
  - `keepAliveTimeout` 95 s, above cloudflared's 90 s idle timeout (otherwise occasional 502s); SIGTERM drains before exit.
- `security.allowedDomains` for `liambsullivan.com`, `www` and the staging hostname, all `https`.
- `slashSafeRedirects` and `vercel.json` stay only while `DEPLOY_TARGET=vercel` exists.

### 2. Runtime secrets
- Declare the four variables in an `astro:env` schema as server secrets and read them through it (`src/lib/serverEnv.ts`) in `cloudinaryServer.ts`, `cloudinary.ts` and the RAWG route. `CLOUDINARY_CLOUD_NAME` is also used when prerendering image URLs, so it is passed as a build argument as well as set in the container; it is public (it is in every image URL). It stays a "secret" in the schema because astro:env inlines public server variables at build, and the SSR routes must read it at runtime. The API key, API secret and RAWG key exist only in the NAS `.env`.
- Under Vitest, astro:env is a snapshot taken when it first loads, which would hide the CMS contract's `vi.stubEnv` credentials; `serverEnv.ts` reads the live `process.env` in tests. `tests/lib/contractEnv.test.ts` guards that with the contract's own harness; `tests/cms` is unchanged.

### 3. Origin-side cache for the dynamic routes
- A small in-memory TTL cache (`src/lib/originCache.ts`) around `searchPhotos`, which `searchAllPhotos`, `searchAlbumPhotos` and `listPhotoTags` all go through, and the WordPress fetch behind `getBerlinPosts`: fresh for 300 s, concurrent misses shared, served stale while one refresh runs, the last good result kept through a failed refresh (for up to a day), failures never cached, at most 300 keys (keys come from query strings). This makes the origin safe whatever the CDN does, and keeps the page up if Cloudinary or WordPress has a bad minute.
- Response `Cache-Control` headers stay as they are, so Cloudflare can cache too (see Cloudflare setup).

### 4. Container files
- `Dockerfile`, three stages: `deps` (`npm ci`), `build` (`npm run build`, which includes `astro check`; `NODE_OPTIONS=--max-old-space-size=1024`; refuses to build without `CLOUDINARY_CLOUD_NAME`), `runtime` (`dist/`, `server.mjs`, `src/lib/redirects.mjs`, production `node_modules`, `USER node`, `HEALTHCHECK`). It uses no BuildKit-only syntax, because `deploy.sh` builds with the legacy builder (see Deploys).
- `.dockerignore`: `node_modules`, `.git`, `.env*`, `.vercel`, `dist`, `docs`, `assets/**/*.psd`, `tests`.
- `deploy/compose.yaml`: `site` and `cloudflared`, `restart: unless-stopped`, memory limits, DSM's default log driver, `image: personal-website:${SITE_SHA}`. `site` runs with a read-only root filesystem and no capabilities (phase 1 checked that the server writes nothing to disk); `cloudflared` is pinned and takes `TUNNEL_PROTOCOL` (`auto` or `http2`).
- `deploy/deploy.sh`: see Deploys below.
- `deploy/.env.example`: the four secrets, `TUNNEL_TOKEN`, `TUNNEL_PROTOCOL`, `SITE_SHA`.

### 5. Tests
- `tests/build/output.test.ts` reads `dist/client` for `DEPLOY_TARGET=node` and `.vercel/output/static` otherwise for the file checks (prerendered pages, robots, critical CSS, font preloads, lobby without React, flourishes chunk); the `config.json` routing checks stay for the Vercel build until it goes.
- `tests/build/server.test.ts` starts `server.mjs` on a free port with `tests/build/upstream-stub.mjs` preloaded in place of Cloudinary, RAWG and WordPress, and requests the parity list. That tests the real server instead of a config file.
- New cases: a 301 for each legacy path with and without the slash and with a query; `/api/rawg/platforms` returns 200 when sent `X-Forwarded-Proto: https`, the real Host and a same-origin `/switch-menu/` Referer, and 403 without the Referer or from an unlisted Host; a second `/photography` render makes no upstream call; the Cloudinary routes answer with credentials given only at start. Each `(regression)` case was shown to fail against a build without its fix (below).
- `tests/deploy/deploy.test.ts` runs `deploy.sh` with real git against a local origin and a fake `docker`.
- `scripts/parity.mjs <reference> <candidate> [--as host]` runs the parity list against two origins, for phases 3 and 4.
- `slashSafeRoute` tests go when the Vercel path goes.

### 6. Docs
- README: hosting badge, the "set the variables on Vercel" lines, the tech stack line, the tests section, and a short "Deploying" section pointing here.
- The `switch-react-menu` workflow only mentions Vercel in a log line; no functional change.

## Deploys

Vercel deployed on every push. The replacement is a poller, because it needs no inbound endpoint and no GitHub secret on the NAS:

- A DSM Task Scheduler task runs `deploy/deploy.sh` every 5 minutes as root, the same pattern as `T3 register repos`.
- The script runs `git ls-remote origin main`. If the SHA equals `SITE_SHA` in `.env` it exits (starting the stack if it stopped). Otherwise it fetches into the project's own clone, builds `personal-website:<sha>`, starts the new image as a separate candidate container, waits for `/healthz` and a 200 from `/photography` and `/api/cloudinary/pool` (the page renders 200 even when Cloudinary fails; the route doesn't), then writes `SITE_SHA` and recreates `site`, rolling back if the new `site` fails the same checks. A `flock` stops overlapping runs.
- *Corrected in phase 1:* `nice -n 15 docker build` would only nice the docker CLI; the build runs under the daemon. `deploy.sh` builds with the legacy builder (`DOCKER_BUILDKIT=0`), which takes `--memory 1536m --memory-swap 1536m --cpu-shares 256`, so a build that outgrows 1.5 GiB fails instead of pushing the NAS into swap. BuildKit has no per-build memory limit.
- DSM ships without git unless the Git Server package is installed; `deploy.sh` uses `alpine/git` in a container when there is no host git. The repo is public, so polling needs no credentials.
- Recreating `site` takes a few seconds, during which the tunnel answers 502. Cloudflare keeps serving what it has cached. A zero-downtime swap would need a second service and is not worth it yet.
- A failed build or failed health check leaves the old container serving and writes to `deploy.log` (the build output goes to `build.log`), which matches how Vercel keeps the last good deployment. A commit whose build failed is not rebuilt every 5 minutes; it waits for the next push (or `FORCE=1`). A failed check is retried on the next run without rebuilding.
- It keeps the serving image and the newest three and prunes the rest. `deploy.sh` copies `compose.yaml` into the project folder, so rollback is `SITE_SHA=<old> docker compose up -d` there (and put the old SHA in `.env`, or the next poll redeploys main).
- Expected delay from push to live: up to 5 minutes of polling plus about 2 minutes of build. If that feels slow after a CMS publish, add a GitHub webhook through the tunnel later; the script stays the same.

The CMS dashboard stays on Vercel. It only commits to this repo, so nothing in it changes.

## Cloudflare setup

1. Zero Trust → Networks → Tunnels: create tunnel `nas-site`, copy the token into the NAS `.env`.
2. Public hostname `staging.liambsullivan.com` → `http://site:4321`. Put a Cloudflare Access policy on it (your email only) so it is never indexed. Add an Access service token to the policy too, so `scripts/parity.mjs` can run against staging (`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`).
3. Cache Rules: make `/photography`, `/writing` and `/api/cloudinary/*` eligible for cache, respecting the origin's `Cache-Control`, with the query string in the cache key (the default; the album URL's `v` depends on it). Leave `/api/rawg/*` alone (it is `private`). Nothing purges this cache on deploy, so a route whose content changes with a publish needs a versioned URL (item 7 above).
4. SSL/TLS: Always Use HTTPS on, HSTS matching today's `max-age=63072000`.
5. At cutover: add `liambsullivan.com` (and `www`, if it has a record today) as public hostnames on the tunnel, replacing the Vercel records. Both sides are in Cloudflare, so the switch takes effect within seconds.

## Phases and gates

| Phase | Work | Gate before moving on |
|---|---|---|
| 1. App | Repo changes 1–3 and 5 | `DEPLOY_TARGET=node npm run test:build` passes in this container; `node server.mjs` answers every route in the parity list; the default (Vercel) build and tests still pass |
| 2. Image | Dockerfile, compose, deploy script | Image builds on the NAS; build peak memory recorded with `astro check` included; `site` idles under 150 MB |
| 3. Staging | Tunnel, staging hostname behind Access | Parity list passes on `staging.` from outside the LAN; a test commit to a throwaway branch deploys through the poller; a deliberately broken build leaves the old container up |
| 4. Cutover | Merge `env/self-host` into `main`, switch the apex and `www` to the tunnel (checklist below) | Parity list passes on the real domain; CMS Publish reaches the site; Switch menu loads games; the Uptime workflow passes |
| 5. Soak | Leave the Vercel project in place, untouched, for two weeks | No unexplained downtime; then remove `@astrojs/vercel`, `vercel.json`, `slashSafeRedirects`, the `DEPLOY_TARGET` switch, and the Vercel project |

**Cutover checklist**, in order:

1. Merge `env/self-host` into `main` (a normal merge, after any CMS publishes made meanwhile). Vercel deploys `main` as before: the default target is still `vercel`.
2. On the NAS, point the poller at `main` (drop `DEPLOY_BRANCH=env/self-host` from the scheduled task). Its next run deploys `main`.
3. Switch `liambsullivan.com` and `www` to the tunnel (Cloudflare setup, step 5), then run `scripts/parity.mjs` against the real domain.
4. Set the repository variable `UPTIME_URL=https://liambsullivan.com` to turn on the Uptime workflow (below), and run it once by hand (Actions → Uptime → Run workflow). If Cloudflare's Bot Fight Mode challenges it, add a WAF skip rule for the `site-uptime-check` user agent.
5. In cms-dashboard, change the Publish screen's "Vercel will redeploy the site" / "Vercel redeploys the site from it" (`app/pages/publish.vue`) and the README's "Vercel then redeploys the site" to say the site redeploys from the NAS within about 10 minutes.

**Uptime check.** `.github/workflows/uptime.yml` runs `scripts/uptime.mjs` every 15 minutes from GitHub's runners, so it sees what a visitor sees and doesn't depend on the NAS. It checks `/healthz`, `/`, `/photography`, `/api/cloudinary/pool` (Cloudinary credentials) and `/api/rawg/platforms` as the Switch menu asks (RAWG key), retrying a failure once 30 s later. It also compares the commit `/healthz` reports (the image's `SITE_SHA`) with `main`'s head: once `main` has been ahead for 30 minutes, the deploy failed or stalled. A failure opens an issue labelled `uptime` (GitHub emails it), comments only when what's failing changes, and closes it on recovery. It's off until `UPTIME_URL` is set, and only runs from `main`, so it arrives with the merge. Before cutover, run the script by hand against staging with the Access service token. GitHub pauses schedules after 60 days without a commit; CMS publishes count.

**Parity list**, compared against the live Vercel site: status and `Location` for the six legacy redirects with and without a slash; 200 and matching `<title>`/canonical for `/`, `/me`, `/career`, `/engineering`, `/design`, `/writing`, `/photography`, one write-up per wing; `/photography?album=<slug>` and `?tag=<tag>` render that source; the four Cloudinary routes return the same JSON shape; the Switch menu embed in `/engineering/switch-react-menu` loads game data; opening `/switch-menu/` directly redirects to the write-up; unknown paths return 404 with the 404 page; `sitemap.xml` and `robots.txt` match; `/_astro/*` is `immutable`; `Resume.pdf` and the PDF carousels load.

## Phase 1 results (2026-11-18)

- `DEPLOY_TARGET=node npm run test:build` passes on the NAS: 260 tests, 0 `astro check` errors. The default (Vercel) `npm run test:build` and `npm test` pass too.
- Each `(regression)` test was run against a build without its fix. Against a plain adapter swap: the query-string redirect, the runtime credentials, the frame headers and the RAWG proxy fail. Against the final build with only the cache removed, only the cache test fails; with only `allowedDomains` emptied, only the RAWG test fails. The deploy-on-push test fails without `deploy.sh` by construction.
- `node server.mjs` against the build matches the live site on every item of the parity list (`scripts/parity.mjs`), with Cloudinary, RAWG and WordPress stubbed (there is no `.env` on the NAS). Two items differ on purpose and are reported, not compared: the RAWG call from the embed (403 live, 200 here) and the frame headers on the `/switch-menu/` document (missing live).
- Not run here, because there is no Docker in this container: the Dockerfile, the compose file and `deploy.sh` against a real daemon. `deploy.sh`'s decisions are tested with a fake `docker`; its in-container probe was run against the real server.

## Phase 2 results (2026-11-19)

Run once by hand as root on the NAS with `deploy.sh`'s own `fetch`, `build` and `check_candidate` against a git bundle of `env/self-host` (301f9a9), since the branch is not on GitHub yet.

- **Build:** passes with the legacy builder under `--memory 1536m --cpu-shares 256` and `nice 15`, in 306 s. `astro check`: 0 errors, 0 warnings on 156 files. Peak memory per build step, `astro check` included: 937 MiB for `npm run build`, 686 MiB for `npm ci`. The host's lowest MemAvailable during the build was 967 MiB; swap in use went from 929 to 1041 MiB. The image is 636 MB.
- **Candidate check:** `/healthz`, `/photography` and `/api/cloudinary/pool` answer 200 with the real Cloudinary credentials.
- **`site` from compose.yaml:** healthy, read-only root, runs as `node`. 88 MiB after warming every route, 96 MiB idle a minute later, 177 MiB peak (cgroup), against the 150 MB idle gate and the 384 MB limit. The RAWG proxy returns 200 from the embed with the real key: 3.3 s cold, cached after that.
- **NAS facts found on the way:**
  - DSM has no git, so the `alpine/git` fallback is what runs.
  - Docker is root-only (`docker.sock` is `root:root 660`).
  - SFTP/`scp` is off.
  - The project folder inherits a `rwxrwxrwx` ACL from `/volume1/docker/projects`, so files root creates there are world-writable too. Remove the inherited ACL before the root scheduled task exists, or any account on the NAS can change what it runs.

## Risks

- **Memory is the tight one.** 4 GB total, with T3 allowed 2.5 GB and sshd 1 GB. A 1 GB build while several agent threads run could push the NAS into swap. Mitigations: the Node heap cap, `nice`, one build at a time. If phase 2 shows the peak is too high, the fallback is to build the image in GitHub Actions and have the poller pull it from GHCR instead of building; nothing else in the plan changes.
- **Availability is now your uplink, power and DSM updates.** Vercel had none of those. Cloudflare keeps serving cached static assets during a blip but not SSR pages. The Uptime workflow (above) is what tells you.
- **Kernel 4.4.** `cloudflared` defaults to QUIC; if the tunnel flaps, set `TUNNEL_PROTOCOL=http2` in `.env`.
- **Legacy builder.** `DOCKER_BUILDKIT=0` is deprecated; if DSM's Docker drops it, build in GitHub Actions and pull from GHCR (the fallback above).
- **Cloudinary Search calls from query strings.** `/api/cloudinary/search` and `?tag=` take any well-formed tag or cursor, so each new one costs a Search call. The origin cache bounds repeats, not novelty; a Cloudflare rate-limiting rule on `/api/cloudinary/*` is the cheap guard if it is ever abused. Vercel had the same exposure.
- **Cloudflare cache differs from Vercel's.** If the Cache Rules misbehave, the origin cache in change 3 already bounds upstream calls, so this is a performance question, not a correctness one.

## Needs you

- The four secret values, copied from the Vercel project into the NAS `.env` (agents cannot see the `docker` share, by design). Check `RAWG_API_KEY` while there: the live proxy says it isn't configured.
- The Cloudflare dashboard steps, or an authorized Cloudflare connector so they can be done for you.
- An OK for each `ssh nas-ssh` command in phases 2–4, and creating the DSM scheduled task.
