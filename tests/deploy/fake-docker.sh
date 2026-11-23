#!/usr/bin/env bash
# Stand-in for `docker` in tests/deploy: just enough of build, image, inspect,
# run, exec, rm and compose for deploy/deploy.sh, with state in $FAKE_DOCKER_STATE:
#   calls               every invocation, one per line
#   images              personal-website tags, newest first (images-<name> for others)
#   site                the tag `site` runs (no file: not running)
#   img, photos, repo, cms   the same for those services
#   build-fail          present: builds fail; holding a name, only that image's
#   candidate-unhealthy present: the candidate's checks fail
#   site-unhealthy      tags whose `site` container fails its checks
#   unhealthy           services whose own healthcheck fails
set -u
state="$FAKE_DOCKER_STATE"
echo "$*" >>"$state/calls"

images_of() { local name="${1%%:*}"; [[ "$name" == personal-website ]] && echo "$state/images" || echo "$state/images-$name"; }
tag_of() { echo "${1##*:}"; }

case "$1" in
  build)
    image=""
    while (($#)); do [[ "$1" == --tag ]] && image="$2"; shift; done
    if [[ -f "$state/build-fail" ]]; then
      only="$(cat "$state/build-fail")"
      [[ -z "$only" || "$image" == "$only":* ]] && { echo "npm run build failed" >&2; exit 1; }
    fi
    list="$(images_of "$image")"; tag="$(tag_of "$image")"; touch "$list"
    { echo "$tag"; grep -vx "$tag" "$list"; } >"$list.new"
    mv "$list.new" "$list"
    ;;
  image)
    list="$(images_of "${3:-}")"
    [[ "$2" == prune ]] || touch "$list"
    case "$2" in
      inspect) grep -qx "$(tag_of "$3")" "$list" ;;
      ls) cat "$list" ;;
      rm) grep -vx "$(tag_of "$3")" "$list" >"$list.new"; mv "$list.new" "$list" ;;
      prune) ;;
    esac
    ;;
  inspect)
    service="${*: -1}"; service="${service%%-*}"
    grep -qx "$service" "$state/unhealthy" 2>/dev/null && echo unhealthy || echo healthy
    ;;
  run) echo "candidate-id" ;;
  exec)
    if [[ "$2" == *-candidate ]]; then
      [[ ! -f "$state/candidate-unhealthy" ]]
    else
      running="$(cat "$state/site" 2>/dev/null)"
      ! grep -qx "$running" "$state/site-unhealthy" 2>/dev/null
    fi
    ;;
  rm) ;;
  compose)
    shift
    envfile=""
    files=" "
    while [[ "${1:-}" == -* ]]; do
      [[ "$1" == --env-file ]] && envfile="$2"
      [[ "$1" == -f ]] && { [[ -f "$2" ]] || { echo "no $2" >&2; exit 1; }; files+="$(basename "$2") "; }
      shift 2
    done
    command="$1"; shift
    [[ "$command" == version ]] && exit 0
    value() { local v="${!1:-}"; [[ -n "$v" ]] || v="$(grep "^$1=" "$envfile" | tail -n 1 | cut -d= -f2)"; echo "$v"; }
    # As compose does with ${SITE_SHA:?}: every command needs it.
    [[ -n "$(value SITE_SHA)" ]] || { echo "SITE_SHA is not set in .env" >&2; exit 1; }
    stack="$(value STACK)"; stack="${stack:-personal-website}"
    named=()
    for arg in "$@"; do [[ "$arg" == -* || "$arg" == running ]] || named+=("$arg"); done
    if ((${#named[@]} == 0)); then
      named=(site)
      [[ "$files" == *" compose.photos.yaml "* ]] && named+=(img photos repo)
      [[ "$files" == *" compose.cms.yaml "* ]] && named+=(cms)
    fi
    case "$command" in
      up)
        for service in "${named[@]}"; do
          case "$service" in
            site) sha="$(value SITE_SHA)"; list="$(images_of "$stack")" ;;
            cms) sha="$(value CMS_SHA)"; list="$(images_of "$stack-cms")" ;;
            *) sha="$(value PHOTOS_SHA)"; list="$(images_of "$stack-photos")" ;;
          esac
          [[ -n "$sha" ]] && grep -qx "$sha" "$list" || { echo "no such image: $service $sha" >&2; exit 1; }
          echo "$sha" >"$state/$service"
        done
        ;;
      down) rm -f "$state/site" "$state/img" "$state/photos" "$state/repo" "$state/cms" ;;
      rm) for service in "${named[@]}"; do rm -f "$state/$service"; done ;;
      ps) for service in "${named[@]}"; do [[ -f "$state/$service" ]] && echo "$service-$(cut -c1-12 "$state/$service")"; done ;;
    esac
    ;;
esac
exit $?
