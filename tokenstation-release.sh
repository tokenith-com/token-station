#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

fail() { printf 'TokenStation release: %s\n' "$*" >&2; exit 1; }
usage() {
  cat <<'EOF'
Usage: bash tokenstation-release.sh VERSION [options]
  --artifact-dir ABS    New artifact directory (default: ~/tokenstation-dist/VERSION)
  --skip-checks         Explicitly skip tests and gates (recorded)
  --allow-dirty         Allow tracked modifications (recorded with diff hash)
  --help                Show this help

Run on a Linux x86_64 build machine with Docker/buildx, Go and Node/npm.
Checks run before the existing full builder (which performs npm ci/build).
Build dependencies may be downloaded; no server connection, upload or deployment
is performed. Transfer artifacts and run the installer manually after review.
Use a fresh version and artifact directory for each release.
EOF
}
if [[ "${1:-}" == --help || "${1:-}" == -h ]]; then usage; exit 0; fi
[[ $# -ge 1 ]] || { usage >&2; exit 1; }
VERSION="$1"; shift
number='(0|[1-9][0-9]*)'
pre='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
[[ "$VERSION" =~ ^${number}\.${number}\.${number}(-${pre}(\.${pre})*)?$ ]] || fail 'Invalid version'
SKIP=false; ALLOW_DIRTY=false; OUTPUT="${HOME:?}/tokenstation-dist/$VERSION"
while (($#)); do
  case "$1" in
    --skip-checks) SKIP=true; shift ;;
    --allow-dirty) ALLOW_DIRTY=true; shift ;;
    --artifact-dir) [[ $# -ge 2 ]] || fail 'Missing artifact directory'; OUTPUT="$2"; shift 2 ;;
    *) fail 'Unknown option; host arguments are not supported; see --help' ;;
  esac
done
[[ "$OUTPUT" == /* && "$OUTPUT" != / && "$OUTPUT" != *$'\n'* ]] || fail 'Artifact directory must be absolute'
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail 'Run on Linux x86_64'
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
for tool in git bash sha256sum python3; do command -v "$tool" >/dev/null || fail "Missing command: $tool"; done
OUTPUT="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$OUTPUT")"
[[ "$OUTPUT/" != "$ROOT/"* ]] || fail 'Artifact directory must be outside the repository'
[[ ! -e "$OUTPUT" && ! -L "$OUTPUT" ]] || fail 'Use a new artifact directory'
COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
DIRTY=false
if ! git -C "$ROOT" diff --quiet HEAD --; then DIRTY=true; fi
[[ "$DIRTY" == false || "$ALLOW_DIRTY" == true ]] || fail 'Tracked tree is dirty; review changes or explicitly use --allow-dirty'
DIFF_HASH="$(git -C "$ROOT" diff --binary HEAD -- | sha256sum | cut -d' ' -f1)"
if [[ "$SKIP" == true ]]; then
  printf 'WARNING: --skip-checks explicitly selected; checks will be recorded as skipped.\n' >&2
else
  (cd "$ROOT/backend"; go test ./...; go vet ./...)
  (cd "$ROOT"; node --test tools/*.test.mjs
    for gate in doc-translations ui-translations env-contract source-lines; do node "tools/check-$gate.mjs"; done)
  (cd "$ROOT/frontend"; [[ -d node_modules ]] || npm ci
    npm run lint; npm run typecheck; npm test)
fi
bash "$ROOT/tokenstation-build-full-linux-amd64.sh" "$VERSION" "$OUTPUT" "$ROOT"
ASSET="tokenstation_${VERSION}_linux_amd64.tar.gz"
cp -- "$ROOT/tokenstation-install-backend.sh" "$ROOT/tokenstation-run" "$ROOT/deploy/native/tokenstation.service" "$OUTPUT/"
printf 'version=%s\ncommit=%s\ndirty=%s\ndiff_sha256=%s\nchecks_skipped=%s\n' "$VERSION" "$COMMIT" "$DIRTY" "$DIFF_HASH" "$SKIP" >"$OUTPUT/release-record"
# Ensure the package, canonical launcher and installer agree before handoff.
(cd "$OUTPUT"; sha256sum -c "$ASSET.sha256")
python3 - "$OUTPUT/$ASSET" "$OUTPUT/tokenstation-run" "$OUTPUT/tokenstation-install-backend.sh" <<'PY'
import sys, tarfile
launcher = open(sys.argv[2], 'rb').read()
installer = open(sys.argv[3], 'rb').read()
embedded = installer.split(b'cat >"$staging/bin/tokenstation-run" <<\'EOF\'\n', 1)[1].split(b'\nEOF', 1)[0] + b'\n'
if embedded != launcher:
    raise SystemExit('Installer canonical launcher mismatch')
with tarfile.open(sys.argv[1]) as archive:
    if archive.extractfile('./bin/tokenstation-run').read() != launcher:
        raise SystemExit('Packaged launcher mismatch')
PY
(cd "$OUTPUT"; sha256sum "$ASSET" "$ASSET.sha256" tokenhub_*.tar.gz tokenhub_*.tar.gz.sha256 checksums.txt tokenstation-install-backend.sh tokenstation-run tokenstation.service release-record >release-manifest.sha256)
MANIFEST_HASH="$(sha256sum "$OUTPUT/release-manifest.sha256" | cut -d' ' -f1)"
printf 'Local release artifacts ready: %s\nManifest SHA-256 (retain through a trusted channel): %s\nNo upload or deployment was performed.\n' "$OUTPUT" "$MANIFEST_HASH"
