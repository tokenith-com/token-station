#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
test_root="$(mktemp -d)"
trap 'rm -rf -- "$test_root"' EXIT

fail_test() {
  printf 'container entrypoint test: %s\n' "$*" >&2
  exit 1
}

create_bundle() {
  local root="$1"
  local version="$2"
  local build_id="${3:-}"
  local marker="$4"

  mkdir -p "$root/bin" "$root/frontend" "$root/catalog" "$root/deploy"
  : >"$root/bin/tokenstation"
  : >"$root/bin/node"
  cat >"$root/bin/tokenstation-run" <<'EOF'
#!/bin/sh
set -eu
release_dir="$(cd "$(dirname "$0")/.." && pwd)"
cp "$release_dir/MARKER" "$TOKENHUB_TEST_OUTPUT"
printf '%s\n' "${0##*/}" >"$TOKENHUB_TEST_OUTPUT.command"
EOF
  cp "$root/bin/tokenstation-run" "$root/bin/tokenstation"
  cp "$root/bin/tokenstation-run" "$root/bin/node"
  : >"$root/frontend/server.js"
  : >"$root/catalog/model-catalog.yaml"
  printf '{"providers":[]}\n' >"$root/catalog/provider-catalog.json"
  : >"$root/deploy/tokenstation.service"
  printf '%s\n' "$version" >"$root/VERSION"
  printf '%s\n' "$marker" >"$root/MARKER"
  if [ -n "$build_id" ]; then
    printf '%s\n' "$build_id" >"$root/BUILD_ID"
  fi
  chmod 0755 "$root/bin/tokenstation" "$root/bin/node" "$root/bin/tokenstation-run"
}

build_id_root="$test_root/build-id"
mkdir -p "$build_id_root/nested"
printf 'alpha\n' >"$build_id_root/alpha"
printf 'beta\n' >"$build_id_root/nested/beta"
for _attempt in {1..100}; do
  sh "$script_dir/tokenstation-build-id" "$build_id_root"
  cat "$build_id_root/BUILD_ID"
done >"$test_root/build-ids"
[ "$(sort -u "$test_root/build-ids" | wc -l | tr -d '[:space:]')" = "1" ] ||
  fail_test "identical image contents produced different build identities"
first_build_id="$(sed -n '1p' "$test_root/build-ids")"
printf 'changed\n' >>"$build_id_root/alpha"
sh "$script_dir/tokenstation-build-id" "$build_id_root"
[ "$(<"$build_id_root/BUILD_ID")" != "$first_build_id" ] ||
  fail_test "changed image contents kept the previous build identity"

run_entrypoint() {
  local image_root="$1"
  TOKENHUB_CONTAINER_IMAGE_ROOT="$image_root" \
    TOKENHUB_INSTALL_ROOT="$test_root/install" \
    TOKENHUB_RUN_MODE="${2:-all}" \
    TOKENHUB_TEST_OUTPUT="$test_root/output" \
    sh "$script_dir/tokenstation-entrypoint"
}

first_id="$(printf '1%.0s' {1..64})"
second_id="$(printf '2%.0s' {1..64})"
first_image="$test_root/image-first"
second_image="$test_root/image-second"
create_bundle "$first_image" "0.3.0" "$first_id" "first source build"
create_bundle "$second_image" "0.3.0" "$second_id" "second source build"

run_entrypoint "$first_image"
[ "$(<"$test_root/output")" = "first source build" ] ||
  fail_test "initial image bundle was not activated"
[ "$(sed -n '2p' "$test_root/install/.container-image-version")" = "$first_id" ] ||
  fail_test "initial build identity was not persisted"

managed_release="$test_root/install/releases/0.3.1"
create_bundle "$managed_release" "0.3.1" "" "panel-managed release"
ln -sfn "releases/0.3.1" "$test_root/install/current"
run_entrypoint "$first_image"
[ "$(<"$test_root/output")" = "panel-managed release" ] ||
  fail_test "ordinary restart replaced the panel-managed release"

run_entrypoint "$second_image"
[ "$(<"$test_root/output")" = "second source build" ] ||
  fail_test "same-version image with a new build identity stayed stale"
[ "$(<"$test_root/install/current/MARKER")" = "second source build" ] ||
  fail_test "new image content was not installed"
[ "$(sed -n '2p' "$test_root/install/.container-image-version")" = "$second_id" ] ||
  fail_test "new build identity was not persisted"

legacy_release="$test_root/install/releases/0.2.0"
create_bundle "$legacy_release" "0.2.0" "" "legacy rollback release"
mv "$legacy_release/bin/tokenstation" "$legacy_release/bin/tokenhub"
mv "$legacy_release/bin/tokenstation-run" "$legacy_release/bin/tokenhub-run"
mv "$legacy_release/deploy/tokenstation.service" "$legacy_release/deploy/tokenhub.service"
cp "$test_root/install/.container-image-version" "$test_root/expected-image-state"
for mode in all backend frontend; do
  rm "$test_root/install/current"
  ln -s "releases/0.2.0" "$test_root/install/current"
  run_entrypoint "$second_image" "$mode"
  [ "$(<"$test_root/output")" = "legacy rollback release" ] ||
    fail_test "$mode did not start the legacy rollback release"
  case "$mode" in
    all) expected_command=tokenhub-run ;;
    backend) expected_command=tokenhub ;;
    frontend) expected_command=node ;;
  esac
  [ "$(<"$test_root/output.command")" = "$expected_command" ] ||
    fail_test "$mode selected the wrong legacy command"
  [ "$(readlink "$test_root/install/current")" = "releases/0.2.0" ] ||
    fail_test "$mode replaced the rollback current link"
  cmp "$test_root/expected-image-state" "$test_root/install/.container-image-version" ||
    fail_test "$mode changed the initialized image state"
done

# An incomplete layout must not borrow its runner or service from the other brand.
for missing in binary runner service; do
  mixed_release="$test_root/install/releases/mixed-$missing"
  create_bundle "$mixed_release" "mixed-$missing" "" "invalid mixed release"
  case "$missing" in
    binary) mv "$mixed_release/bin/tokenstation" "$mixed_release/bin/tokenhub" ;;
    runner) mv "$mixed_release/bin/tokenstation-run" "$mixed_release/bin/tokenhub-run" ;;
    service) mv "$mixed_release/deploy/tokenstation.service" "$mixed_release/deploy/tokenhub.service" ;;
  esac
  rm "$test_root/install/current"
  ln -s "releases/mixed-$missing" "$test_root/install/current"
  if run_entrypoint "$second_image" >"$test_root/mixed-error" 2>&1; then
    fail_test "mixed $missing layout was accepted"
  fi
  grep -q 'active release bundle is invalid' "$test_root/mixed-error" ||
    fail_test "mixed $missing layout failed for an unexpected reason"
done

# CI's deployment job already runs this entrypoint suite with Docker available.
# Keep image-context and fresh-volume coverage in that same job.
if command -v docker >/dev/null 2>&1; then
  bash "$script_dir/tokenstation-build-context_test.sh"
  bash "$script_dir/tokenstation-plugin-volume_test.sh"
fi

printf 'container entrypoint tests passed\n'
