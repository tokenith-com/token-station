#!/usr/bin/env bash
set -Eeuo pipefail
umask 022

fail() { printf 'TokenStation package builder: %s\n' "$*" >&2; exit 1; }
VERSION="${1:-}"
OUTPUT_DIR="${2:-}"
REPO_ROOT="${3:-$PWD}"
NODE_VERSION=22.23.1
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail 'Run on Linux x86_64'
[[ "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]] || fail 'Usage: bash SCRIPT VERSION OUTPUT_DIR [REPO_ROOT]'
[ -n "$OUTPUT_DIR" ] || fail 'An output directory is required'
for command in python3 docker curl tar sha256sum awk find cp file git; do
  command -v "$command" >/dev/null || fail "Missing command: $command"
done
REPO_ROOT="$(cd "$REPO_ROOT" && pwd)"
for path in tokenstation-run backend/Dockerfile.native maas-ui/package-lock.json deploy/native/tokenstation.service data/model-catalog.yaml data/provider-catalog.json LICENSE; do
  [ -f "$REPO_ROOT/$path" ] || fail "Missing repository file: $path"
done
[ -d "$REPO_ROOT/data/builtin-plugins" ] || fail 'Missing builtin plugins'
mkdir -p "$OUTPUT_DIR"
OUTPUT_DIR="$(cd "$OUTPUT_DIR" && pwd)"
ASSET="tokenstation_${VERSION}_linux_amd64.tar.gz"
[ ! -e "$OUTPUT_DIR/$ASSET" ] || fail 'Archive already exists; use a new version or output directory'
WORK="$(mktemp -d)"
trap 'rm -rf -- "$WORK"' EXIT
STAGE="$WORK/stage"
mkdir -p "$STAGE/bin" "$STAGE/catalog" "$STAGE/deploy"

docker buildx version >/dev/null
docker buildx build \
  --platform linux/amd64 \
  --file "$REPO_ROOT/backend/Dockerfile.native" \
  --target artifact \
  --build-arg "TOKENHUB_VERSION=$VERSION" \
  --output "type=local,dest=$WORK/backend" \
  "$REPO_ROOT"
file "$WORK/backend/tokenstation"
file "$WORK/backend/tokenstation" | awk '/ELF/ && /x86-64/ && /statically linked/ { ok=1 } END { exit !ok }' || fail 'Expected a static Linux x86-64 backend'
cp "$WORK/backend/tokenstation" "$STAGE/bin/tokenstation"

NODE_ASSET="node-v${NODE_VERSION}-linux-x64.tar.xz"
NODE_BASE="https://nodejs.org/dist/v${NODE_VERSION}"
curl -fL --retry 3 --connect-timeout 15 "$NODE_BASE/$NODE_ASSET" -o "$WORK/$NODE_ASSET"
curl -fL --retry 3 --connect-timeout 15 "$NODE_BASE/SHASUMS256.txt" -o "$WORK/SHASUMS256.txt"
EXPECTED="$(awk -v asset="$NODE_ASSET" '$2 == asset { print $1; exit }' "$WORK/SHASUMS256.txt")"
[[ "$EXPECTED" =~ ^[0-9a-fA-F]{64}$ ]] || fail 'Missing Node.js checksum'
ACTUAL="$(sha256sum "$WORK/$NODE_ASSET" | awk '{print $1}')"
[ "$EXPECTED" = "$ACTUAL" ] || fail 'Node.js checksum mismatch'
tar -xJf "$WORK/$NODE_ASSET" -C "$WORK"
export PATH="$WORK/node-v${NODE_VERSION}-linux-x64/bin:$PATH"
node --version
npm --version
cp "$WORK/node-v${NODE_VERSION}-linux-x64/bin/node" "$STAGE/bin/node"

# Build in a temporary source copy so local secrets and build caches are excluded.
mkdir -p "$WORK/frontend"
tar -C "$REPO_ROOT/maas-ui" \
  --exclude='./node_modules' --exclude='./.next' --exclude='./.git' \
  --exclude='./.env' --exclude='./.env.*' -cf - . | tar -C "$WORK/frontend" -xf -
(
  cd "$WORK/frontend"
  npm ci
  NEXT_PUBLIC_TOKENHUB_API_BASE_URL="${NEXT_PUBLIC_TOKENHUB_API_BASE_URL:-http://localhost:8080}" npm run build
)
mkdir -p "$STAGE/frontend"
cp -R "$WORK/frontend/out" "$STAGE/frontend/out"
cp "$WORK/frontend/scripts/serve-static.mjs" "$STAGE/frontend/server.js"
echo '{"type":"module"}' > "$STAGE/frontend/package.json"

cp "$REPO_ROOT/tokenstation-run" "$STAGE/bin/tokenstation-run"
# Existing systemd units still invoke this path after an in-place update.
printf '%s\n' '#!/bin/sh' 'exec "$(dirname "$0")/tokenstation-run" "$@"' >"$STAGE/bin/tokenhub-run"
chmod 0755 "$STAGE/bin/tokenhub-run"
cp "$REPO_ROOT/deploy/native/tokenstation.service" "$STAGE/deploy/tokenstation.service"
cp "$REPO_ROOT/data/model-catalog.yaml" "$STAGE/catalog/model-catalog.yaml"
cp "$REPO_ROOT/data/provider-catalog.json" "$STAGE/catalog/provider-catalog.json"
cp -rL "$REPO_ROOT/data/builtin-plugins" "$STAGE/catalog/builtin-plugins"
cp "$REPO_ROOT/LICENSE" "$STAGE/LICENSE"
printf '%s\n' "$VERSION" > "$STAGE/VERSION"
chmod 0755 "$STAGE/bin/tokenstation" "$STAGE/bin/node" "$STAGE/bin/tokenstation-run"
bash -n "$STAGE/bin/tokenstation-run"
for path in bin/tokenstation bin/node bin/tokenstation-run frontend/server.js catalog/model-catalog.yaml catalog/provider-catalog.json deploy/tokenstation.service VERSION; do
  [ -f "$STAGE/$path" ] || fail "Missing package file: $path"
done
[ -z "$(find "$STAGE" -type l -print -quit)" ] || fail 'Package contains symlinks'
# Do not package frontend environment files, including unexpected generated copies.
[ -z "$(find "$STAGE/frontend" -type f -name '.env*' -print -quit)" ] || fail 'Frontend bundle contains an environment file'
EPOCH="$(git -C "$REPO_ROOT" log -1 --format=%ct)"
tar --sort=name --mtime="@$EPOCH" --owner=0 --group=0 --numeric-owner \
  -C "$STAGE" -czf "$WORK/$ASSET" .
tar -tzf "$WORK/$ASSET" >/dev/null
cp "$WORK/$ASSET" "$OUTPUT_DIR/$ASSET"
(
  cd "$OUTPUT_DIR"
  sha256sum "$ASSET" > "$ASSET.sha256"
  sha256sum -c "$ASSET.sha256"
)
# Older production updaters require the legacy asset name and complete layout.
LEGACY_ASSET="tokenhub_${VERSION}_linux_amd64.tar.gz"
LEGACY_STAGE="$WORK/legacy"
cp -rL "$STAGE" "$LEGACY_STAGE"
mv "$LEGACY_STAGE/bin/tokenstation" "$LEGACY_STAGE/bin/tokenhub"
python3 - "$LEGACY_STAGE" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
for source, target in [('bin/tokenstation-run', 'bin/tokenhub-run'), ('deploy/tokenstation.service', 'deploy/tokenhub.service')]:
    path = root / source
    path.write_text(path.read_text().replace('tokenstation', 'tokenhub'))
    path.rename(root / target)
PY
[ -z "$(find "$LEGACY_STAGE" -type l -print -quit)" ] || fail 'Compatibility package contains symlinks'
tar --sort=name --mtime="@$EPOCH" --owner=0 --group=0 --numeric-owner \
  -C "$LEGACY_STAGE" -czf "$OUTPUT_DIR/$LEGACY_ASSET" .
(cd "$OUTPUT_DIR"; sha256sum "$LEGACY_ASSET" >"$LEGACY_ASSET.sha256"; sha256sum "$ASSET" "$LEGACY_ASSET" >checksums.txt; sha256sum -c checksums.txt)
printf '\nArchive: %s/%s\nChecksum: %s/%s.sha256\n' "$OUTPUT_DIR" "$ASSET" "$OUTPUT_DIR" "$ASSET"
printf 'Full package built; frontend is opt-in via TOKENHUB_ENABLE_FRONTEND=true. No deployment was performed.\n'
