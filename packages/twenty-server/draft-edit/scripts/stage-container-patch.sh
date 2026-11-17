#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 3 || ( $1 != --install && $1 != --check ) ]]; then printf 'Usage: %s --install CONTAINER SOURCE_DIR\n' "$0" >&2; exit 2; fi
mode=$1
container=$2
source_dir=$(cd "$3" && pwd -P)
[[ $container =~ ^twenty-[a-z0-9-]+$ ]]
base=/mnt/learning-data/twenty
export XDG_RUNTIME_DIR=/run/user/1000
podman=(podman --root "$base/runtime/containers" --runroot /run/user/1000/twenty-containers)
expected_image=39505ceb9a99d138178c19d3109ca1f4505cb1394cacaa54589eb200c036e6c4
target=/app/packages/twenty-server/dist/engine/core-modules/tool-provider/tool-provider.module.js
plugin=/app/packages/twenty-server/draft-edit
mountpoint -q /mnt/learning-data
[[ $("${podman[@]}" inspect "$container" --format '{{.Image}}') == "$expected_image" ]]
[[ $("${podman[@]}" inspect "$container" --format '{{.State.Running}}') == false ]]
container_id=$("${podman[@]}" inspect "$container" --format '{{.Id}}')
[[ $container_id =~ ^[a-f0-9]{64}$ ]]
baseline="$(dirname "$source_dir")/backend-baseline"
work=$(mktemp -d "$base/runtime/draft-edit-stage.XXXXXXXX")
trap 'rm -rf -- "$work"' EXIT
"${podman[@]}" cp "$container:$target" "$work/module.js"
node "$source_dir/apply-twenty-patch.cjs" "$work/module.js" --apply
mkdir -p "$work/draft-edit/src"
cp "$source_dir"/*.mjs "$source_dir"/*.cjs "$work/draft-edit/src/"
exists=false
if "${podman[@]}" cp "$container:$plugin" "$work/existing" 2>/dev/null; then
  exists=true
  diff -qr "$work/draft-edit" "$work/existing" >/dev/null || { printf 'Existing draft plugin differs; preserving it\n' >&2; exit 1; }
fi
if [[ $mode == --check ]]; then printf 'Pinned draft-edit preflight verified\n'; exit 0; fi
if [[ ! -e "$baseline" ]]; then
  mkdir "$work/baseline"
  "${podman[@]}" cp "$container:$target" "$work/baseline/module.js"
  node "$source_dir/rollback-twenty-patch.cjs" "$work/baseline/module.js" --rollback
  printf '%s\n' "$container_id" > "$work/baseline/container-id"
  mv "$work/baseline" "$baseline"
fi
[[ $(cat "$baseline/container-id") == "$container_id" ]]
[[ $(sha256sum "$baseline/module.js" | cut -d' ' -f1) == e3d8c5af2ca3111550d09838ef04e4f67d927f32109d9740cc94f944dc4c972c ]]
if [[ $exists == false ]]; then
  "${podman[@]}" cp "$work/draft-edit" "$container:/app/packages/twenty-server/"
fi
"${podman[@]}" cp "$container:$plugin" "$work/readback"
diff -qr "$work/draft-edit" "$work/readback" >/dev/null
printf '%s\n' "$container_id" > "$work/install-in-progress"
mv "$work/install-in-progress" "$baseline/install-in-progress"
"${podman[@]}" cp "$work/module.js" "$container:$target"
"${podman[@]}" cp "$container:$target" "$work/readback.js"
cmp -s "$work/module.js" "$work/readback.js"
rm -f -- "$baseline/install-in-progress"
printf 'Pinned draft-edit patch staged and verified\n'
