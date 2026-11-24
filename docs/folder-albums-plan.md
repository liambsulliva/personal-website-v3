# Folder albums plan: a folder in `Published` is an album

Branch: `env/folder-albums` (from `env/self-host` f62b759); the dashboard's half is `env/folder-albums` in cms-dashboard. Agreed with Liam on 2026-11-23/24, decision by decision. It replaces the album parts of `docs/photo-pipeline-plan.md` (album files in this repo, commits by the watcher, the removal limit). Built on this branch, proven on staging first; production switches later ("Switch", below).

## Where things stood

- Production runs on the NAS from `main` with Cloudinary, in a soak that ends 2026-12-04. Nothing here touches `main` or production.
- Staging runs `IMAGE_BACKEND=nas` from the `staging` branch against the one real `/volume1/photography/Published`. The watcher scanned every 60 s and kept a JSON index, backed up to `Published/.site/index.json`.
- Albums were 53 YAML files in `src/content/albums`, built into the site. The index linked each to its folder (`index.albums[slug] = { folder, known }`).
- Checked on 2026-11-23, the YAML against what folders alone give: titles and membership match for all 53. Dates are wrong for the 23 albums before 2024 (678 of 842 files carry no capture time, and the folder name has no year), order differs for 44 (40 different covers), and a slug derived from the folder differs for 43. No photo is in two albums, no folder is nested, no two files share bytes, no album is under 5 photos. So a one-time copy from the YAML is what keeps the site unchanged.
- `2026-preview` exists only as a YAML file on `staging` (8202626); its one photo is `_unsorted/c1dhrfqby05a2u52qiwy.jpg`.

## Albums are folders

- Every folder in `Published`, at any depth, is an album. Its title is the folder name, with an optional trailing `M-DD` removed.
- Each album has an `album.yaml` in its folder, visible in Finder, written by the watcher and by the dashboard. There is no title field.

  | Field | |
  |---|---|
  | `link` | This folder's own link segment, set once. |
  | `date` | Optional. Else the earliest capture time; else the folder's `M-DD` in the year the photos arrived. |
  | `order` | Optional list of file names; the first three are the cover. Sub-album folder names may be listed too. Photos not listed follow by capture time, then name. |
  | `was` | Old full links (see Links). |

- A photo is in one album or none. Tags and alt text stay in the index.
- Files directly in `Published`, and files in any `_` or `.` folder at any depth, are published with no album. Such folders are never albums. (Open: see "Questions".)
- The same bytes in two places: the older one stays published, the copy is ignored and flagged in the dashboard.
- The 53 existing albums keep today's dates, order, covers and links, copied once from the YAML into their `album.yaml` files. The copy is repeatable and changes nothing visible.

## What is shown

- Top-level albums are the stack carousel. Sub-albums appear only as tiles inside their parent: the same three-print stack card with title and count, placed before the photos, ordered by `order` if listed, else newest first.
- A folder's own photos are only the files directly in it. Its label counts everything beneath it. With no photos of its own, its cover comes from its first sub-album.
- A folder with no sub-albums needs 5 photos to be shown, at any depth. A folder with at least one sub-album is exempt. A folder that would open to nothing (no photos of its own and no visible sub-album) is never shown.
- Photos of hidden albums still appear in the full gallery. Nothing is held back: an album appears at its fifth photo and grows.

## Links and navigation

- The address is a path: `/photography/2026-otakon-2026/day-1`. Each folder contributes its own segment, fixed when that album first becomes visible, and kept in its `album.yaml`. A rename never changes it. Top-level segments are `<year>-<title>[-<mmdd>]` as before; a sub-album's segment is its title alone (`day-1`), with `-2` on a clash inside the same parent or at the top level.
- The 53 existing `?album=<slug>` links redirect to the new paths. `?tag=` links keep working.
- A sub-album moved to another parent gets its old full link added to `was` by the watcher, and the old link redirects. A current link always beats an old one; if two albums claim the same old link, neither gets it. A link to nothing shown opens the full gallery with the existing "not found" note.
- Breadcrumbs in the site header, top left, show titles (`Photography / Otakon 2026 / Day 1`); each crumb opens that level, and `Photography` is the full gallery. A back button by the photo set, placed like the share icon, goes to the parent. Opening an album or sub-album fades the current set out and the new one in, and the address changes with it, so the browser's back button works and the share icon shares that level.

## Speed and removals

- The watcher scans every 10 s and accepts a file after two matching scans. Roadmap, not built: kernel file events, with the scan as the fallback.
- The photography page and its JSON routes are not cached by Cloudflare; the site answers from the index in memory. Images keep their hashed, immutable URLs. The Cloudflare cache-rule change is Liam's to approve as an exact command or setting.
- Up to 99 photos missing at once is a real delete and goes through. 100 or more changes nothing until Liam presses "Confirm removal" in the dashboard, which shows the count and folders. No timer, and no `.allow-removals` file.
- An empty or unreadable `Published` is a failed scan that changes nothing, however long it lasts.
- A broken `album.yaml` falls back to the last good values (the index keeps a copy) and is flagged in the dashboard; a deleted one is written again.

## Dashboard

- Every album action is a file operation in `Published` through the photo service's API, applied at once with no stage or publish step: create (makes a folder), rename (renames the folder, keeping an existing `M-DD` suffix; albums made in the dashboard get none), reorder, cover, date, move photos between albums and `_unsorted`, and move an album into or out of another album.
- "Remove album" moves its photos to `_unsorted` and its sub-albums up one level. There is no "delete album and photos". Deleting photos keeps the 30-day trash.
- Entries, career, sections and site images still go through staging and `services/repo`.
- The photo service loses its route to `services/repo`: no `albums` space, no `PUBLISH_ALBUMS`, no `services/photos/github.mjs`, no album commits. Nothing that touches photos can reach the GitHub token.

## Removed on this branch

`main` only gets it at the switch: the `albums` content collection and its 53 YAML files, the Cloudinary code path and the `IMAGE_BACKEND` flag, and `npm run photos:albums`. `tests/cms` and the dashboard's `scripts/contract.mjs` change together, for albums only. Rollback is deploying the commit from before the switch. The Cloudinary account itself stays open and untouched until Liam closes it.

## Switch

Liam's, not run from this branch.

1. Everything is proven on staging first.
2. Production switches only after the soak ends on 2026-12-04, and after a Hyper Backup of `Published` to Cloudflare R2 (`docs/photo-backup.md`) has been restored from once.
3. Until then Liam publishes into `Published` only and production stands still, so there is nothing to reconcile.
4. At the switch the production dashboard moves to the NAS behind Cloudflare Access, and the Vercel dashboard and its GitHub token are retired.
5. `2026-preview` and its one photo are removed.

## Questions

Asked of Liam; the rest of the plan doesn't wait for them.

- **`.` folders.** Publishing files in any `.` folder would publish `.site/deleted`, the 30-day trash. Until Liam says otherwise `.` folders stay ignored, as they were; `_` folders follow the rule above, except `_site` at the top, which holds site imagery and has never been in the gallery.
