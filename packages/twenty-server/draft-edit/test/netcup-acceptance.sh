#!/usr/bin/env bash
set -euo pipefail
[[ $# == 1 && $1 =~ ^/mnt/learning-data/twenty/releases/draft-edit-[a-zA-Z0-9-]+$ ]]
release=$1
root=$(cd "$(dirname "$0")/.." && pwd -P)
cd "$root"
find src scripts sql test -type f -not -name '*.pyc' -print0 | xargs -0 shasum -a 256 | ssh -o BatchMode=yes netcup "cd '$release'; sha256sum --status -c -"
ssh -o BatchMode=yes netcup bash -s -- "$release" <<'REMOTE'
set -euo pipefail
release=$1
export XDG_RUNTIME_DIR=/run/user/1000
p=(podman --root /mnt/learning-data/twenty/runtime/containers --runroot /run/user/1000/twenty-containers)
diff -qr "$release/src" /mnt/learning-data/twenty/tests/draft-edit/src
[[ $("${p[@]}" inspect twenty-draft-edit-dovecot-test --format '{{.HostConfig.NetworkMode}}') == none ]]
for test in mime.integration.mjs service.integration.mjs dovecot.integration.mjs twenty-full.integration.mjs; do
  "${p[@]}" run --rm --network container:twenty-draft-edit-dovecot-test --memory 600m --cpus 1 -v "$release:/work:ro" --entrypoint node docker.io/twentycrm/twenty:v2.58.0 "/work/test/$test"
done
bash "$release/test/release.integration.sh" "$release"
REMOTE
