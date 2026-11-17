#!/usr/bin/env bash
set -euo pipefail
[[ $# == 2 ]]
current=$(cd "$1" && pwd -P)
target=$(cd "$2" && pwd -P)
base=/mnt/learning-data/twenty
[[ $current == "$base/releases/"* && $target == "$base/releases/"* ]]
export XDG_RUNTIME_DIR=/run/user/1000
p=(podman --root "$base/runtime/containers" --runroot /run/user/1000/twenty-containers)
work=$(mktemp -d "$base/releases/plugin-switch-test.XXXXXXXX")
container="twenty-plugin-switch-$(basename "$work" | tr '[:upper:].' '[:lower:]-')"
created=false
cleanup() {
  if [[ $created == true ]]; then "${p[@]}" rm -f "$container" >/dev/null; fi
  rm -rf -- "$work"
}
trap cleanup EXIT
mkdir "$work/current" "$work/target"
for folder in src scripts sql test frontend; do
  cp -a "$current/$folder" "$work/current/"
  cp -a "$target/$folder" "$work/target/"
done
cp "$current/code.sha256" "$current/frontend.sha256" "$work/current/"
cp "$target/code.sha256" "$target/frontend.sha256" "$work/target/"
current="$work/current"
target="$work/target"
"${p[@]}" create --name "$container" --network none --entrypoint node docker.io/twentycrm/twenty:v2.58.0 -e 'setInterval(()=>{},1000)' >/dev/null
created=true
bash "$current/scripts/stage-release.sh" --install "$container" "$current"
cp -a "$current/baseline" "$current/backend-baseline" "$target/"
switcher="$target/scripts/switch-plugin-release.sh"
bash "$switcher" "$container" "$current" "$target"
bash "$switcher" "$container" "$current" "$target"
bash "$target/scripts/stage-release.sh" --install "$container" "$target"
"${p[@]}" cp "$container:/app/packages/twenty-server/draft-edit" "$work/new-readback"
diff -qr "$work/new-readback/src" "$target/src" >/dev/null
bash "$switcher" "$container" "$target" "$current"
bash "$current/scripts/stage-release.sh" --install "$container" "$current"
"${p[@]}" cp "$container:/app/packages/twenty-server/draft-edit" "$work/old-readback"
diff -qr "$work/old-readback/src" "$current/src" >/dev/null
printf 'unrecognized code\n' > "$work/unknown.mjs"
"${p[@]}" cp "$work/unknown.mjs" "$container:/app/packages/twenty-server/draft-edit/src/unknown.mjs"
if bash "$switcher" "$container" "$current" "$target"; then
  printf 'Unknown current code was overwritten\n' >&2; exit 1
fi
"${p[@]}" cp "$container:/app/packages/twenty-server/draft-edit/src/unknown.mjs" "$work/unknown-readback.mjs"
cmp -s "$work/unknown.mjs" "$work/unknown-readback.mjs"
printf 'PASS: atomic plugin upgrade, idempotent retry, rollback and unknown-code refusal\n'
