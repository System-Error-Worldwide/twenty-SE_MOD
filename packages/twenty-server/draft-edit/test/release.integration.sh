#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 ]]
input=$(cd "$1" && pwd -P)
base=/mnt/learning-data/twenty
[[ $input == "$base"/* ]]
export XDG_RUNTIME_DIR=/run/user/1000
podman=(podman --root "$base/runtime/containers" --runroot /run/user/1000/twenty-containers)
work=$(mktemp -d "$base/tests/release-acceptance.XXXXXXXX")
container="twenty-release-acceptance-$(basename "$work" | tr '[:upper:].' '[:lower:]-')"
created=false
cleanup() {
  if [[ $created == true ]]; then "${podman[@]}" rm -f "$container" >/dev/null; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
mkdir "$work/release"
cp -a "$input/src" "$input/scripts" "$input/sql" "$input/frontend" "$input/code.sha256" "$input/frontend.sha256" "$work/release/"
release="$work/release"
"${podman[@]}" create --name "$container" --network none --entrypoint node docker.io/twentycrm/twenty:v2.58.0 -e 'setInterval(()=>{},1000)' >/dev/null
created=true
runner="$release/scripts/stage-release.sh"
bash "$runner" --install "$container" "$release"
bash "$runner" --rollback "$container" "$release"
bash "$runner" --install "$container" "$release"
id=$("${podman[@]}" inspect "$container" --format '{{.Id}}')
printf 'interrupted-copy\n' > "$work/partial"
printf '%s\n' "$id" > "$release/install-in-progress"
"${podman[@]}" cp "$work/partial" "$container:/app/packages/twenty-server/dist/front/index.html"
printf '%s\n' "$id" > "$release/backend-baseline/install-in-progress"
"${podman[@]}" cp "$work/partial" "$container:/app/packages/twenty-server/dist/engine/core-modules/tool-provider/tool-provider.module.js"
cp "$release/frontend/index.html" "$work/candidate-index"
printf 'corrupt-bundle\n' > "$release/frontend/index.html"
bash "$runner" --startup "$container" "$release"
[[ $(cat "$release/startup-status") == baseline-restored ]]
"${podman[@]}" start "$container" >/dev/null
[[ $("${podman[@]}" inspect "$container" --format '{{.State.Running}}') == true ]]
"${podman[@]}" stop -t 2 "$container" >/dev/null
cp "$work/candidate-index" "$release/frontend/index.html"
bash "$runner" --startup "$container" "$release"
[[ $(cat "$release/startup-status") == installed ]]
"${podman[@]}" cp "$container:/app/packages/twenty-server/dist/front/." "$work/frontend-readback"
( cd "$work/frontend-readback" && sha256sum -c --status "$release/frontend.sha256" )
"${podman[@]}" cp "$container:/app/packages/twenty-server/dist/engine/core-modules/tool-provider/tool-provider.module.js" "$work/backend-readback.js"
[[ $(sha256sum "$work/backend-readback.js" | cut -d' ' -f1) == 631acd320f337920593afe8b4fcd57a9987c1e485953ba18c72aba741e563eb9 ]]
printf 'PASS: install, rollback, interrupted frontend/backend recovery, baseline startup and reinstall\n'
