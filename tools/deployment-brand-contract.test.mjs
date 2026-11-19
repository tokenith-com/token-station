import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("deployment entrypoints use TokenStation names and preserve executable modes", () => {
  for (const path of ["tokenstation-run", "tokenstation-release.sh", "tokenstation-build-full-linux-amd64.sh", "tokenstation-install-backend.sh", "deploy/native/tokenstation-run", "deploy/container/tokenstation-entrypoint", "deploy/container/tokenstation-build-id"]) {
    assert.ok(existsSync(new URL(path, root)), path);
    const executable = ["deploy/native/tokenstation-run", "deploy/container/tokenstation-build-id"].includes(path);
    assert.equal(Boolean(statSync(new URL(path, root)).mode & 0o111), executable, `${path} must preserve its original mode`);
  }
  assert.ok(!existsSync(new URL("dist/tokenstation", root)));
  assert.ok(!existsSync(new URL("dist/tokenhub", root)));
  assert.match(read("start.sh"), /build -o.*\.\/cmd\/tokenstation/);
  const dockerfile = read("backend/Dockerfile");
  assert.match(dockerfile, /ENTRYPOINT \["\/usr\/local\/bin\/tokenstation-entrypoint"\]/);
  assert.match(dockerfile, /deploy\/native\/tokenstation\.service/);
  assert.match(read("deploy/native/tokenstation.service"), /ExecStart=.*\/bin\/tokenstation-run/);
  assert.match(read("deploy/container/tokenstation-entrypoint"), /exec "\$release_dir\/bin\/\$bundle_command-run"/);
});

test("deployment preserves persisted paths, volumes, environment names and real remotes", () => {
  for (const file of ["deploy/docker-compose.yml", "deploy/docker-compose.postgres.yml", "deploy/docker-compose.remote-postgres.yml"]) {
    const source = read(file);
    assert.match(source, /tokenstation-backend:/);
    assert.match(source, /ghcr\.io\/astaxie\/tokenhub-backend:/);
    assert.match(source, /astaxie\/TokenHub/);
    assert.match(source, /TOKENHUB_INSTALL_ROOT: \/opt\/tokenhub/);
    assert.match(source, /name: tokenhub-plugins/);
    assert.doesNotMatch(source, /TOKENSTATION_/);
  }
  const compose = read("deploy/docker-compose.yml");
  for (const name of ["tokenhub-data", "tokenhub-plugins", "tokenhub-releases"]) assert.ok(compose.includes(`name: ${name}`));
  assert.match(compose, /name: tokenstation\s*$/);
  const installer = read("tokenstation-install-backend.sh");
  for (const value of ["/opt/tokenhub", "/etc/tokenhub", "/var/lib/tokenhub", "tokenhub.env", "tokenhub.db"]) assert.ok(installer.includes(value), value);
  assert.match(read("deploy/helm/tokenstation/values.yaml"), /ghcr\.io\/astaxie\/tokenhub-backend/);
  assert.match(read("deploy/helm/tokenstation/Chart.yaml"), /https:\/\/github\.com\/astaxie\/TokenHub/);
  const postgres = read("deploy/docker-compose.postgres.yml");
  assert.match(postgres, /POSTGRES_DB:-tokenhub/);
  assert.match(postgres, /POSTGRES_USER:-tokenhub/);
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /POSTGRES_DB: tokenhub_e2e/);
  assert.match(ci, /POSTGRES_USER: tokenhub/);
  assert.match(ci, /POSTGRES_PASSWORD: tokenhub-e2e-password/);
  assert.match(read("deploy/local/run-local.sh"), /build -o.*\.\/cmd\/tokenstation/);
});

test("release builders publish complete primary and legacy archives without symlinks", () => {
  for (const file of ["tokenstation-build-full-linux-amd64.sh", ".github/workflows/native-release.yml"]) {
    const source = read(file);
    assert.match(source, /tokenstation_\$\{VERSION\}_linux_/);
    assert.match(source, /tokenhub_\$\{VERSION\}_linux_/);
    assert.ok(source.includes("bin/tokenstation-run"));
    assert.ok(source.includes("bin/tokenhub-run"));
    assert.ok(source.includes("bin/tokenhub"));
    assert.ok(source.includes("deploy/tokenhub.service"));
    assert.ok(source.includes(".replace('tokenstation', 'tokenhub')"));
    assert.match(source, /find .*legacy.*-type l/i);
    assert.match(source, /sha256sum .*checksums\.txt/);
    assert.ok(source.includes('exec "$(dirname "$0")/tokenstation-run" "$@"'));
    assert.doesNotMatch(source, /\bln -s/);
  }
  const release = read(".github/workflows/native-release.yml");
  assert.match(release, /sha256sum tokenstation_\*\.tar\.gz tokenhub_\*\.tar\.gz >checksums\.txt/);
  assert.match(release, /gh release upload[\s\S]*tokenstation_\*\.tar\.gz[\s\S]*tokenhub_\*\.tar\.gz/);
});

test("CI uses current command names while historical N-1 builds retain their source paths", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /current-tokenstation" \.\/cmd\/tokenstation/);
  assert.match(ci, /\.\.\/n1\/backend && go build .*\.\/cmd\/tokenhub\)/);
  assert.match(ci, /cd n1\/backend && go build .*\.\/cmd\/tokenhub\)/);
  assert.match(ci, /cd n15\/backend && go build .*\.\/cmd\/tokenhub\)/);
  assert.match(ci, /deploy\/container\/tokenstation-entrypoint_test\.sh/);
  assert.match(ci, /helm lint deploy\/helm\/tokenstation/);
  assert.match(read(".github/workflows/migration-ci.yml"), /go build -o tokenstation-migrate \.\/cmd\/tokenstation-migrate/);
  assert.doesNotMatch(ci, /deploy\/(?:container|helm|native)\/tokenhub/);
});

test("offline installer retains legacy service identity, markers and drop-in ownership", async () => {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("bash", ["-c", String.raw`
set -Eeuo pipefail
source ./tokenstation-install-backend.sh
sandbox="$(mktemp -d)"
sandbox="$(cd "$sandbox" && pwd -P)"
trap 'rm -rf "$sandbox"' EXIT
INSTALL_ROOT="$sandbox/app"
CONFIG_DIR="$sandbox/config"
STATE_DIR="$sandbox/state"
SYSTEMD_DIR="$sandbox/systemd"
mkdir -p "$INSTALL_ROOT" "$CONFIG_DIR" "$STATE_DIR" "$SYSTEMD_DIR"
systemctl() { return 3; }
reject() { if ( "$@" ) >/dev/null 2>&1; then printf 'unexpected success: %s\n' "$*" >&2; exit 1; fi; }
unset TOKENHUB_SERVICE_NAME TOKENHUB_SERVICE_USER TOKENHUB_SERVICE_GROUP
resolve_existing_service
[ "$SERVICE_NAME:$SERVICE_USER:$BACKEND_DROPIN" = tokenstation:tokenstation:90-tokenstation-backend.conf ]
printf '[Service]\nUser=legacyuser\nGroup=legacygroup\n' >"$SYSTEMD_DIR/tokenhub.service"
mkdir -p "$SYSTEMD_DIR/tokenhub.service.d"
printf '[Service]\nExecStart=old\n' >"$SYSTEMD_DIR/tokenhub.service.d/90-tokenhub-backend.conf"
SERVICE_NAME=tokenhub
marker_content "$INSTALL_ROOT" application >"$INSTALL_ROOT/$MANAGED_DIRECTORY_MARKER"
SERVICE_NAME=tokenstation
resolve_existing_service
[ "$SERVICE_NAME:$SERVICE_USER:$SERVICE_GROUP:$BACKEND_DROPIN" = tokenhub:legacyuser:legacygroup:90-tokenhub-backend.conf ]
require_marker "$INSTALL_ROOT" application
TOKENHUB_SERVICE_NAME=tokenstation reject resolve_existing_service
TOKENHUB_SERVICE_USER=wrong reject resolve_existing_service
printf '' >"$SYSTEMD_DIR/tokenstation.service"
reject resolve_existing_service
rm "$SYSTEMD_DIR/tokenstation.service"
printf '' >"$SYSTEMD_DIR/tokenhub.service.d/90-tokenstation-backend.conf"
reject resolve_existing_service
rm "$SYSTEMD_DIR/tokenhub.service.d/90-tokenstation-backend.conf"
SERVICE_NAME=tokenstation
marker_content "$CONFIG_DIR" configuration >"$CONFIG_DIR/$MANAGED_DIRECTORY_MARKER"
reject resolve_existing_service
rm "$CONFIG_DIR/$MANAGED_DIRECTORY_MARKER" "$SYSTEMD_DIR/tokenhub.service"
printf 'legacyuser:1234\n' >"$CONFIG_DIR/.service-user-created"
resolve_existing_service
[ "$SERVICE_NAME:$SERVICE_USER" = tokenhub:legacyuser ]
`, "offline-installer-test"], { cwd: root, encoding: "utf8", env: process.env });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const source = read("tokenstation-install-backend.sh");
  assert.match(source, /install -m 0644 .*90-tokenstation-backend\.conf.*service\.d\/\$BACKEND_DROPIN/);
  assert.match(source, /rm -f -- .*service\.d\/\$BACKEND_DROPIN/);
  assert.match(source, /require_platform\s+resolve_existing_service/);
});

test("security placeholders retain values recognized by backend startup validation", () => {
  const prefix = "change-me-tokenhub-";
  for (const file of ["deploy/docker-compose.yml", "deploy/docker-compose.postgres.yml", "deploy/.env.example"]) {
    const source = read(file);
    for (const suffix of ["admin-token", "admin-password", "secret-key"]) {
      assert.ok(source.includes(`${prefix}${suffix}`), `${file}: ${suffix}`);
    }
  }
  for (const file of ["start.sh", "deploy/docker-compose.yml", "deploy/docker-compose.postgres.yml", "deploy/docker-compose.remote-postgres.yml", "deploy/.env.example", "docs/deployment.md", "docs/zh-CN/deployment.md", "docs/ja/deployment.md"]) {
    assert.ok(!read(file).includes("change-me-" + "tokenstation-"), file);
  }
});
