#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../backend"
server_package=tokenhub/backend/internal/server
shard_count=4
test_timeout=15m
# Each shard is its own Go process. Bound scheduler concurrency across the
# shards so SQLite work and timers do not contend with a full CPU pool each.
export GOMAXPROCS="${GOMAXPROCS:-2}"
log_dir="$(mktemp -d)"
pids=()
cleanup() {
  local pid
  for pid in $(jobs -pr); do
    kill "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  find "$log_dir" -type f -delete
  rmdir "$log_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

go list ./... | awk -v server="$server_package" '$0 != server' > "$log_dir/packages"
packages=()
while IFS= read -r package; do
  packages+=("$package")
done < "$log_dir/packages"
# Compile once and discover the top-level tests in the binary that will run.
# Each child still runs every subtest of its assigned top-level tests.
go test -c -o "$log_dir/server.test" "$server_package"
(
  cd internal/server
  "$log_dir/server.test" -test.list '^(Test|Fuzz|Example)'
) > "$log_dir/tests"
awk -v dir="$log_dir" -v count="$shard_count" '
  /^(Test|Fuzz|Example)[A-Za-z0-9_]*$/ {
    shard = matched++ % count
    print $0 >> (dir "/shard-" shard)
  }
' "$log_dir/tests"

go test -timeout "$test_timeout" "${packages[@]}" > "$log_dir/packages.log" 2>&1 &
pids+=("$!")
for ((shard = 0; shard < shard_count; shard++)); do
  [[ -s "$log_dir/shard-$shard" ]] || continue
  pattern="$(paste -sd '|' "$log_dir/shard-$shard")"
  (
    cd internal/server
    exec "$log_dir/server.test" -test.paniconexit0 -test.timeout="$test_timeout" -test.run "^($pattern)$"
  ) > "$log_dir/shard-$shard.log" 2>&1 &
  pids+=("$!")
done

status=0
for ((index = 0; index < ${#pids[@]}; index++)); do
  if ((index == 0)); then
    label="Backend packages"
    log="$log_dir/packages.log"
  else
    label="Server shard $index/$shard_count"
    log="$log_dir/shard-$((index - 1)).log"
  fi
  if wait "${pids[index]}"; then
    printf '%s passed\n' "$label"
  else
    printf '%s failed\n' "$label" >&2
    cat "$log" >&2
    status=1
  fi
done
exit "$status"
