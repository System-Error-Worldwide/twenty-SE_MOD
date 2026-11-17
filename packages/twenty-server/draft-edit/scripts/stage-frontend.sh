#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 3 || ( $1 != --install && $1 != --rollback && $1 != --check ) ]]; then
  printf 'Usage: %s --install|--rollback|--check CONTAINER RELEASE_DIR\n' "$0" >&2; exit 2
fi
mode=$1
container=$2
release=$(cd "$3" && pwd -P)
base=/mnt/learning-data/twenty
[[ $container =~ ^twenty-[a-z0-9-]+$ && $release == "$base"/* ]]
mountpoint -q /mnt/learning-data
export XDG_RUNTIME_DIR=/run/user/1000
podman=(podman --root "$base/runtime/containers" --runroot /run/user/1000/twenty-containers)
image=39505ceb9a99d138178c19d3109ca1f4505cb1394cacaa54589eb200c036e6c4
target=/app/packages/twenty-server/dist/front
[[ $("${podman[@]}" inspect "$container" --format '{{.Image}}') == "$image" ]]
[[ $("${podman[@]}" inspect "$container" --format '{{.State.Running}}') == false ]]
container_id=$("${podman[@]}" inspect "$container" --format '{{.Id}}')
[[ $container_id =~ ^[a-f0-9]{64}$ ]]
if [[ $mode != --rollback ]]; then
  [[ -f "$release/frontend/index.html" && -f "$release/frontend.sha256" ]]
  ( cd "$release/frontend" && sha256sum -c --status "$release/frontend.sha256" )
fi
work=$(mktemp -d "$base/runtime/draft-frontend.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
mkdir "$work/current"
"${podman[@]}" cp "$container:$target/." "$work/current"
if [[ ! -e "$release/baseline" ]]; then
  [[ $(sha256sum "$work/current/index.html" | cut -d' ' -f1) == f0d425cf8aef804d6c94e78c7f0721634cd138409aeda19a515d4df384a7ebcc ]]
  if [[ $mode == --rollback ]]; then printf 'Pinned frontend remains unchanged\n'; exit 0; fi
  if [[ $mode == --check ]]; then printf 'Pinned frontend preflight verified\n'; exit 0; fi
  mkdir "$work/baseline"
  mv "$work/current" "$work/baseline/files"
  ( cd "$work/baseline/files" && find . -type f -print0 | sort -z | xargs -0 sha256sum ) > "$work/baseline/checksums"
  sha256sum "$release/frontend/index.html" | cut -d' ' -f1 > "$work/baseline/candidate-index"
  printf '%s\n' "$container_id" > "$work/baseline/container-id"
  mv "$work/baseline" "$release/baseline"
  mkdir "$work/current"
  "${podman[@]}" cp "$container:$target/." "$work/current"
fi
baseline="$release/baseline"
[[ -f "$baseline/files/index.html" && -f "$baseline/checksums" && -f "$baseline/candidate-index" && $(cat "$baseline/container-id") == "$container_id" ]]
( cd "$baseline/files" && sha256sum -c --status "$baseline/checksums" )
current=$(sha256sum "$work/current/index.html" | cut -d' ' -f1)
original=$(sha256sum "$baseline/files/index.html" | cut -d' ' -f1)
candidate=$(cat "$baseline/candidate-index")
[[ $candidate =~ ^[a-f0-9]{64}$ ]]
if [[ $mode != --rollback ]]; then
  [[ $(sha256sum "$release/frontend/index.html" | cut -d' ' -f1) == "$candidate" ]]
  [[ ! -e "$release/install-in-progress" ]]
  [[ $current == "$original" || $current == "$candidate" ]]
  if [[ $current == "$original" ]]; then (cd "$work/current" && sha256sum -c --status "$baseline/checksums"); else (cd "$work/current" && sha256sum -c --status "$release/frontend.sha256"); fi
  if [[ $mode == --check ]]; then printf 'Pinned frontend preflight verified\n'; exit 0; fi
  source_dir="$release/frontend"; manifest="$release/frontend.sha256"
else
  if [[ $current != "$original" && $current != "$candidate" ]]; then
    [[ -f "$release/install-in-progress" && $(cat "$release/install-in-progress") == "$container_id" ]]
  fi
  source_dir="$baseline/files"; manifest="$baseline/checksums"
fi
printf '%s\n' "$container_id" > "$work/install-in-progress"
mv "$work/install-in-progress" "$release/install-in-progress"
"${podman[@]}" cp "$source_dir/." "$container:$target"
mkdir "$work/readback"
"${podman[@]}" cp "$container:$target/." "$work/readback"
( cd "$work/readback" && sha256sum -c --status "$manifest" )
rm -f -- "$release/install-in-progress"
printf 'Pinned frontend %s verified\n' "$mode"
