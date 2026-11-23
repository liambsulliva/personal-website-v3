#!/usr/bin/env bash
# Takes the repo's deploy.sh and compose files as the ones root runs, after
# showing what changes. Run by hand, as root, from the pinned folder:
#
#   sudo bash /volume1/docker/projects/personal-website/deploy/pin.sh [--yes]
#
# Nothing else updates them: deploy.sh only logs when the repo's differ. Read
# the diff as code that will run as root. FROM overrides where they come from
# (the project's own clone, at the commit it last deployed).
set -euo pipefail

main() {
  local pinned project from file changed=0
  pinned="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  project="$(dirname "$pinned")"
  from="${FROM:-$project/repo/deploy}"
  for file in deploy.sh pin.sh compose.yaml compose.photos.yaml compose.cms.yaml; do
    # A link could point anywhere.
    [[ -f "$from/$file" && ! -L "$from/$file" ]] || { echo "no plain $from/$file" >&2; return 1; }
    diff -u --label "pinned/$file" --label "repo/$file" "$pinned/$file" "$from/$file" 2>/dev/null || changed=1
  done
  ((changed)) || { echo "already the same"; return 0; }
  if [[ "${1:-}" != --yes ]]; then
    local answer=""
    read -r -p "Run these as root from now on? Type yes: " answer
    [[ "$answer" == yes ]] || { echo "nothing changed"; return 1; }
  fi
  for file in deploy.sh pin.sh compose.yaml compose.photos.yaml compose.cms.yaml; do
    # A new file moved into place, never a half-written one.
    cp "$from/$file" "$pinned/.$file.new"
    chmod 644 "$pinned/.$file.new"
    mv "$pinned/.$file.new" "$pinned/$file"
  done
  echo "pinned"
}

main "$@"; exit $?
