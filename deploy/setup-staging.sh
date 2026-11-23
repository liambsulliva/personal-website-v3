#!/usr/bin/env bash
# Sets up staging on the NAS, once, as root (docs/staging.md). Safe to re-run:
# it keeps an existing .env and task. It only creates
# /volume1/docker/projects/personal-website-staging and one DSM task, and only
# reads the live project's .env (Cloudinary and RAWG settings).
#
# The tunnel's token is the first line on stdin:
#   sudo bash setup-staging.sh < token
set -euo pipefail

main() {
  export PATH="$PATH:/usr/local/bin:/usr/local/sbin:/usr/syno/bin"
  local live=/volume1/docker/projects/personal-website
  local project=/volume1/docker/projects/personal-website-staging
  local token key
  umask 022

  echo "== $(date -u +%FT%TZ)"
  awk '/MemAvailable|SwapFree/ { printf "%s %d MB\n", $1, $2 / 1024 }' /proc/meminfo
  df -h /volume1 | tail -n 1

  # As the live project: root runs code from here, so nobody else may write to it.
  mkdir -p "$project"
  synoacltool -del "$project" >/dev/null 2>&1 || true
  chown root:administrators "$project"
  chmod 750 "$project"

  if [[ -f "$project/.env" ]]; then
    echo "keeping the existing .env"
  else
    IFS= read -r token
    [[ ${#token} -gt 100 ]] || { echo "expected the tunnel token on stdin" >&2; return 1; }
    (
      umask 077
      {
        for key in CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET RAWG_API_KEY; do
          sed -n "s/^$key=/$key=/p" "$live/.env" | tail -n 1
        done
        echo "TUNNEL_TOKEN=$token"
        echo "TUNNEL_PROTOCOL=$(sed -n 's/^TUNNEL_PROTOCOL=//p' "$live/.env" | tail -n 1)"
        echo "STACK=personal-website-staging"
        echo "DEPLOY_BRANCH=staging"
        echo "IMAGE_BACKEND=nas"
        echo "PHOTOS=1"
        echo "PHOTOS_USER=$(stat -c '%u:%g' /volume1/photography/Published)"
        echo "PHOTOS_API_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
        echo "PUBLISH_ALBUMS=0"
        echo "DRAFTS_BRANCH=drafts-staging"
        echo "SITE_SHA="
        # A plain `docker compose` in this folder sees the photo services too.
        echo "COMPOSE_FILE=compose.yaml:compose.photos.yaml"
      } >"$project/.env"
    )
    chown liambsulliva:users "$project/.env"
    chmod 600 "$project/.env"
    # Names only.
    echo "wrote .env: $(sed -n 's/=.*//p' "$project/.env" | tr '\n' ' ')"
  fi

  [[ -f /volume1/photography/Published/.site/index.json ]] || { echo "no Published/.site/index.json: the photo services can't start without it" >&2; return 1; }

  if [[ ! -d "$project/repo/.git" ]]; then
    docker run --rm -v "$project:$project" alpine/git:v2.52.0 clone --quiet --branch staging https://github.com/liambsulliva/personal-website-v3.git "$project/repo"
  fi
  echo "repo at $(docker run --rm -v "$project:$project" -w "$project/repo" alpine/git:v2.52.0 -c safe.directory='*' rev-parse --short HEAD)"

  # The files as compose reads them, before anything runs.
  SITE_SHA=check PHOTOS_SHA=check docker compose -p personal-website-staging --project-directory "$project" \
    -f "$project/repo/deploy/compose.yaml" -f "$project/repo/deploy/compose.photos.yaml" --env-file "$project/.env" config --quiet && echo "compose files are valid"

  task "$project"
}

task() {
  local name="personal-website staging deploy" api=/usr/syno/bin/synowebapi id schedule extra
  id="$($api --exec api=SYNO.Core.TaskScheduler method=list version=3 2>/dev/null | jq -r --arg n "$name" '.data.tasks[]? | select(.name == $n) | .id')"
  if [[ -n "$id" ]]; then
    echo "task exists: $id"
  else
    schedule="$(jq -cn --arg d "$(date +%Y/%m/%d)" '{date:$d,date_type:0,hour:0,last_work_hour:23,minute:0,monthly_week:[],repeat_date:1001,repeat_hour:0,repeat_hour_store_config:[range(1;24)],repeat_min:5,repeat_min_store_config:[1,5,10,15,20,30],version:4,week_day:"0,1,2,3,4,5,6"}')"
    extra="$(jq -cn --arg s "bash $1/repo/deploy/deploy.sh >/dev/null 2>&1" '{notify_enable:false, notify_if_error:false, notify_mail:"", script:($s + "\n")}')"
    $api --exec api=SYNO.Core.TaskScheduler method=create version=4 name="\"$name\"" owner='"root"' real_owner='"root"' \
      enable=true type='"script"' schedule="$schedule" extra="$extra" 2>/dev/null | jq -c '{success, error}'
  fi
  $api --exec api=SYNO.Core.TaskScheduler method=list version=3 2>/dev/null \
    | jq -c --arg n "$name" '.data.tasks[]? | select(.name == $n) | {id, name, owner, enable, next_trigger_time}'
}

main
