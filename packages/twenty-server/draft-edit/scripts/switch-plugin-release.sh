#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 3 ]]; then
  printf 'Usage: %s CONTAINER CURRENT_RELEASE TARGET_RELEASE\n' "$0" >&2; exit 2
fi
container=$1
current=$(cd "$2" && pwd -P)
target=$(cd "$3" && pwd -P)
base=/mnt/learning-data/twenty
[[ $container =~ ^twenty-[a-z0-9-]+$ && $current == "$base/releases/"* && $target == "$base/releases/"* && $current != "$target" ]]
mountpoint -q /mnt/learning-data
export XDG_RUNTIME_DIR=/run/user/1000
p=(podman --root "$base/runtime/containers" --runroot /run/user/1000/twenty-containers)
if [[ ${TWENTY_DRAFT_EDIT_NAMESPACE:-} != 1 ]]; then
  exec "${p[@]}" unshare env TWENTY_DRAFT_EDIT_NAMESPACE=1 bash "$0" "$container" "$current" "$target"
fi
[[ $("${p[@]}" inspect "$container" --format '{{.State.Running}}') == false ]]
[[ $("${p[@]}" inspect "$container" --format '{{.Image}}') == 39505ceb9a99d138178c19d3109ca1f4505cb1394cacaa54589eb200c036e6c4 ]]
(cd "$current" && sha256sum -c --status code.sha256)
(cd "$target" && sha256sum -c --status code.sha256)
root=$("${p[@]}" mount "$container")
[[ $root == "$base/runtime/containers/"* ]]
swapped=false
committed=false
previous=
exchange() {
  python3 - "$1" "$2" <<'PY'
import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
rename = libc.renameat2
rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
if rename(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 2):
    raise OSError(ctypes.get_errno(), 'Atomic plugin exchange failed')
PY
}
cleanup() {
  status=$?
  if [[ $swapped == true && $committed == false ]]; then
    if ! exchange "$plugin" "$previous" || ! diff -qr "$work/current" "$plugin" >/dev/null; then
      printf 'Plugin recovery failed; keep the container stopped\n' >&2
      status=2
    fi
  fi
  "${p[@]}" unmount "$container" >/dev/null || status=2
  exit "$status"
}
trap cleanup EXIT
parent="$root/app/packages/twenty-server"
plugin="$parent/draft-edit"
[[ -d "$plugin/src" && ! -L "$plugin" && ! -L "$plugin/src" ]]
work=$(mktemp -d "$parent/.draft-edit-switch.XXXXXXXX")
mkdir -p "$work/current/src" "$work/target/src"
cp "$current/src/"*.mjs "$current/src/"*.cjs "$work/current/src/"
cp "$target/src/"*.mjs "$target/src/"*.cjs "$work/target/src/"
diff -qr "$work/target/src" "$target/src" >/dev/null
if diff -qr "$work/target" "$plugin" >/dev/null; then
  rm -rf -- "$work"
  printf 'Target plugin is already installed and verified\n'
  exit 0
fi
diff -qr "$work/current" "$plugin" >/dev/null || { printf 'Current plugin does not match the supplied release\n' >&2; exit 1; }
backup="$parent/draft-edit-previous-$(basename "$work")"
previous="$work/target"
exchange "$plugin" "$previous"
swapped=true
diff -qr "$plugin/src" "$target/src" >/dev/null
mv "$previous" "$backup"
previous="$backup"
diff -qr "$work/current" "$backup" >/dev/null
committed=true
rm -rf -- "$work"
printf 'Verified plugin release switch; prior code retained in container\n'
