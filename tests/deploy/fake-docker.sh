#!/usr/bin/env bash
# Stand-in for `docker` in tests/deploy: just enough of build, image, run,
# exec, rm and compose for deploy/deploy.sh, with state in $FAKE_DOCKER_STATE:
#   calls               every invocation, one per line
#   images              personal-website tags, newest first
#   site                the tag `site` runs (no file: not running)
#   build-fail          present: builds fail
#   candidate-unhealthy present: the candidate's checks fail
#   site-unhealthy      tags whose `site` container fails its checks
set -u
state="$FAKE_DOCKER_STATE"
touch "$state/images"
echo "$*" >>"$state/calls"

tag_of() { echo "${1#personal-website:}"; }

case "$1" in
  build)
    [[ -f "$state/build-fail" ]] && { echo "npm run build failed" >&2; exit 1; }
    tag=""
    while (($#)); do [[ "$1" == --tag ]] && tag="$(tag_of "$2")"; shift; done
    { echo "$tag"; grep -vx "$tag" "$state/images"; } >"$state/images.new"
    mv "$state/images.new" "$state/images"
    ;;
  image)
    case "$2" in
      inspect) grep -qx "$(tag_of "$3")" "$state/images" ;;
      ls) cat "$state/images" ;;
      rm) grep -vx "$(tag_of "$3")" "$state/images" >"$state/images.new"; mv "$state/images.new" "$state/images" ;;
      prune) ;;
    esac
    ;;
  run) echo "candidate-id" ;;
  exec)
    if [[ "$2" == personal-website-candidate ]]; then
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
    while [[ "${1:-}" == -* ]]; do
      [[ "$1" == --env-file ]] && envfile="$2"
      shift 2
    done
    case "$1" in
      version) ;;
      up)
        sha="${SITE_SHA:-$(grep '^SITE_SHA=' "$envfile" | tail -n 1 | cut -d= -f2)}"
        [[ -n "$sha" ]] && grep -qx "$sha" "$state/images" || { echo "no such image: $sha" >&2; exit 1; }
        echo "$sha" >"$state/site"
        ;;
      down) rm -f "$state/site" ;;
      ps) [[ -f "$state/site" ]] && echo "site-$(cut -c1-12 "$state/site")" ;;
    esac
    ;;
esac
exit $?
