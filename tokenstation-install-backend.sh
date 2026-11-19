#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

INSTALL_ROOT="${TOKENHUB_INSTALL_ROOT:-/opt/tokenhub}"
CONFIG_DIR="${TOKENHUB_CONFIG_DIR:-/etc/tokenhub}"
STATE_DIR="${TOKENHUB_STATE_DIR:-/var/lib/tokenhub}"
SYSTEMD_DIR="${TOKENHUB_SYSTEMD_DIR:-/etc/systemd/system}"
SERVICE_USER="${TOKENHUB_SERVICE_USER:-tokenstation}"
SERVICE_GROUP="${TOKENHUB_SERVICE_GROUP:-}"
SERVICE_NAME="${TOKENHUB_SERVICE_NAME:-tokenstation}"
BACKEND_DROPIN="90-tokenstation-backend.conf"
BACKEND_PORT="${TOKENHUB_BACKEND_PORT:-8080}"
SERVICE_READY_ATTEMPTS="${TOKENHUB_INSTALLER_READY_ATTEMPTS:-60}"
MANAGED_DIRECTORY_MARKER=".tokenhub-managed-directory"
MAX_ARCHIVE_BYTES=$((600 * 1024 * 1024))
MAX_EXTRACTED_BYTES=$((2 * 1024 * 1024 * 1024))
MAX_ARCHIVE_ENTRIES=100000
COMMAND=install
VERSION=""
ARCHIVE=""
SHA256_FILE=""
TEMP_DIR=""
PURGE=false
CREATED_SERVICE_USER=false
VALIDATE_ONLY=false

usage() {
  cat <<'EOF'
TokenStation offline backend-only installer (Linux/systemd)

Usage:
  bash tokenstation-install-backend.sh install --version VERSION --archive FILE [--sha256-file FILE]
  bash tokenstation-install-backend.sh upgrade --version VERSION --archive FILE [--sha256-file FILE]
  bash tokenstation-install-backend.sh rollback --version VERSION --archive FILE [--sha256-file FILE]
  bash tokenstation-install-backend.sh uninstall [--purge]
  bash tokenstation-install-backend.sh status
  Add --validate-only to install/upgrade/rollback to validate and stage without installing.

The default checksum file is FILE.sha256. It must contain a sha256sum-format
entry matching the archive basename, not a bare digest. Supply trusted local
archives and checksums. No release metadata or packages are downloaded.
The FULL package is required, including frontend/server.js and bin/node.
These files are retained, but Node.js is never checked or launched.

Existing configuration and secrets are preserved unchanged. New configuration
uses an empty CORS allowlist unless TOKENHUB_CORS_ALLOWED_ORIGINS is supplied.
Only the backend port and backend /healthz endpoint are checked.

Every deployment requires a new release directory. Same-version deployment and
existing targets are refused, including rollback to an already retained release.
Reusing an installed release requires a separate, manually reviewed mechanism;
do not remove a current release to bypass this protection. Back up the database
before upgrades or rollbacks. Readiness failure does NOT roll back code or data.

The dedicated 90-tokenstation-backend.conf drop-in resets ExecStart to the backend
launcher. Other overrides are not deleted. Conflicting overrides (including
later ExecStart overrides or commands launching other processes) require manual
handling before deployment. Uninstall removes only this installer's drop-in.

Environment:
  TOKENHUB_INSTALL_ROOT          Default: /opt/tokenhub
  TOKENHUB_CONFIG_DIR            Default: /etc/tokenhub
  TOKENHUB_STATE_DIR             Default: /var/lib/tokenhub
  TOKENHUB_SYSTEMD_DIR           Default: /etc/systemd/system
  TOKENHUB_SERVICE_USER          Default: tokenstation
  TOKENHUB_SERVICE_GROUP         Default: service user's primary group
  TOKENHUB_SERVICE_NAME          Default: tokenstation
  TOKENHUB_BACKEND_PORT          Default: 8080 (first install only)
  TOKENHUB_PUBLIC_HOST           Default: 127.0.0.1 (no public IP lookup)
  TOKENHUB_PUBLIC_BASE_URL       Default: http://PUBLIC_HOST:BACKEND_PORT
  TOKENHUB_CORS_ALLOWED_ORIGINS  Default: empty (first install only)
  TOKENHUB_DATABASE_URL          Default: sqlite://STATE_DIR/tokenhub.db
  TOKENHUB_INSTALLER_READY_ATTEMPTS  Default: 60
EOF
}

fail() { printf 'TokenStation installer: %s\n' "$*" >&2; exit 1; }
info() { printf '[TokenStation] %s\n' "$*"; }
warn() { printf '[TokenStation] Warning: %s\n' "$*" >&2; }
cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf -- "$TEMP_DIR"
  fi
}

validate_safe_path() {
  local value="$1" label="$2" cursor
  [[ "$value" == /* && "$value" != / ]] || fail "$label must be an absolute non-root path"
  [[ "$value" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "$label contains unsupported characters"
  [[ "$value" != */ && "$value" != *'//'* && "${value}/" != *'/../'* && "${value}/" != *'/./'* ]] ||
    fail "$label contains non-canonical path segments"
  cursor="$value"
  while [ "$cursor" != / ]; do
    [ ! -L "$cursor" ] || fail "$label must not traverse symbolic links: $cursor"
    cursor="${cursor%/*}"
    [ -n "$cursor" ] || cursor=/
  done
}

validate_managed_path() {
  local value="$1" label="$2"
  validate_safe_path "$value" "$label"
  case "$value" in
    /bin|/boot|/dev|/etc|/home|/lib|/lib64|/media|/mnt|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/usr/local|/var|/var/lib|/var/log|/var/tmp)
      fail "$label must be an application-specific directory" ;;
  esac
  [[ "${value#/}" == */* ]] || fail "$label must be at least two path segments below /"
}

validate_port() {
  [[ "$1" =~ ^[0-9]{1,5}$ ]] || fail "$2 must be a port number"
  ((10#$1 >= 1 && 10#$1 <= 65535)) || fail "$2 must be between 1 and 65535"
}

validate_single_line() {
  [[ "$1" != *$'\n'* && "$1" != *$'\r'* ]] || fail "$2 must not contain line breaks"
}

normalize_version() {
  local value="${1#v}"
  local number='(0|[1-9][0-9]*)'
  local pre='(0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)'
  [[ "$value" =~ ^${number}\.${number}\.${number}(-${pre}(\.${pre})*)?$ ]] || fail "invalid semantic version: $1"
  printf '%s\n' "$value"
}

compare_decimal() {
  local LC_ALL=C
  if ((${#1} < ${#2})); then printf '%s\n' -1
  elif ((${#1} > ${#2})); then printf '%s\n' 1
  elif [ "$1" = "$2" ]; then printf '%s\n' 0
  elif [[ "$1" < "$2" ]]; then printf '%s\n' -1
  else printf '%s\n' 1; fi
}

compare_versions() {
  local left="$1" right="$2" index comparison lp="" rp="" a b
  local LC_ALL=C
  local -a lc rc la ra
  IFS=. read -r -a lc <<<"${left%%-*}"
  IFS=. read -r -a rc <<<"${right%%-*}"
  for index in 0 1 2; do
    comparison="$(compare_decimal "${lc[$index]}" "${rc[$index]}")"
    if [ "$comparison" != 0 ]; then printf '%s\n' "$comparison"; return; fi
  done
  [[ "$left" != *-* ]] || lp="${left#*-}"
  [[ "$right" != *-* ]] || rp="${right#*-}"
  if [ "$lp" = "$rp" ]; then printf '0\n'; return; fi
  if [ -z "$lp" ]; then printf '1\n'; return; fi
  if [ -z "$rp" ]; then printf '%s\n' -1; return; fi
  IFS=. read -r -a la <<<"$lp"
  IFS=. read -r -a ra <<<"$rp"
  for ((index=0; index<${#la[@]} || index<${#ra[@]}; index++)); do
    if ((index >= ${#la[@]})); then printf '%s\n' -1; return; fi
    if ((index >= ${#ra[@]})); then printf '1\n'; return; fi
    a="${la[$index]}"; b="${ra[$index]}"
    if [[ "$a" =~ ^[0-9]+$ && "$b" =~ ^[0-9]+$ ]]; then comparison="$(compare_decimal "$a" "$b")"
    elif [[ "$a" =~ ^[0-9]+$ ]]; then comparison=-1
    elif [[ "$b" =~ ^[0-9]+$ ]]; then comparison=1
    elif [ "$a" = "$b" ]; then comparison=0
    elif [[ "$a" < "$b" ]]; then comparison=-1
    else comparison=1; fi
    if [ "$comparison" != 0 ]; then printf '%s\n' "$comparison"; return; fi
  done
  printf '0\n'
}

parse_args() {
  if [ "$#" -gt 0 ] && [[ "$1" != -* ]]; then COMMAND="$1"; shift; fi
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -v|--version) [ "$#" -ge 2 ] || fail "$1 requires a value"; VERSION="$(normalize_version "$2")"; shift 2 ;;
      --archive) [ "$#" -ge 2 ] || fail "$1 requires a value"; ARCHIVE="$2"; shift 2 ;;
      --sha256-file) [ "$#" -ge 2 ] || fail "$1 requires a value"; SHA256_FILE="$2"; shift 2 ;;
      --validate-only) VALIDATE_ONLY=true; shift ;;
      --purge) PURGE=true; shift ;;
      -h|--help) usage; exit 0 ;;
      *) fail "unknown argument: $1" ;;
    esac
  done
  case "$COMMAND" in
    install|upgrade|rollback)
      [ -n "$VERSION" ] && [ -n "$ARCHIVE" ] || fail "$COMMAND requires --version and --archive"
      [ "$PURGE" = false ] || fail "--purge is only valid for uninstall"
      SHA256_FILE="${SHA256_FILE:-${ARCHIVE}.sha256}" ;;
    uninstall|status|help)
      [ "$VALIDATE_ONLY" = false ] || fail "--validate-only is only valid for deployment"
      [ -z "$VERSION$ARCHIVE$SHA256_FILE" ] || fail "archive and version options are only valid for deployment"
      [ "$COMMAND" = uninstall ] || [ "$PURGE" = false ] || fail "--purge is only valid for uninstall" ;;
    *) fail "unknown command: $COMMAND" ;;
  esac
}

require_platform() {
  [ "${EUID:-$(id -u)}" -eq 0 ] || fail "run this installer as root"
  [ "$(uname -s)" = Linux ] || fail "native installation supports Linux only"
  local tool first second
  for tool in systemctl sha256sum curl tar sed awk find install od tr wc readlink mktemp cp mv ln chmod chown cmp; do
    command -v "$tool" >/dev/null 2>&1 || fail "missing required command: $tool"
  done
  validate_managed_path "$INSTALL_ROOT" TOKENHUB_INSTALL_ROOT
  validate_managed_path "$CONFIG_DIR" TOKENHUB_CONFIG_DIR
  validate_managed_path "$STATE_DIR" TOKENHUB_STATE_DIR
  validate_safe_path "$SYSTEMD_DIR" TOKENHUB_SYSTEMD_DIR
  for first in "$INSTALL_ROOT" "$CONFIG_DIR" "$STATE_DIR"; do
    for second in "$INSTALL_ROOT" "$CONFIG_DIR" "$STATE_DIR" "$SYSTEMD_DIR"; do
      if [ "$first" = "$second" ]; then continue; fi
      [[ "$first/" != "$second/"* && "$second/" != "$first/"* ]] || fail "managed directories must not overlap"
    done
    [ "$first" != "$SYSTEMD_DIR" ] || fail "managed directories must not equal the systemd directory"
  done
  [ "$INSTALL_ROOT" != "$CONFIG_DIR" ] && [ "$INSTALL_ROOT" != "$STATE_DIR" ] && [ "$CONFIG_DIR" != "$STATE_DIR" ] || fail "managed directories must be distinct"
  [[ "$SERVICE_USER" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || fail "invalid service user"
  [[ -z "$SERVICE_GROUP" || "$SERVICE_GROUP" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || fail "invalid service group"
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]*$ ]] || fail "invalid service name"
  validate_port "$BACKEND_PORT" TOKENHUB_BACKEND_PORT
  [[ "$SERVICE_READY_ATTEMPTS" =~ ^[1-9][0-9]{0,3}$ ]] || fail "readiness attempts must be between 1 and 9999"
}

resolve_existing_service() {
  local directory marker marked="" candidate found="" unit value
  for directory in "$INSTALL_ROOT" "$CONFIG_DIR" "$STATE_DIR"; do
    marker="$directory/$MANAGED_DIRECTORY_MARKER"
    validate_safe_path "$marker" "service ownership marker"
    if [ -f "$marker" ]; then
      value="$(sed -n 's/^service=//p' "$marker")"
      [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]*$ ]] || fail "invalid managed service marker"
      [ -z "$marked" ] || [ "$marked" = "$value" ] || fail "conflicting managed service markers"
      marked="$value"
    fi
  done
  for candidate in tokenstation tokenhub "${marked:-$SERVICE_NAME}" "$SERVICE_NAME"; do
    unit="$SYSTEMD_DIR/$candidate.service"
    validate_safe_path "$unit" "existing service unit"
    if [ -f "$unit" ] || systemctl is-active --quiet "$candidate" 2>/dev/null; then
      [ -z "$found" ] || [ "$found" = "$candidate" ] || fail "conflicting native services: $found and $candidate"
      found="$candidate"
    fi
  done
  [ -z "$marked" ] || [ -z "$found" ] || [ "$marked" = "$found" ] || fail "service unit conflicts with ownership marker"
  found="${found:-$marked}"
  if [ -n "$found" ]; then
    [ -z "${TOKENHUB_SERVICE_NAME:-}" ] || [ "$TOKENHUB_SERVICE_NAME" = "$found" ] || fail "existing service conflicts with TOKENHUB_SERVICE_NAME"
    SERVICE_NAME="$found"
    unit="$SYSTEMD_DIR/$found.service"
    value=""
    if [ -f "$unit" ]; then value="$(sed -n 's/^User=//p' "$unit")"; fi
    if [ -z "$value" ] && [ -f "$CONFIG_DIR/.service-user-created" ]; then
      validate_safe_path "$CONFIG_DIR/.service-user-created" "service user marker"
      IFS=: read -r value _ <"$CONFIG_DIR/.service-user-created" || true
    fi
    if [ -z "$value" ]; then
      if [ "$found" = tokenhub ]; then value=tokenhub; else value="$SERVICE_USER"; fi
    fi
    [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || fail "invalid existing service user"
    [ -z "${TOKENHUB_SERVICE_USER:-}" ] || [ "$TOKENHUB_SERVICE_USER" = "$value" ] || fail "existing service user conflicts with TOKENHUB_SERVICE_USER"
    SERVICE_USER="$value"
    if [ -f "$unit" ]; then
      value="$(sed -n 's/^Group=//p' "$unit")"
      if [ -n "$value" ]; then
        [[ "$value" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || fail "invalid existing service group"
        [ -z "$SERVICE_GROUP" ] || [ "$SERVICE_GROUP" = "$value" ] || fail "existing service group conflicts with TOKENHUB_SERVICE_GROUP"
        SERVICE_GROUP="$value"
      fi
    fi
  fi
  directory="$SYSTEMD_DIR/${SERVICE_NAME}.service.d"
  validate_safe_path "$directory/90-tokenhub-backend.conf" "legacy backend drop-in"
  validate_safe_path "$directory/90-tokenstation-backend.conf" "backend drop-in"
  if [ -f "$directory/90-tokenhub-backend.conf" ]; then
    [ ! -e "$directory/90-tokenstation-backend.conf" ] || fail "conflicting backend drop-ins; retain only one installer-managed drop-in"
    BACKEND_DROPIN=90-tokenhub-backend.conf
  fi
}

read_config_value() {
  awk -v key="$2" '
    { line=$0; sub(/^[ \t]+/, "", line) }
    index(line, key "=") == 1 {
      value=substr(line, length(key)+2); sub(/^[ \t]+/, "", value); sub(/[ \t]+$/, "", value)
      quote=substr(value,1,1)
      if (quote == "\"" || quote == sprintf("%c",39)) {
        if (substr(value,length(value),1) != quote) exit 2
        value=substr(value,2,length(value)-2)
      }
      if (value ~ /[\\\\\"\047]/) exit 2
      found=1
    }
    END { if (found) print value }
  ' "$1"
}

marker_content() {
  printf 'tokenhub-native-managed-directory-v1\nkind=%s\npath=%s\nservice=%s\n' "$2" "$1" "$SERVICE_NAME"
}

require_marker() {
  local marker="$1/$MANAGED_DIRECTORY_MARKER" actual
  [ -d "$1" ] && [ ! -L "$1" ] && [ -f "$marker" ] && [ ! -L "$marker" ] || fail "refusing unmarked $2 directory: $1"
  actual="$(<"$marker")"
  [ "$actual" = "$(marker_content "$1" "$2")" ] || fail "invalid ownership marker: $1"
}

legacy_directory_valid() {
  local directory="$1" kind="$2" env_file="$CONFIG_DIR/tokenhub.env"
  case "$kind" in
    application) [ -f "$directory/current/VERSION" ] || { [ -f "$env_file" ] && [ "$(read_config_value "$env_file" TOKENHUB_INSTALL_ROOT)" = "$directory" ]; } ;;
    configuration) [ -f "$directory/tokenhub.env" ] ;;
    state) [ -f "$directory/tokenhub.db" ] || { [ -f "$env_file" ] && { [ "$(read_config_value "$env_file" TOKENHUB_DATABASE_URL)" = "sqlite://$directory/tokenhub.db" ] || [ "$(read_config_value "$env_file" TOKENHUB_SQLITE_BACKUP_DIR)" = "$directory/backups" ]; }; } ;;
  esac
}

validate_directory_claim() {
  local directory="$1" kind="$2" marker="$1/$MANAGED_DIRECTORY_MARKER"
  if [ -e "$directory" ]; then
    [ -d "$directory" ] || fail "not a directory: $directory"
    if [ -e "$marker" ] || [ -L "$marker" ]; then require_marker "$directory" "$kind"
    elif [ -n "$(find "$directory" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
      legacy_directory_valid "$directory" "$kind" || fail "refusing non-empty unmarked $kind directory: $directory"
    fi
  fi
}

prepare_directory() {
  local directory="$1" kind="$2" owner="$3" marker="$1/$MANAGED_DIRECTORY_MARKER"
  validate_directory_claim "$directory" "$kind"
  install -d -m 0750 -o "$owner" -g "$SERVICE_GROUP" "$directory"
  if [ ! -f "$marker" ]; then
    marker_content "$directory" "$kind" >"$marker"
    chown root:"$SERVICE_GROUP" "$marker"
    chmod 0600 "$marker"
  fi
}

validate_target() {
  local current="$INSTALL_ROOT/current" current_version comparison resolved
  if [ -e "$current" ] || [ -L "$current" ]; then
    [ -L "$current" ] && [ -f "$current/VERSION" ] || fail "current must be a valid release symbolic link"
    resolved="$(readlink -f -- "$current")"
    [[ "$resolved" == "$INSTALL_ROOT/releases/"* ]] || fail "current points outside the releases directory"
    current_version="$(normalize_version "$(tr -d '[:space:]' <"$current/VERSION")")"
    comparison="$(compare_versions "$VERSION" "$current_version")"
    [ "$comparison" != 0 ] || fail "v$VERSION is already current; refusing same-version deployment"
    if [ "$COMMAND" = rollback ]; then
      [ "$comparison" -lt 0 ] || fail "rollback must target a version older than v$current_version"
    else
      [ "$comparison" -gt 0 ] || fail "target must be newer than v$current_version; use rollback for older versions"
    fi
  elif [ "$COMMAND" = rollback ]; then fail "rollback requires an installed release"; fi
  [ ! -e "$INSTALL_ROOT/releases/$VERSION" ] && [ ! -L "$INSTALL_ROOT/releases/$VERSION" ] ||
    fail "release target already exists: $VERSION; refusing overwrite or reuse, including rollback. Use a separately reviewed release-switch mechanism."
}

validate_local_archive() {
  local asset expected actual size
  [ -f "$ARCHIVE" ] && [ -r "$ARCHIVE" ] || fail "archive must be a readable local regular file"
  [ -f "$SHA256_FILE" ] && [ -r "$SHA256_FILE" ] || fail "checksum file must be a readable local regular file"
  size="$(wc -c <"$ARCHIVE")"
  ((size <= MAX_ARCHIVE_BYTES)) || fail "archive exceeds size limit"
  size="$(wc -c <"$SHA256_FILE")"
  ((size <= 1024 * 1024)) || fail "checksum file exceeds size limit"
  asset="${ARCHIVE##*/}"
  [[ "$asset" =~ ^[A-Za-z0-9._-]+$ ]] || fail "archive basename contains unsupported characters"
  expected="$(awk -v file="$asset" '$2 == file || $2 == "*" file { value=$1; count++ } END { if (count == 1) print value }' "$SHA256_FILE")"
  [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]] || fail "checksum file must contain exactly one valid entry for $asset"
  TEMP_DIR="$(mktemp -d)"
  # Snapshot the input so extraction uses the exact bytes that were verified.
  cp -- "$ARCHIVE" "$TEMP_DIR/release.tar.gz"
  size="$(wc -c <"$TEMP_DIR/release.tar.gz")"
  ((size <= MAX_ARCHIVE_BYTES)) || fail "archive exceeds size limit"
  actual="$(sha256sum -- "$TEMP_DIR/release.tar.gz" | awk '{print $1}')"
  expected="$(printf '%s' "$expected" | tr '[:upper:]' '[:lower:]')"
  [ "$actual" = "$expected" ] || fail "SHA-256 verification failed for $asset"
}

validate_archive_entries() {
  local entry listing type mode owner size date time remainder count=0 total=0
  tar -tzf "$TEMP_DIR/release.tar.gz" >"$TEMP_DIR/paths" || fail "invalid gzip tar archive"
  while IFS= read -r entry; do
    [[ "$entry" != /* && "/$entry/" != *'/../'* ]] || fail "archive contains an unsafe path"
  done <"$TEMP_DIR/paths"
  LC_ALL=C tar -tvzf "$TEMP_DIR/release.tar.gz" >"$TEMP_DIR/listing" || fail "cannot inspect archive"
  while IFS= read -r listing; do
    ((count += 1))
    ((count <= MAX_ARCHIVE_ENTRIES)) || fail "archive contains too many entries"
    type="${listing:0:1}"
    case "$type" in
      -)
        read -r mode owner size date time remainder <<<"$listing"
        [[ "$size" =~ ^[0-9]+$ ]] || fail "archive has an unreadable file size (GNU tar required)"
        [ "$(compare_decimal "$size" "$MAX_ARCHIVE_BYTES")" -le 0 ] || fail "archive contains an oversized file"
        ((total += 10#$size + 1))
        ((total <= MAX_EXTRACTED_BYTES)) || fail "archive exceeds extracted size limit" ;;
      d) ;;
      *) fail "archive contains a link or special file" ;;
    esac
  done <"$TEMP_DIR/listing"
}

stage_release() {
  local staging path
  validate_local_archive
  staging="$TEMP_DIR/staged"
  validate_archive_entries
  install -d -m 0750 "$staging"
  tar --no-same-owner --no-same-permissions -xzf "$TEMP_DIR/release.tar.gz" -C "$staging"
  [ -z "$(find "$staging" -type l -print -quit)" ] || fail "archive contains symbolic links"
  for path in bin/tokenstation bin/node bin/tokenstation-run frontend/server.js catalog/model-catalog.yaml catalog/provider-catalog.json deploy/tokenstation.service VERSION; do
    [ -f "$staging/$path" ] || fail "full release archive is missing regular file $path"
  done
  [ "$(tr -d '[:space:]' <"$staging/VERSION")" = "$VERSION" ] || fail "archive VERSION does not match v$VERSION"
  cp -- "$staging/bin/tokenstation-run" "$TEMP_DIR/packaged-tokenstation-run"
  cat >"$staging/bin/tokenstation-run" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail

release_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "${TOKENHUB_ENABLE_FRONTEND:-false}" in
  false)
    exec "$release_dir/bin/tokenstation" "$@"
    ;;
  true)
    ;;
  *)
    echo "TOKENHUB_ENABLE_FRONTEND must be true or false" >&2
    exit 1
    ;;
esac

test -x "$release_dir/bin/node"
test -f "$release_dir/frontend/server.js"

backend_pid=""
frontend_pid=""

cleanup() {
  trap - EXIT INT TERM
  if [ -n "$frontend_pid" ]; then
    kill -TERM "$frontend_pid" 2>/dev/null || true
  fi
  if [ -n "$backend_pid" ]; then
    kill -TERM "$backend_pid" 2>/dev/null || true
  fi
  if [ -n "$frontend_pid" ]; then
    wait "$frontend_pid" 2>/dev/null || true
  fi
  if [ -n "$backend_pid" ]; then
    wait "$backend_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT
trap 'exit 0' INT TERM

"$release_dir/bin/tokenstation" "$@" &
backend_pid=$!

(
  cd "$release_dir/frontend"
  exec env \
    NODE_ENV=production \
    HOSTNAME="${TOKENHUB_FRONTEND_HOST:-127.0.0.1}" \
    PORT="${TOKENHUB_FRONTEND_PORT:-3000}" \
    "$release_dir/bin/node" server.js
) &
frontend_pid=$!

exit_code=0
wait -n "$backend_pid" "$frontend_pid" || exit_code=$?
exit "$exit_code"
EOF
  cmp -s "$TEMP_DIR/packaged-tokenstation-run" "$staging/bin/tokenstation-run" || fail "packaged launcher differs from the installer's canonical launcher"
  chmod 0755 "$staging/bin/tokenstation" "$staging/bin/node" "$staging/bin/tokenstation-run"
  info "Validated and staged full release v$VERSION (frontend opt-in)"
}

ensure_service_user() {
  if ! id "$SERVICE_USER" >/dev/null 2>&1; then
    command -v useradd >/dev/null 2>&1 || fail "useradd is required"
    useradd --system --user-group --home-dir "$STATE_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
    CREATED_SERVICE_USER=true
  fi
  SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn "$SERVICE_USER")}"
  [[ "$SERVICE_GROUP" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]] || fail "invalid service group"
}

validate_initial_config() {
  [ ! -f "$CONFIG_DIR/tokenhub.env" ] || return 0
  local value name
  for name in TOKENHUB_PUBLIC_HOST TOKENHUB_PUBLIC_BASE_URL TOKENHUB_CORS_ALLOWED_ORIGINS TOKENHUB_DATABASE_URL; do
    value="${!name:-}"
    validate_single_line "$value" "$name"
    [[ "$value" != *'"'* && "$value" != *"'"* && "$value" != *'\'* ]] || fail "$name contains unsupported environment-file quoting"
  done
  if command -v ss >/dev/null 2>&1; then
    [ -z "$(ss -H -ltn "sport = :$((10#$BACKEND_PORT))")" ] || fail "backend port $BACKEND_PORT is already in use"
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then fail "backend port $BACKEND_PORT is already in use"; fi
  else fail "ss or lsof is required for the initial backend port check"; fi
}

random_hex() { od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'; }

write_initial_config() {
  local env_file="$CONFIG_DIR/tokenhub.env" host public_url database_url
  if [ -f "$env_file" ]; then info "Keeping existing configuration and secrets unchanged at $env_file"; return; fi
  host="${TOKENHUB_PUBLIC_HOST:-127.0.0.1}"
  [[ "$host" != *:* || "$host" == \[*\] ]] || host="[$host]"
  public_url="${TOKENHUB_PUBLIC_BASE_URL:-http://${host}:${BACKEND_PORT}}"
  database_url="${TOKENHUB_DATABASE_URL:-sqlite://${STATE_DIR}/tokenhub.db}"
  cat >"$env_file" <<EOF
TOKENHUB_ENV=prod
TOKENHUB_HTTP_ADDR=:${BACKEND_PORT}
TOKENHUB_PUBLIC_HOST=${TOKENHUB_PUBLIC_HOST:-127.0.0.1}
TOKENHUB_PUBLIC_BASE_URL=${public_url}
TOKENHUB_CORS_ALLOWED_ORIGINS=${TOKENHUB_CORS_ALLOWED_ORIGINS:-}
TOKENHUB_ADMIN_TOKEN=$(random_hex 32)
TOKENHUB_BOOTSTRAP_ADMIN_PASSWORD=$(random_hex 12)
TOKENHUB_SECRET_KEY=$(random_hex 32)
TOKENHUB_DATABASE_URL=${database_url}
TOKENHUB_SQLITE_BACKUP_DIR=${STATE_DIR}/backups
TOKENHUB_IMAGE_STORAGE_DIR=${STATE_DIR}/images
TOKENHUB_MODEL_CATALOG_FILE=${INSTALL_ROOT}/current/catalog/model-catalog.yaml
TOKENHUB_PROVIDER_CATALOG_FILE=${INSTALL_ROOT}/current/catalog/provider-catalog.json
TOKENHUB_INSTALL_ROOT=${INSTALL_ROOT}
TOKENHUB_SEED_DEMO=false
EOF
  chown root:"$SERVICE_GROUP" "$env_file"
  chmod 0640 "$env_file"
  install -m 0600 /dev/null "$CONFIG_DIR/.initial-admin-password-pending"
  info "Created backend-only configuration at $env_file"
}

render_service() {
  sed -e "s|@SERVICE_USER@|$SERVICE_USER|g" -e "s|@SERVICE_GROUP@|$SERVICE_GROUP|g" \
    -e "s|@CONFIG_DIR@|$CONFIG_DIR|g" -e "s|@INSTALL_ROOT@|$INSTALL_ROOT|g" \
    -e "s|@STATE_DIR@|$STATE_DIR|g" "$TEMP_DIR/staged/deploy/tokenstation.service" >"$TEMP_DIR/tokenstation.service"
  cat >"$TEMP_DIR/90-tokenstation-backend.conf" <<EOF
[Service]
ExecStart=
ExecStart=${INSTALL_ROOT}/current/bin/tokenstation-run
EOF
}

wait_for_service_ready() {
  local address port attempt
  address="$(read_config_value "$CONFIG_DIR/tokenhub.env" TOKENHUB_HTTP_ADDR)"
  port="${address##*:}"
  validate_port "$port" "TOKENHUB_HTTP_ADDR port"
  for ((attempt=1; attempt<=SERVICE_READY_ATTEMPTS; attempt++)); do
    if systemctl is-active --quiet "$SERVICE_NAME" &&
      curl --noproxy '*' -fsS --connect-timeout 2 --max-time 3 "http://127.0.0.1:${port}/healthz" >/dev/null 2>&1; then return; fi
    sleep 1
  done
  warn "Backend readiness failed. The selected release remains active; no automatic code or database rollback was attempted. Inspect service status and logs, and review database compatibility before recovery."
  fail "TokenStation did not become ready after $SERVICE_READY_ATTEMPTS checks"
}

install_or_upgrade() {
  local directory owner path next_link="$INSTALL_ROOT/.current.backend.$$"
  validate_target
  for path in "$INSTALL_ROOT/releases" "$CONFIG_DIR/tokenhub.env" "$CONFIG_DIR/.service-user-created" "$CONFIG_DIR/.initial-admin-password-pending" "$SYSTEMD_DIR/${SERVICE_NAME}.service" "$SYSTEMD_DIR/${SERVICE_NAME}.service.d" "$SYSTEMD_DIR/${SERVICE_NAME}.service.d/$BACKEND_DROPIN"; do
    validate_safe_path "$path" "managed file or directory"
  done
  validate_directory_claim "$INSTALL_ROOT" application
  validate_directory_claim "$CONFIG_DIR" configuration
  validate_directory_claim "$STATE_DIR" state
  validate_initial_config
  if [ -f "$CONFIG_DIR/tokenhub.env" ]; then
    validate_port "$(read_config_value "$CONFIG_DIR/tokenhub.env" TOKENHUB_HTTP_ADDR | awk -F: '{print $NF}')" "configured backend port"
  fi
  stage_release
  if [ "$VALIDATE_ONLY" = true ]; then info "Validation complete; no installation mutations performed"; return; fi
  # All archive validation finishes before user/config/service mutations.
  ensure_service_user
  render_service
  prepare_directory "$INSTALL_ROOT" application "$SERVICE_USER"
  prepare_directory "$CONFIG_DIR" configuration root
  prepare_directory "$STATE_DIR" state "$SERVICE_USER"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_GROUP" "$INSTALL_ROOT/releases" "$STATE_DIR/backups" "$STATE_DIR/images"
  write_initial_config
  if [ "$CREATED_SERVICE_USER" = true ]; then
    printf '%s:%s\n' "$SERVICE_USER" "$(id -u "$SERVICE_USER")" >"$CONFIG_DIR/.service-user-created"
    chmod 0600 "$CONFIG_DIR/.service-user-created"
  fi
  validate_target
  cp -a -- "$TEMP_DIR/staged" "$INSTALL_ROOT/releases/$VERSION"
  chown -R "$SERVICE_USER:$SERVICE_GROUP" "$INSTALL_ROOT/releases/$VERSION"
  [ ! -e "$next_link" ] && [ ! -L "$next_link" ] || fail "temporary current link already exists"
  ln -s -- "$INSTALL_ROOT/releases/$VERSION" "$next_link"
  warn "Other systemd overrides are preserved. Conflicting overrides may need manual handling; inspect systemctl cat $SERVICE_NAME."
  # Stop the old process before switching current, including automatic restarts.
  systemctl stop "$SERVICE_NAME" || {
    if systemctl cat "$SERVICE_NAME" >/dev/null 2>&1; then fail "could not stop existing service; current was not switched"; fi
  }
  mv -Tf -- "$next_link" "$INSTALL_ROOT/current"
  install -d -m 0755 "$SYSTEMD_DIR" "$SYSTEMD_DIR/${SERVICE_NAME}.service.d"
  install -m 0644 "$TEMP_DIR/tokenstation.service" "$SYSTEMD_DIR/${SERVICE_NAME}.service"
  install -m 0644 "$TEMP_DIR/90-tokenstation-backend.conf" "$SYSTEMD_DIR/${SERVICE_NAME}.service.d/$BACKEND_DROPIN"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME"
  systemctl start "$SERVICE_NAME" || { warn "Service start failed; no automatic code or database rollback was attempted."; fail "could not start backend"; }
  wait_for_service_ready
  info "TokenStation backend v$VERSION is running (no frontend process)"
  if [ -f "$CONFIG_DIR/.initial-admin-password-pending" ]; then
    info "Initial admin username: admin. Read TOKENHUB_BOOTSTRAP_ADMIN_PASSWORD from $CONFIG_DIR/tokenhub.env securely; credentials are not printed."
  fi
  info "Configuration: $CONFIG_DIR/tokenhub.env"
  info "Logs: journalctl -u ${SERVICE_NAME} -f"
}

uninstall_tokenstation() {
  local remove_user=false expected_user="" expected_uid="" marker="$CONFIG_DIR/.service-user-created" path
  for path in "$SYSTEMD_DIR/${SERVICE_NAME}.service" "$SYSTEMD_DIR/${SERVICE_NAME}.service.d" "$SYSTEMD_DIR/${SERVICE_NAME}.service.d/$BACKEND_DROPIN" "$marker"; do
    validate_safe_path "$path" "uninstall path"
  done
  if [ -f "$marker" ]; then
    IFS=: read -r expected_user expected_uid <"$marker" || true
    if [ "$expected_user" = "$SERVICE_USER" ] && [[ "$expected_uid" =~ ^[0-9]+$ ]] &&
      [ "$(id -u "$SERVICE_USER" 2>/dev/null || true)" = "$expected_uid" ]; then remove_user=true; fi
  fi
  [ ! -e "$INSTALL_ROOT" ] || require_marker "$INSTALL_ROOT" application
  if [ "$PURGE" = true ]; then
    [ ! -e "$CONFIG_DIR" ] || require_marker "$CONFIG_DIR" configuration
    [ ! -e "$STATE_DIR" ] || require_marker "$STATE_DIR" state
  fi
  systemctl disable --now "$SERVICE_NAME" 2>/dev/null || {
    if systemctl is-active --quiet "$SERVICE_NAME"; then fail "service is still active; refusing uninstall"; fi
  }
  rm -f -- "$SYSTEMD_DIR/${SERVICE_NAME}.service" "$SYSTEMD_DIR/${SERVICE_NAME}.service.d/$BACKEND_DROPIN"
  systemctl daemon-reload
  rm -rf -- "$INSTALL_ROOT"
  if [ "$PURGE" = true ]; then
    rm -rf -- "$CONFIG_DIR" "$STATE_DIR"
    if [ "$remove_user" = true ]; then userdel "$SERVICE_USER" 2>/dev/null || warn "Could not remove installer-created service user"; fi
    info "Removed application, configuration, and data; unrelated systemd overrides were preserved"
  else info "Removed application; preserved $CONFIG_DIR, $STATE_DIR, and unrelated systemd overrides"; fi
}

main() {
  trap cleanup EXIT
  parse_args "$@"
  if [ "$COMMAND" = help ]; then usage; return; fi
  require_platform
  resolve_existing_service
  case "$COMMAND" in
    install|upgrade|rollback) install_or_upgrade ;;
    uninstall) uninstall_tokenstation ;;
    status) systemctl status --no-pager "$SERVICE_NAME" ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
