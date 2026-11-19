#!/usr/bin/env bash
# Redeploy the site when main moves (docs/self-host-plan.md, "Deploys").
#
# DSM Task Scheduler runs it as root every 5 minutes:
#   bash /volume1/docker/projects/personal-website/repo/deploy/deploy.sh
#
# The project folder (PROJECT_DIR, default two levels above this file):
#   .env           secrets, TUNNEL_TOKEN, SITE_SHA (the commit that is serving)
#   compose.yaml   copied from repo/deploy/ on each deploy, so `docker compose` works there
#   repo/          this repo's own clean clone, never an agent's checkout
#   deploy.log     what each run did; build.log holds the last build's output
#
# Each run: compare `git ls-remote` with SITE_SHA and stop if they match.
# Otherwise fetch, build personal-website:<sha> (memory and CPU capped), start
# it beside the live container and check /healthz, /photography and a
# Cloudinary route, then point compose at it and recreate `site`. A failed
# build or check leaves the old container serving. A commit whose build
# failed is not rebuilt until main moves again (FORCE=1 overrides).
#
# Exit status: 0 nothing to do, deployed, or another run holds the lock;
# 1 something failed and the old container is still serving.
#
# Overrides (tests, other hosts): PROJECT_DIR, REMOTE_URL, DEPLOY_BRANCH,
# HEALTH_TIMEOUT (s), BUILD_MEMORY, KEEP_IMAGES, FORCE.
set -euo pipefail

# Everything runs inside main, which bash reads whole before running: the
# fetch below rewrites this file mid-run.
main() {
  # Task Scheduler's PATH can lack /usr/local/bin, where DSM keeps docker.
  export PATH="${PATH:-/usr/bin:/bin}:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin"

  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  PROJECT_DIR="${PROJECT_DIR:-$(cd "$here/../.." && pwd)}"
  REPO_DIR="$PROJECT_DIR/repo"
  ENV_FILE="$PROJECT_DIR/.env"
  LOG="$PROJECT_DIR/deploy.log"
  BUILD_LOG="$PROJECT_DIR/build.log"
  FAILED_FILE="$PROJECT_DIR/.deploy-failed"
  REMOTE_URL="${REMOTE_URL:-https://github.com/liambsulliva/personal-website-v3.git}"
  BRANCH="${DEPLOY_BRANCH:-main}"
  IMAGE="personal-website"
  CANDIDATE="personal-website-candidate"
  HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
  BUILD_MEMORY="${BUILD_MEMORY:-1536m}"
  KEEP_IMAGES="${KEEP_IMAGES:-3}"

  [[ -f "$ENV_FILE" ]] || { log "no $ENV_FILE; copy deploy/.env.example there first"; return 1; }
  lock || return 0
  trap cleanup EXIT

  local current remote failed
  current="$(env_get SITE_SHA)"
  remote="$(git_ ls-remote "$REMOTE_URL" "refs/heads/$BRANCH" 2>>"$LOG" | cut -f1)" || remote=""
  if [[ ! "$remote" =~ ^[0-9a-f]{40}$ ]]; then
    log "could not read $BRANCH from $REMOTE_URL"
    return 1
  fi

  if [[ "$remote" == "$current" ]]; then
    # Up to date. Bring the stack back if something stopped it.
    if [[ -z "$(compose ps --status running --quiet site 2>/dev/null)" ]]; then
      log "site is not running at ${current:0:12}; starting it"
      compose up -d >>"$LOG" 2>&1 || { log "compose up failed"; return 1; }
    fi
    return 0
  fi

  failed="$(cat "$FAILED_FILE" 2>/dev/null || true)"
  if [[ "$remote" == "$failed" && "${FORCE:-0}" != 1 ]]; then
    return 0 # logged when it failed; waits for the next push
  fi

  log "main is at ${remote:0:12}, serving ${current:-nothing}"
  fetch "$remote" || { log "fetch failed"; return 1; }

  if docker image inspect "$IMAGE:$remote" >/dev/null 2>&1; then
    log "image $IMAGE:${remote:0:12} already built"
  elif ! build "$remote"; then
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
  prune "$remote"
  log "deployed ${remote:0:12}"
}

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
    docker run --rm -v "$PROJECT_DIR:$PROJECT_DIR" -w "$PWD" alpine/git:v2.52.0 "$@"
  fi
}

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/compose.yaml" --env-file "$ENV_FILE" "$@"
  else
    docker-compose --project-directory "$PROJECT_DIR" -f "$PROJECT_DIR/compose.yaml" --env-file "$ENV_FILE" "$@"
  fi
}

# The clone at exactly <sha>, with nothing else in the tree.
fetch() {
  if [[ ! -d "$REPO_DIR/.git" ]]; then
    git_ clone --quiet --no-checkout "$REMOTE_URL" "$REPO_DIR" >>"$LOG" 2>&1 || return 1
  fi
  # Fetch from REMOTE_URL, not whatever the clone was first made from (a
  # bundle, a mirror): ls-remote above read REMOTE_URL.
  (cd "$REPO_DIR" &&
    git_ remote set-url origin "$REMOTE_URL" &&
    git_ fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" &&
    git_ checkout --quiet --force --detach "$1" &&
    git_ clean -ffdxq) >>"$LOG" 2>&1
}

# The legacy builder takes --memory and --cpu-shares (BuildKit does not), so a
# build that outgrows BUILD_MEMORY fails instead of pushing the NAS into swap,
# and other containers keep priority. `nice` alone would only slow the CLI.
build() {
  local cloud
  cloud="$(env_get CLOUDINARY_CLOUD_NAME)"
  local limit=()
  # A hung build would hold the lock forever; a normal one takes a few minutes.
  command -v timeout >/dev/null 2>&1 && limit=(timeout 1800)
  log "building ${1:0:12}"
  if DOCKER_BUILDKIT=0 nice -n 15 ${limit[@]+"${limit[@]}"} docker build \
    --memory "$BUILD_MEMORY" --memory-swap "$BUILD_MEMORY" --cpu-shares 256 \
    --build-arg CLOUDINARY_CLOUD_NAME="$cloud" --build-arg SITE_SHA="$1" \
    --tag "$IMAGE:$1" "$REPO_DIR" >"$BUILD_LOG" 2>&1; then
    log "built $IMAGE:${1:0:12}"
    return 0
  fi
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
  # /photography renders even when Cloudinary fails; the pool route doesn't.
  local path
  for path in /photography /api/cloudinary/pool; do
    probe "$1" "$path" || { log "$1: $path did not answer 200"; return 1; }
  done
}

# The new image, started on its own beside the live one and checked.
check_candidate() {
  local name
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
  CANDIDATE_STARTED=1
  # Values come from this process's environment, never the command line.
  for name in CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET RAWG_API_KEY; do
    export "$name=$(env_get "$name")"
  done
  docker run --detach --name "$CANDIDATE" --read-only --tmpfs /tmp:size=16m --memory 384m \
    -e CLOUDINARY_CLOUD_NAME -e CLOUDINARY_API_KEY -e CLOUDINARY_API_SECRET -e RAWG_API_KEY \
    "$IMAGE:$1" >/dev/null 2>>"$LOG" || return 1
  local ok=0
  healthy "$CANDIDATE" || ok=1
  docker rm -f "$CANDIDATE" >/dev/null 2>&1 || true
  return $ok
}

# Point .env and compose.yaml at <sha> and recreate `site`; back to <previous> if it fails.
switch_to() {
  local sha="$1" previous="$2"
  [[ -f "$PROJECT_DIR/compose.yaml" ]] && cp "$PROJECT_DIR/compose.yaml" "$PROJECT_DIR/compose.yaml.previous"
  cp "$REPO_DIR/deploy/compose.yaml" "$PROJECT_DIR/compose.yaml"
  env_set SITE_SHA "$sha"
  if compose up -d --remove-orphans >>"$LOG" 2>&1 && healthy "$(site_container)"; then
    return 0
  fi
  log "the new site failed after the switch; rolling back to ${previous:-nothing}"
  env_set SITE_SHA "$previous"
  [[ -f "$PROJECT_DIR/compose.yaml.previous" ]] && cp "$PROJECT_DIR/compose.yaml.previous" "$PROJECT_DIR/compose.yaml"
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

# Keep the serving image and the newest KEEP_IMAGES; drop the rest.
prune() {
  local tag kept=0
  while read -r tag; do
    [[ -z "$tag" || "$tag" == "<none>" ]] && continue
    if [[ "$tag" == "$1" ]] || ((kept < KEEP_IMAGES)); then
      kept=$((kept + 1))
      continue
    fi
    docker image rm "$IMAGE:$tag" >/dev/null 2>&1 && log "removed image $IMAGE:${tag:0:12}"
  done < <(docker image ls "$IMAGE" --format '{{.Tag}}')
  docker image prune --force >/dev/null 2>&1 || true
}

main "$@"; exit $?
