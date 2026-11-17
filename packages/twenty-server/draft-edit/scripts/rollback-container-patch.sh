#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 3 || $1 != --rollback ]]; then printf 'Usage: %s --rollback CONTAINER SOURCE_DIR\n' "$0" >&2; exit 2; fi
container=$2
source_dir=$(cd "$3" && pwd -P)
[[ $container =~ ^twenty-[a-z0-9-]+$ ]]
base=/mnt/learning-data/twenty
export XDG_RUNTIME_DIR=/run/user/1000
podman=(podman --root "$base/runtime/containers" --runroot /run/user/1000/twenty-containers)
expected_image=39505ceb9a99d138178c19d3109ca1f4505cb1394cacaa54589eb200c036e6c4
target=/app/packages/twenty-server/dist/engine/core-modules/tool-provider/tool-provider.module.js
mountpoint -q /mnt/learning-data
[[ $("${podman[@]}" inspect "$container" --format '{{.Image}}') == "$expected_image" ]]
[[ $("${podman[@]}" inspect "$container" --format '{{.State.Running}}') == false ]]
container_id=$("${podman[@]}" inspect "$container" --format '{{.Id}}')
[[ $container_id =~ ^[a-f0-9]{64}$ ]]
baseline="$(dirname "$source_dir")/backend-baseline"
work=$(mktemp -d "$base/runtime/draft-edit-rollback.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
"${podman[@]}" cp "$container:$target" "$work/module.js"
if [[ -e "$baseline" ]]; then
  [[ $(cat "$baseline/container-id") == "$container_id" ]]
  [[ $(sha256sum "$baseline/module.js" | cut -d' ' -f1) == e3d8c5af2ca3111550d09838ef04e4f67d927f32109d9740cc94f944dc4c972c ]]
  current=$(sha256sum "$work/module.js" | cut -d' ' -f1)
  if [[ $current != e3d8c5af2ca3111550d09838ef04e4f67d927f32109d9740cc94f944dc4c972c && $current != 631acd320f337920593afe8b4fcd57a9987c1e485953ba18c72aba741e563eb9 ]]; then
    [[ -f "$baseline/install-in-progress" && $(cat "$baseline/install-in-progress") == "$container_id" ]]
  fi
  cp "$baseline/module.js" "$work/module.js"
else
  node "$source_dir/rollback-twenty-patch.cjs" "$work/module.js" --rollback
fi
"${podman[@]}" cp "$work/module.js" "$container:$target"
"${podman[@]}" cp "$container:$target" "$work/readback.js"
cmp -s "$work/module.js" "$work/readback.js"
rm -f -- "$baseline/install-in-progress"
printf 'Pinned draft-edit patch rolled back; journal and plugin retained\n'
