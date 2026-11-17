#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 3 || ( $1 != --install && $1 != --rollback && $1 != --startup ) ]]; then
  printf 'Usage: %s --install|--rollback|--startup CONTAINER RELEASE_DIR\n' "$0" >&2; exit 2
fi
mode=$1
container=$2
release=$(cd "$3" && pwd -P)
[[ $release == /mnt/learning-data/twenty/* ]]
if [[ $mode == --startup ]]; then
  if bash "$release/scripts/stage-release.sh" --install "$container" "$release"; then
    printf 'installed\n' > "$release/startup-status"
    exit 0
  fi
  if bash "$release/scripts/stage-release.sh" --rollback "$container" "$release"; then
    printf 'baseline-restored\n' > "$release/startup-status"
    printf 'Draft editing installation failed; verified baseline will start\n' >&2
    exit 0
  fi
  printf 'Recovery failed; refusing to start an unverified installation\n' >&2
  exit 2
fi
( cd "$release" && sha256sum -c --status code.sha256 )
if [[ $mode == --install ]]; then
  bash "$release/scripts/stage-container-patch.sh" --check "$container" "$release/src"
  bash "$release/scripts/stage-frontend.sh" --check "$container" "$release"
  if ! bash "$release/scripts/stage-frontend.sh" --install "$container" "$release"; then
    if [[ -d "$release/baseline" ]] && ! bash "$release/scripts/stage-frontend.sh" --rollback "$container" "$release"; then
      printf 'Frontend rollback failed; manual recovery required\n' >&2
      exit 2
    fi
    exit 1
  fi
  if ! bash "$release/scripts/stage-container-patch.sh" --install "$container" "$release/src"; then
    if ! bash "$release/scripts/stage-frontend.sh" --rollback "$container" "$release"; then
      printf 'Frontend rollback failed; manual recovery required\n' >&2; exit 2
    fi
    if ! bash "$release/scripts/rollback-container-patch.sh" --rollback "$container" "$release/src"; then
      printf 'Backend rollback failed; manual recovery required\n' >&2; exit 2
    fi
    exit 1
  fi
else
  bash "$release/scripts/stage-frontend.sh" --rollback "$container" "$release"
  bash "$release/scripts/rollback-container-patch.sh" --rollback "$container" "$release/src"
fi
