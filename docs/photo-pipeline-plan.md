# Photo pipeline plan: publish from `/photography/Published`, without Cloudinary

Branch: `env/self-host`. Goal: export a finished JPEG into one folder on the NAS and have it appear on the site, resized on the NAS, with no Cloudinary and no manual upload. Covers this repo and `cms-dashboard`. Approved in outline on 2026-11-23; no code is built yet; the first 463 photos are in `Published` (see "Staged on 2026-11-23").

## Decisions

| Decision | Choice |
|---|---|
| Source of truth | `/volume1/photography/Published` (created 2026-11-23). Independent of `Exports`, which stays a working folder and is only read, once, to fill `Published`. |
| What triggers a publish | A finished file landing in `Published/<shoot name>/`. No approval step (assumed: the recommendation was accepted with the plan, not answered on its own). |
| Formats out | WebP, and JPEG for Open Graph cards. No AVIF: 7.6 s for one 1200 px image on this CPU, and Cloudinary sent none in the 2026-11-23 samples. |
| Containers | Two small services beside `site`, not Lambda-style workers: those handle one request at a time, and this box has about 1.2 GB free. |
| Interfaces kept | `/api/cloudinary/{pool,album,search,tags}` and their JSON, the 841 existing photo ids, the `albums` collection schema, `src/data/cloudinary-manifest.json`, the Cloudinary-style transform strings. |
| Switch | `IMAGE_BACKEND=cloudinary|nas` in both repos, default `cloudinary`. Rollback is that one setting until Cloudinary is closed. |

RAW files hold no Lightroom edits, so the pipeline starts at the export. Nothing here renders a RAW.

## Folder rules

```
Published/
  Bigelow Bash 4-11/      one folder per shoot; becomes an album
    BigelowBash-1.jpg
  _unsorted/              published, in no album
  _site/                  site imagery (today's site/…), never in the gallery
```

- **Ready:** a file counts once its size and mtime match across two scans a minute apart and Sharp can decode it. The watcher polls; about 1,000 `stat` calls a minute is cheap, and it doesn't depend on inotify seeing SMB writes through a bind mount.
- **Accepted:** JPEG, PNG, TIFF and WebP up to 50 MB. Anything else is logged and skipped. `@eaDir`, dotfiles, `#recycle` and partial copies are ignored.
- **Id:** a photo gets a random 20-character id once and keeps it. Same path with new bytes is a replacement (same id, new version). Same bytes at a new path is a move (same id).
- **Album:** title from the folder name with its trailing `M-DD` removed, date from the photos' capture time (falling back to the folder's date), order by capture time.
- **Tags:** the JPEG's IPTC/XMP keywords that pass the dashboard's `TAG_RE`. Values set in the dashboard override the file's and survive a re-export.
- **Removal:** a missing file is unpublished after two scans and its id kept for 30 days. If more than 20 photos or 10% disappear at once, or the folder can't be read, the watcher changes nothing and the healthcheck fails.

## Architecture

```
Lightroom ─SMB─▶ Published/ ──rw──▶ photos ──▶ index.sqlite ◀──ro── site
                     │                ▲  └─ new album ─▶ GitHub commit ─▶ deploy.sh poller
                     └────ro────▶ img │
visitor ─▶ Cloudflare ─▶ cloudflared ─▶ site (/*), img (/img/*), photos (photos-api host, Access service token)
                                                                  ▲
                                                       cms-dashboard (Vercel)
```

- **`photos`**: the watcher, the index (`node:sqlite`) and the dashboard's write API. `Published` is mounted read-write only here, and nothing else of `/photography` is mounted anywhere. `mem_limit` 192 MB.
- **`img`**: Node and sharp, two jobs at a time, 512 MB, low CPU shares, no secrets, `Published` read-only. On a miss it resizes, writes the result to the disk cache and serves it.
- **`site`**: reads the index where it calls Cloudinary Search today.
- **URL:** `https://liambsullivan.com/img/upload/<transform>/v<version>/<id>.<ext>`. The builders insert the transform after `/upload/` by string replacement, so they keep working. The version is the content hash, so a replacement is a new URL and responses can be `immutable`.
- **Only listed transforms:** widths and crops come from an allowlist; anything else is a 404. Otherwise a crawler could fill the disk and the CPU with arbitrary sizes.
- **Metadata:** every output drops GPS and other EXIF; the colour profile is converted to sRGB.
- **Cache:** outside `/photography`, in the project folder, so snapshots don't fill with files that can be regenerated. Cloudinary's copies come to about 1.7 GB; cap at 5 GB, oldest access first.
- **Index backup:** ids, dashboard tags and alt text can't be regenerated from the files. `photos` writes `Published/.site/index.json` after each change, so the share's snapshots carry it.

## Measured on the NAS

Sharp 0.34.5, WebP, one core at `nice 15`, 12 published originals:

| Output | Median | Slowest |
|---|---|---|
| 480 px | 0.14 s | 0.27 s |
| 800 px | 0.25 s | 0.35 s |
| 1280 px | 0.46 s | 0.80 s |
| 2400 px | 1.4 s | 2.6 s |
| Six previews from one decode | 1.4 s | 1.8 s |

- 24 cold thumbnails: 2.1 s with two jobs at once, 106 MB. Lightbox sizes peaked at 285 MB.
- Previews are made when a photo arrives (about 20 minutes for the whole library, once). Lightbox sizes are made on first view.
- The lightbox ladder drops from up to 22 widths to 1280, 1920, 2560 and 3840 plus the original width. About 5,000 image requests a month over about 14,000 URLs means the edge often misses, so fewer URLs matter more than edge TTL; the disk cache does most of the work.

## What replaces each Cloudinary feature

| Feature | Replacement |
|---|---|
| Search (pool, album, public search, CMS library) | Queries on the index, same sort (`created_at desc`) and same JSON. Existing photos keep their Cloudinary `created_at`. |
| Tags | Index rows; add and remove in batches as now. The 18 tags are copied over once. |
| `c_limit`, `c_fill`, `c_pad`, `e_blur`, `ar_` | sharp `resize`, `extend`, `blur`. |
| `g_auto` | `sharp.strategy.attention`. Crops will differ from Cloudinary's; compare the covers and cards side by side before switching. |
| `g_face` (only `/me`) | A fixed crop. |
| `q_auto`, `q_auto:best`, `q_auto:low` | 78, 85, 40. Check by eye on the 12 samples first. |
| `f_auto` | WebP. |
| Signed browser upload | `POST` to the `photos` API, writing into `Published`. The browser gets a short-lived signature from the dashboard server, as now. |
| Site images | Server upload to `_site/`, manifest entry written as now. |
| Delete | Moves the file to `Published/.site/deleted/` for 30 days, then purges its URLs at Cloudflare (needs the Cache Purge permission; not checked on the current token). |

## Phases

1. **Fill `Published`.** A script that copies files and writes the first `index.json`. Uses the NAS export where it is the same photo at the same or larger size and looks the same, otherwise Cloudinary's original. The export's bytes differ from the published ones, so each substitution is listed for review before anything is copied. Also the 79 `site/` images. The 8 Cloudinary samples are left out. Writing to the share needs its exact command approved first.
2. **`photos`: watcher and index.** Unit tests for ready, replace, move, removal and the mass-removal stop. Runs beside Cloudinary, and `scripts/parity.mjs` compares its JSON with the live routes by value for this phase.
3. **`img`.** Golden tests for each transform, the allowlist and EXIF stripping. Compose services, cache rule for `/img/*`, staging first.
4. **Site.** `IMAGE_BACKEND` in `src/lib/cloudinary*.ts`, `photos.ts` and `albums.ts`. Both values covered by tests.
5. **cms-dashboard.** The same flag in `server/utils/cloudinary.ts`, the upload queue and thumbnail helper. `tests/cms` and the dashboard's `scripts/contract.mjs` change in the same window. The upload page stays; cover choice, order, titles and tags become its main job.
6. **Switch.** Flag to `nas` on both, parity run, two-week soak with Cloudinary untouched, then close the account and delete its secrets.

Rough effort: 2 to 3 weeks. Phase 5 is the largest.

`tests/cms` and the content collections were off limits in the original brief because cms-dashboard depends on both. Phase 5 changes the tests on purpose, in step with that repo. The collections' schemas don't change.

## Needs Liam

- How to fill the other 378 photos: the NAS exports (reviewed list) or Cloudinary's copies.
- A GitHub token for `photos`, limited to contents read/write on this repo, saved in the project `.env`. New albums are committed to `main`, which deploys.
- OK for each NAS command, for the new Cloudflare hostname, Access policy and cache rule, and for merging to `main`.
- Confirmation that the `photography` snapshots replicate off the NAS. Snapshots on the same volume don't survive losing it.

## Staged on 2026-11-23

Liam approved using Cloudinary's copies for the 463 photos with no finished file found.

- Cloudinary's originals went to `Exports/Cloudinary/<album>/<id>.jpg`, then were copied to `Published/<album>/<id>.jpg`. 28 folders, 1.9 GB. Every file's MD5 matches Cloudinary's etag in both places, with no extra files.
- Folder names are the album title plus `M-DD` from the album's date; photos in no album are in `_unsorted`. The file name is the photo's id, so the first index maps files to ids without guessing. These albums already exist as YAML: the first index must link each folder to its slug, or the watcher would create it again.
- **Low resolution:** 184 of them (all the October 2025 uploads) are 1024 px or smaller, which is what the site shows today. A larger export saved over the same file name replaces it and keeps its id.
- `Exports/c52mtsxl1yd10whoowa5.jpg` is Liam's own hand download of one of them.
- Tags aren't in the files; they still exist only in Cloudinary until phase 1 copies them.
- Still to do: the other 378 photos, the tags and the 79 `site/` images.

## Published photos with no finished file found

Compared on 2026-11-23 by image content (256-bit difference hash; spot-checked by eye at the loosest accepted distances). A heavily cropped export wouldn't match. `Exports` was searched in full (JPEG and TIFF; not its 4 PSDs), plus `Portfolio`, `2023`, `2024` and `2026 Photos`, `35mm Film Digitized`, `BridgePittsburgh Flics`, `From POP To Personal`, `TPN Sophomore Year` and `misc` (JPEG). `2025 Photos` holds only RAWs.

| | Photos |
|---|---|
| Published | 841 |
| In `Exports` | 281 (249 at the published size or larger) |
| In `Portfolio` only | 97 |
| Not found | 463 |

Not found, by album:

| Date | Album | Missing |
|---|---|---|
| 2018-01-04 | Forrest Nottingham Winter | 11 of 24 |
| 2021-02-21 | Elle Levi Mendelsohn Shoot | 10 of 15 |
| 2022-02-12 | AP Studio Art - Blue | 2 of 5 |
| 2022-06-20 | Yuliya | 4 of 8 |
| 2024-10-12 | Pitt FB v. Cal | 9 of 9 |
| 2024-10-25 | Pitt MSOC v. UVA | 7 of 7 |
| 2024-11-09 | Pitt FB v. UVA | 10 of 10 |
| 2024-11-18 | Pitt MBB v. VMI | 18 of 18 |
| 2024-12-07 | Pitt Volleyball v. Oklahoma | 9 of 9 |
| 2024-12-12 | Pitt Volleyball v. Oregon | 22 of 22 |
| 2025-01-23 | Pitt WBB v. Virginia Tech | 5 of 5 |
| 2025-01-26 | Pitt Gymnastics v. Stanford | 8 of 8 |
| 2025-02-28 | Haven - Feb 2025 | 10 of 10 |
| 2025-03-15 | Haven - March 2025 | 18 of 18 |
| 2025-03-15 | St. Patrick's Day 2025 - Ginger Run | 5 of 5 |
| 2025-08-09 | Otakon 2025 | 26 of 26 |
| 2025-08-10 | Supernova 2025 | 11 of 11 |
| 2025-09-19 | Makenzie Wolf | 21 of 21 |
| 2025-09-26 | Pitt MSOC v. NC State | 12 of 12 |
| 2025-11-15 | Pitt FB v. Notre Dame | 35 of 35 |
| 2026-02-12 | Pitt WBB v. Syracuse | 8 of 8 |
| 2026-04-11 | Bigelow Bash 2026 | 34 of 34 |
| 2026-04-11 | Pittsburgh Car Show | 18 of 18 |
| 2026-04-24 | NFL Draft 2026 | 12 of 12 |
| 2026-05-30 | Amelia Harn | 12 of 12 |
| 2026-06-04 | Jocelyn Bilton | 12 of 12 |
| 2026-07-31 | Otakon 2026 | 32 of 32 |
| | In no album | 82 |

From Notre Dame 2025 on (163 photos), the published files name their RAW, and all 163 names are in `2025 Photos` or `2026 Photos`; 131 also match its date. The other 300 name none.
