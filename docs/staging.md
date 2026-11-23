# Staging

A private copy of the site, and later the dashboard, on the NAS. Push to the `staging` branch and it's at https://staging.liambsullivan.com within about 10 minutes, behind Cloudflare Access. Nothing here touches the live site: separate folder, containers, images, tunnel and branch.

```
push to staging ─▶ DSM task (5 min) ─▶ deploy.sh ─▶ personal-website-staging
                                                      ├ cloudflared  tunnel nas-staging
staging.liambsullivan.com      (Access) ──────────────├ site         IMAGE_BACKEND=nas
  /img/*                       (Access) ──────────────├ img          resizes Published (read-only)
cms-staging.liambsullivan.com  (Access) ──────────────├ cms          cms-dashboard's branch
  /img/*, /upload              (Access) ──────────────└ photos       watches Published, owns the index
```

- **Same scripts as live.** `deploy/deploy.sh` and `deploy/compose.yaml`, with settings in staging's own `.env` (`STACK`, `DEPLOY_BRANCH`, `IMAGE_BACKEND`, `PHOTOS`, `CMS_BRANCH`; see `deploy/.env.example`). Every compose call names its project, and the copied `compose.yaml` carries staging's name, so a `docker compose` by hand in that folder can't reach the live containers.
- **Content.** Staging commits (album files, dashboard publishes) go to the `staging` branch and drafts to `drafts-staging`. Vercel builds neither.
- **Photos are the real ones.** There is one `Published` folder and one index. A photo deleted from the staging dashboard leaves `Published` for its 30-day trash. The live site isn't affected while it uses Cloudinary.
- **Releasing.** Merge the code to `main`. Don't merge `staging` itself: it holds test content.
- **Memory.** Limits add up to 1.8 GB with the dashboard (site 384 MB, img 512, photos 384, cms 256, cloudflared 128); measured use is about 600 MB under load. Builds are capped at 1.5 GB and take turns with the live site's.

## Setup

1. Cloudflare: tunnel `nas-staging`, its hostnames and paths, Access on both hostnames.
2. `Published/.site/index.json`: the seeded index. `photos` starts a new host from that copy.
3. `deploy/setup-staging.sh` as root, with the tunnel token on stdin. It makes the folder, the `.env` and the DSM task, which then does the first deploy.
4. DNS: `staging` and `cms-staging` to the new tunnel.
5. For the dashboard and album commits, add to staging's `.env`: `GITHUB_TOKEN`, `CMS_AUTH_USER_HASH`, `CMS_AUTH_PASSWORD_HASH`, `CMS_SESSION_SECRET`, `CMS_BRANCH`, and `PUBLISH_ALBUMS=1`.

## Undo

Disable the DSM task, `docker compose -p personal-website-staging down` in the folder, and point `staging`'s DNS record back at the live tunnel. `Published` and the live project need nothing.

## At the switch

Exactly one project may run `photos`. To go live: stop staging's `img` and `photos`, move `photos/index` to the live project, set `IMAGE_BACKEND=nas` and `PHOTOS=1` there, and give staging `PHOTO_INDEX_DIR` pointing at it (read-only) with its own `img`.
