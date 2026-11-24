#!/usr/bin/env bash
# Redeploy the site when its branch moves (docs/self-host-plan.md, "Deploys").
# The live project follows main; staging (docs/staging.md) is a second project
# folder with its own .env, following another branch.
#
# DSM Task Scheduler runs it as root every 5 minutes, from a copy only root can
# change:
#   bash /volume1/docker/projects/personal-website/deploy/deploy.sh
#
# Root runs nothing a push can change: this file and the compose files come
# from that folder, and pin.sh, run by hand, is the only way they change. A push
# decides what's built and run inside the containers, which have no other share
# of the NAS mounted and no capabilities.
#
# The project folder (PROJECT_DIR, default the folder above this one):
#   deploy/        this file and the compose files, pinned by pin.sh
#   .env           secrets, TUNNEL_TOKEN, SITE_SHA (the image tag that is serving)
#   compose*.yaml  copied from deploy/ on each deploy, so `docker compose` works there
#   repo/          this repo's own clean clone, never an agent's checkout
#   cms/           cms-dashboard's clone, only with CMS_BRANCH set
#   deploy.log     what each run did; build.log holds the last build's output
#
# Each run: compare `git ls-remote` with SITE_SHA and stop if they match.
# Otherwise fetch, build <stack>:<sha> (memory and CPU capped), start it beside
# the live container and check /healthz, /photography and a photo route, then
# point compose at it and recreate `site`. A failed build or check leaves the
# old container serving. A commit whose build failed is not rebuilt until the
# branch moves again (FORCE=1 overrides).
#
# Optional, in .env:
#   STACK          compose project and image name (personal-website)
#   DEPLOY_BRANCH  the branch to follow (main)
#   PHOTOS=1       also run the photo services (compose.photos.yaml)
#   CMS_BRANCH     also run cms-dashboard from that branch (compose.cms.yaml)
#
# Exit status: 0 nothing to do, deployed, or another run holds the lock;
# 1 something failed and the old container is still serving.
#
# Overrides (tests, other hosts): PROJECT_DIR, REMOTE_URL, CMS_URL,
# DEPLOY_BRANCH, HEALTH_TIMEOUT (s), BUILD_MEMORY, KEEP_IMAGES, FORCE.
set -euo pipefail

# Everything runs inside main, which bash reads whole before running, so pin.sh
# can replace this file mid-run.
main() {
  # Task Scheduler's PATH can lack /usr/local/bin, where DSM keeps docker.
  export PATH="${PATH:-/usr/bin:/bin}:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

  # The folder this file is in holds the compose files too.
  PINNED_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_DIR="${PROJECT_DIR:-$(dirname "$PINNED_DIR")}"
  REPO_DIR="$PROJECT_DIR/repo"
  ENV_FILE="$PROJECT_DIR/.env"
  LOG="$PROJECT_DIR/deploy.log"
  BUILD_LOG="$PROJECT_DIR/build.log"
  FAILED_FILE="$PROJECT_DIR/.deploy-failed"
  REMOTE_URL="${REMOTE_URL:-https://github.com/liambsulliva/personal-website-v3.git}"
  CMS_URL="${CMS_URL:-https://github.com/liambsulliva/cms-dashboard.git}"
  HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
  BUILD_MEMORY="${BUILD_MEMORY:-1536m}"
  KEEP_IMAGES="${KEEP_IMAGES:-3}"

  [[ -f "$ENV_FILE" ]] || { log "no $ENV_FILE; copy deploy/.env.example there first"; return 1; }
  STACK="$(env_get STACK)"
  STACK="${STACK:-personal-website}"
  IMAGE="$STACK"
  CANDIDATE="$STACK-candidate"
  BRANCH="${DEPLOY_BRANCH:-$(env_get DEPLOY_BRANCH)}"
  BRANCH="${BRANCH:-main}"
  PHOTOS="$(env_get PHOTOS)"
  CMS_BRANCH="$(env_get CMS_BRANCH)"
  COMPOSE_DIR="$PROJECT_DIR"
  lock || return 0
  trap cleanup EXIT
  if [[ "$PINNED_DIR" == "$REPO_DIR"/* ]]; then
    log "refusing to run from the clone, which a push can change; run deploy/pin.sh"
    return 1
  fi

  # The dashboard is its own repo. A problem there never holds up the site.
  local status=0
  deploy_site || status=1
  if [[ -n "$CMS_BRANCH" ]]; then
    deploy_cms || status=1
  fi
  return $status
}

deploy_site() {
  local current remote failed
  current="$(env_get SITE_SHA)"
  remote="$(git_ ls-remote "$REMOTE_URL" "refs/heads/$BRANCH" 2>>"$LOG" | cut -f1)" || remote=""
  if [[ ! "$remote" =~ ^[0-9a-f]{40}$ ]]; then
    log "could not read $BRANCH from $REMOTE_URL"
    return 1
  fi

  if [[ "$remote" == "$current" && (-z "$PHOTOS" || -n "$(env_get PHOTOS_SHA)") ]]; then
    # Up to date. Bring the stack back if something stopped it.
    local service
    for service in site ${PHOTOS:+img photos repo}; do
      [[ -n "$(compose ps --status running --quiet "$service" 2>/dev/null)" ]] && continue
      log "$service is not running at ${current:0:12}; starting it"
      compose up -d >>"$LOG" 2>&1 || { log "compose up failed"; return 1; }
      break
    done
    return 0
  fi

  failed="$(cat "$FAILED_FILE" 2>/dev/null || true)"
  if [[ "$remote" == "$failed" && "${FORCE:-0}" != 1 ]]; then
    return 0 # logged when it failed; waits for the next push
  fi

  log "$BRANCH is at ${remote:0:12}, serving ${current:-nothing}"
  fetch "$REPO_DIR" "$REMOTE_URL" "$BRANCH" "$remote" || { log "fetch failed"; return 1; }
  # A push can't change what root runs, so say when it would have.
  local file
  for file in deploy.sh compose.yaml compose.photos.yaml compose.cms.yaml; do
    cmp -s "$REPO_DIR/deploy/$file" "$PINNED_DIR/$file" || log "deploy/$file in ${remote:0:12} differs from the pinned one (deploy/pin.sh takes it)"
  done

  # First: a site that reads the photo index needs one to pass its checks.
  if [[ -n "$PHOTOS" ]]; then
    deploy_photos "$remote" || return 1
  fi

  if docker image inspect "$IMAGE:$remote" >/dev/null 2>&1; then
    log "image $IMAGE:${remote:0:12} already built"
  elif ! build_site "$remote"; then
    echo "$remote" >"$FAILED_FILE"
    log "build failed for ${remote:0:12} (see build.log); still serving ${current:0:12}"
    return 1
  fi

  if ! check_candidate "$remote"; then
    log "checks failed for ${remote:0:12}; still serving ${current:0:12}; will retry next run"
    return 1
  fi

  switch_to "$remote" "$current" || return 1
  rm -f "$FAILED_FILE"
  prune "$IMAGE" "$remote"
  log "deployed ${remote:0:12}"
}

# The photo services' image, tagged with the tree of services/, so it's built
# and restarted only when they change.
deploy_photos() {
  local tree current user dir
  # Compose needs some SITE_SHA to read its files, and the first run has none.
  local -x SITE_SHA="$1"
  tree="$(cd "$REPO_DIR" && git_ rev-parse "$1:services" 2>>"$LOG")" || { log "no services/ at ${1:0:12}"; return 1; }
  current="$(env_get PHOTOS_SHA)"
  [[ "$tree" == "$current" ]] && return 0
  if ! docker image inspect "$STACK-photos:$tree" >/dev/null 2>&1; then
    # As a link it would hand docker another folder of the NAS.
    [[ -d "$REPO_DIR/services" && ! -L "$REPO_DIR/services" ]] || { log "services is not a plain folder"; return 1; }
    build "$STACK-photos:$tree" "$REPO_DIR/services" || { log "photo services build failed (see build.log); nothing changed"; return 1; }
  fi
  user="$(env_get PHOTOS_USER)"
  for dir in photos photos/index photos/cache; do
    mkdir -p "$PROJECT_DIR/$dir"
    chown "$user" "$PROJECT_DIR/$dir" || { log "PHOTOS_USER must be uid:gid"; return 1; }
  done
  env_set PHOTOS_SHA "$tree"
  # The project folder's copies still belong to what's serving.
  COMPOSE_DIR="$PINNED_DIR"
  if compose up -d img photos repo >>"$LOG" 2>&1 && running_well img && running_well photos && running_well repo; then
    COMPOSE_DIR="$PROJECT_DIR"
    prune "$STACK-photos" "$tree"
    log "photo services at ${tree:0:12}"
    return 0
  fi
  log "the photo services failed; back to ${current:-nothing}"
  compose rm --stop --force img photos repo >>"$LOG" 2>&1 || true
  COMPOSE_DIR="$PROJECT_DIR"
  env_set PHOTOS_SHA "$current"
  if [[ -n "$current" ]]; then
    compose up -d img photos repo >>"$LOG" 2>&1 || true
  fi
  return 1
}

# cms-dashboard on its own branch. Its repo is private: GITHUB_TOKEN reads it.
deploy_cms() {
  local current remote failed
  current="$(env_get CMS_SHA)"
  git_auth
  remote="$(git_ ls-remote "$CMS_URL" "refs/heads/$CMS_BRANCH" 2>>"$LOG" | cut -f1)" || remote=""
  [[ "$remote" =~ ^[0-9a-f]{40}$ ]] || { git_unauth; log "could not read $CMS_BRANCH from $CMS_URL"; return 1; }
  failed="$(cat "$FAILED_FILE.cms" 2>/dev/null || true)"
  if [[ "$remote" == "$current" ]] || [[ "$remote" == "$failed" && "${FORCE:-0}" != 1 ]]; then
    git_unauth
    if [[ -n "$current" && -z "$(compose ps --status running --quiet cms 2>/dev/null)" ]]; then
      log "cms is not running at ${current:0:12}; starting it"
      compose up -d cms >>"$LOG" 2>&1 || { log "compose up cms failed"; return 1; }
    fi
    return 0
  fi
  # Its compose file comes with the site, which has to be there first.
  [[ -f "$PROJECT_DIR/compose.cms.yaml" ]] || { git_unauth; log "cms waits for the site's first deploy"; return 0; }
  log "cms: $CMS_BRANCH is at ${remote:0:12}, serving ${current:-nothing}"
  fetch "$PROJECT_DIR/cms" "$CMS_URL" "$CMS_BRANCH" "$remote" || { git_unauth; log "cms fetch failed"; return 1; }
  git_unauth
  if ! docker image inspect "$STACK-cms:$remote" >/dev/null 2>&1 && ! build "$STACK-cms:$remote" "$PROJECT_DIR/cms"; then
    echo "$remote" >"$FAILED_FILE.cms"
    log "cms build failed for ${remote:0:12} (see build.log); still serving ${current:0:12}"
    return 1
  fi
  env_set CMS_SHA "$remote"
  if compose up -d cms >>"$LOG" 2>&1 && running_well cms; then
    rm -f "$FAILED_FILE.cms"
    prune "$STACK-cms" "$remote"
    log "cms deployed ${remote:0:12}"
    return 0
  fi
  echo "$remote" >"$FAILED_FILE.cms"
  log "cms failed after the switch; back to ${current:-nothing}"
  compose rm --stop --force cms >>"$LOG" 2>&1 || true
  env_set CMS_SHA "$current"
  [[ -n "$current" ]] && { compose up -d cms >>"$LOG" 2>&1 || true; }
  return 1
}

# GITHUB_TOKEN as a git header, through the environment: never in an argument,
# a URL or the clone's config.
git_auth() {
  local token
  token="$(env_get GITHUB_TOKEN)"
  [[ -n "$token" ]] || return 0
  export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"
  export GIT_CONFIG_VALUE_0="Authorization: Basic $(printf 'x-access-token:%s' "$token" | base64 | tr -d '\n')"
}
git_unauth() { unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0; }

log() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  echo "$line"
  echo "$line" >>"$LOG"
}

# One run at a time: flock where DSM has it, a lock directory otherwise.
lock() {
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$PROJECT_DIR/.deploy.lock"
    flock -n 9 && return 0
  else
    local dir="$PROJECT_DIR/.deploy.lock.d"
    if mkdir "$dir" 2>/dev/null; then
      LOCK_DIR="$dir"
      return 0
    fi
    # A run killed mid-way leaves the directory; it can't be older than an hour.
    if [[ -n "$(find "$dir" -maxdepth 0 -mmin +60 2>/dev/null)" ]]; then
      rm -rf "$dir" && mkdir "$dir" && LOCK_DIR="$dir" && return 0
    fi
  fi
  echo "another deploy is running"
  return 1
}

cleanup() {
  [[ -n "${CANDIDATE_STARTED:-}" ]] && { docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true; }
  [[ -n "${LOCK_DIR:-}" ]] && rm -rf "$LOCK_DIR"
  # Keep deploy.log to its last 2000 lines.
  if [[ -f "$LOG" ]] && (($(wc -l <"$LOG") > 2000)); then
    tail -n 2000 "$LOG" >"$LOG.tmp" && cat "$LOG.tmp" >"$LOG" && rm -f "$LOG.tmp"
  fi
}

# A value from .env (KEY=value, optional quotes), without sourcing it.
env_get() {
  local line
  line="$(grep -E "^[[:space:]]*$1=" "$ENV_FILE" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line#\"}"
  line="${line%\"}"
  line="${line#\'}"
  line="${line%\'}"
  printf '%s' "$line"
}

# Set KEY=value in .env in place, keeping the file's owner and mode.
env_set() {
  local tmp="$ENV_FILE.tmp.$$"
  awk -v key="$1" -v value="$2" '
    BEGIN { done = 0 }
    $0 ~ "^[[:space:]]*" key "=" { if (!done) print key "=" value; done = 1; next }
    { print }
    END { if (!done) print key "=" value }
  ' "$ENV_FILE" >"$tmp"
  cat "$tmp" >"$ENV_FILE"
  rm -f "$tmp"
}

# git on the host if DSM has it (the Git Server package), else in a container.
git_() {
  if command -v git >/dev/null 2>&1; then
    git "$@"
  else
    docker run --rm -v "$PROJECT_DIR:$PROJECT_DIR" -w "$PWD" ${GIT_CONFIG_COUNT:+-e GIT_TERMINAL_PROMPT -e GIT_CONFIG_COUNT -e GIT_CONFIG_KEY_0 -e GIT_CONFIG_VALUE_0} alpine/git:v2.52.0 "$@"
  fi
}

# Compose on the files in COMPOSE_DIR. Always with -p: the project's name is
# what keeps staging's containers apart from the live ones.
compose() {
  local files=(-f "$COMPOSE_DIR/compose.yaml")
  [[ -n "$PHOTOS" && -f "$COMPOSE_DIR/compose.photos.yaml" ]] && files+=(-f "$COMPOSE_DIR/compose.photos.yaml")
  [[ -n "$CMS_BRANCH" && -n "$(env_get CMS_SHA)" && -f "$COMPOSE_DIR/compose.cms.yaml" ]] && files+=(-f "$COMPOSE_DIR/compose.cms.yaml")
  if docker compose version >/dev/null 2>&1; then
    docker compose -p "$STACK" --project-directory "$PROJECT_DIR" "${files[@]}" --env-file "$ENV_FILE" "$@"
  else
    docker-compose -p "$STACK" --project-directory "$PROJECT_DIR" "${files[@]}" --env-file "$ENV_FILE" "$@"
  fi
}

# fetch <clone> <url> <branch> <sha>: the clone at exactly <sha>, with nothing else in the tree.
fetch() {
  if [[ ! -d "$1/.git" ]]; then
    git_ clone --quiet --no-checkout "$2" "$1" >>"$LOG" 2>&1 || return 1
  fi
  # Fetch from the URL, not whatever the clone was first made from (a bundle, a
  # mirror): ls-remote above read the URL.
  (cd "$1" &&
    git_ remote set-url origin "$2" &&
    git_ fetch --quiet origin "+refs/heads/$3:refs/remotes/origin/$3" &&
    git_ checkout --quiet --force --detach "$4" &&
    git_ clean -ffdxq) >>"$LOG" 2>&1
}

build_site() {
  build "$IMAGE:$1" "$REPO_DIR" --build-arg SITE_SHA="$1"
}

# build <image> <dir> [docker build arguments]
#
# The legacy builder takes --memory and --cpu-shares (BuildKit does not), so a
# build that outgrows BUILD_MEMORY fails instead of pushing the NAS into swap,
# and other containers keep priority. `nice` alone would only slow the CLI.
build() {
  local image="$1" dir="$2"
  shift 2
  local limit=() alone=()
  # A hung build would hold the lock forever; a normal one takes a few minutes.
  command -v timeout >/dev/null 2>&1 && limit=(timeout 1800)
  # The live project and staging poll on their own; their builds take turns.
  command -v flock >/dev/null 2>&1 && alone=(flock -w 2400 "$(dirname "$PROJECT_DIR")/.site-build.lock")
  log "building $image"
  if DOCKER_BUILDKIT=0 nice -n 15 ${alone[@]+"${alone[@]}"} ${limit[@]+"${limit[@]}"} docker build \
    --memory "$BUILD_MEMORY" --memory-swap "$BUILD_MEMORY" --cpu-shares 256 \
    "$@" --tag "$image" "$dir" >"$BUILD_LOG" 2>&1; then
    log "built $image"
    return 0
  fi
  return 1
}

# Wait for a service's own healthcheck.
running_well() {
  local id state deadline=$((SECONDS + HEALTH_TIMEOUT + 60))
  id="$(compose ps --quiet "$1" 2>/dev/null | head -n 1)"
  while :; do
    state="$(docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null)" || state=gone
    [[ "$state" == healthy ]] && return 0
    [[ "$state" == unhealthy || "$state" == gone ]] && break
    ((SECONDS < deadline)) || break
    sleep 2
  done
  log "$1 is $state"
  return 1
}

# GET <path> inside <container>, as cloudflared would send it; 0 on a 200.
probe() {
  docker exec "$1" node -e '
    const req = require("http").get(
      { host: "127.0.0.1", port: 4321, path: process.argv[1], timeout: 20000,
        headers: { host: "liambsullivan.com", "x-forwarded-proto": "https" } },
      (res) => { res.resume(); process.exit(res.statusCode === 200 ? 0 : 1); });
    req.on("timeout", () => req.destroy());
    req.on("error", () => process.exit(1));
  ' "$2" >/dev/null 2>&1
}

# Wait for <container>'s /healthz, then check the pages that need upstreams.
healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT))
  until probe "$1" /healthz; do
    ((SECONDS < deadline)) || { log "$1: /healthz did not answer in ${HEALTH_TIMEOUT}s"; return 1; }
    sleep 2
  done
  # /photography renders even when the photo source fails; the pool route doesn't.
  local path
  for path in /photography /api/cloudinary/pool; do
    probe "$1" "$path" || { log "$1: $path did not answer 200"; return 1; }
  done
}

# The new image, started on its own beside the live one and checked.
check_candidate() {
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
  CANDIDATE_STARTED=1
  # Values come from this process's environment, never the command line.
  export RAWG_API_KEY="$(env_get RAWG_API_KEY)"
  docker run --detach --name "$CANDIDATE" --read-only --tmpfs /tmp:size=16m --memory 384m \
    -e RAWG_API_KEY -v "$(index_dir):/index:ro" \
    "$IMAGE:$1" >/dev/null 2>>"$LOG" || return 1
  local ok=0
  healthy "$CANDIDATE" || ok=1
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
  return $ok
}

# PHOTO_INDEX_DIR as a path docker run takes (compose resolves ./ itself).
index_dir() {
  local dir
  dir="$(env_get PHOTO_INDEX_DIR)"
  dir="${dir:-./photos/index}"
  [[ "$dir" == ./* ]] && dir="$PROJECT_DIR/${dir#./}"
  printf '%s' "$dir"
}

# Point .env and compose.yaml at <sha> and recreate `site`; back to <previous> if it fails.
switch_to() {
  local sha="$1" previous="$2" file
  for file in compose.yaml compose.photos.yaml compose.cms.yaml; do
    [[ -f "$PROJECT_DIR/$file" ]] && cp "$PROJECT_DIR/$file" "$PROJECT_DIR/$file.previous"
    [[ -f "$PINNED_DIR/$file" ]] && cp "$PINNED_DIR/$file" "$PROJECT_DIR/$file"
  done
  # A plain `docker compose` run in this folder must act on this project.
  sed "s/^name: .*/name: $STACK/" "$PINNED_DIR/compose.yaml" >"$PROJECT_DIR/compose.yaml"
  env_set SITE_SHA "$sha"
  if compose up -d --remove-orphans >>"$LOG" 2>&1 && healthy "$(site_container)"; then
    return 0
  fi
  log "the new site failed after the switch; rolling back to ${previous:-nothing}"
  env_set SITE_SHA "$previous"
  for file in compose.yaml compose.photos.yaml compose.cms.yaml; do
    [[ -f "$PROJECT_DIR/$file.previous" ]] && cp "$PROJECT_DIR/$file.previous" "$PROJECT_DIR/$file"
  done
  if [[ -n "$previous" ]]; then
    compose up -d >>"$LOG" 2>&1 || log "rollback compose up failed: run 'docker compose up -d' in $PROJECT_DIR"
  else
    compose down >>"$LOG" 2>&1 || true
  fi
  return 1
}

site_container() {
  compose ps --quiet site 2>/dev/null | head -n 1
}

# prune <image> <tag>: keep the serving tag and the newest KEEP_IMAGES; drop the rest.
prune() {
  local tag kept=0
  while read -r tag; do
    [[ -z "$tag" || "$tag" == "<none>" ]] && continue
    if [[ "$tag" == "$2" ]] || ((kept < KEEP_IMAGES)); then
      kept=$((kept + 1))
      continue
    fi
    docker image rm "$1:$tag" >/dev/null 2>&1 && log "removed image $1:${tag:0:12}"
  done < <(docker image ls "$1" --format '{{.Tag}}')
  docker image prune --force >/dev/null 2>&1 || true
}

main "$@"; exit $?
