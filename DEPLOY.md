# TokenStation MaaS 在阿里云 ECS 上的部署

适用于 `release/maas` 分支。当前 ECS 为 Linux x86_64。MaaS 入口为 `https://tokenstation-test.centlt.com/maas/`。下面是现有服务的升级流程。2026-11-18 已按此流程发布 `d6d30372`，并将 PostgreSQL 从迁移版本 20 升到 25。

**在本地构建前后端，把编译好的产物上传到 ECS。**

| 组件 | ECS 上的配置 |
| --- | --- |
| TokenStation 后端 | `tokenstation.service`，以 `tokenstation:tokenstation` 运行，监听 `127.0.0.1:18080` |
| 后端版本目录 | `/opt/tokenstation/releases/maas-<提交短哈希>`，由 `/opt/tokenstation/current` 指向当前版本 |
| MaaS 前端 | nginx 静态托管，`/maas/` 使用 `/opt/tokenstation/maas/current` 下的 `maas/`，版本存放在 `/opt/tokenstation/maas/releases/<提交短哈希>/maas/` |
| MaaS API | nginx 将 `/maas-api/` 去掉前缀后转发至 `127.0.0.1:18080` |
| 数据库 | `TOKENHUB_DATABASE_URL` 指向 PostgreSQL。ECS 上另有 SQLite 文件，当前服务使用的是 PostgreSQL |
| 其他服务 | `tokenhub.service` 是独立服务，走 `127.0.0.1:8080` |

## 配置放在哪里

### ECS 后端运行变量

`tokenstation.service` 通过 `EnvironmentFile` 读取 `/etc/tokenstation/tokenhub.env`。修改运行变量后，新值在服务下次启动时生效。使用同一环境文件执行数据库维护命令，可以确保它们连接到服务使用的数据库。该文件由 root 持有，权限为 `0600`。

| 变量 | 必填与默认值 | 含义与填写方式 |
| --- | --- | --- |
| **`TOKENHUB_DATABASE_URL`** | **本部署必填**。未设时先尝试用 `TOKENHUB_DB_HOST` 等字段组装 PostgreSQL 连接串，两者都未配置时回退到 SQLite。 | 后端数据库连接串。此 ECS 使用 PostgreSQL，连接串包含主机、端口、库名、账号和 SSL 参数，通常还包含密码。发布或回滚时都应指向同一个目标库，除非明确要切换数据库。 |
| **`TOKENHUB_SECRET_KEY`** | **生产 PostgreSQL 必填**。内置开发默认值不通过生产校验。 | 后端加密根密钥，用于保护已保存的凭据。使用 PostgreSQL 时应配置至少 32 字节的稳定密钥，同一实例组使用同一个值。发布新版本时保留原值，否则已有的加密数据可能无法读取。 |
| `TOKENHUB_ADMIN_TOKEN` | 选填。生产模式下，未设置或使用内置占位值会禁用静态令牌。启用时至少 32 字节。 | 运维脚本调用 Admin API 时可用的静态认证令牌。它与后台登录密码及用户调用模型所用的 API Key 分开管理。 |
| `TOKENHUB_BOOTSTRAP_ADMIN_PASSWORD` | 选填。生产模式下，未设置或使用内置占位值时，初始化会为新建管理员生成随机密码。自行配置时至少 12 字节。 | 初始化数据库时创建 `admin` 账号所用的初始密码。修改环境变量不会重置已有账号密码。 |
| `TOKENHUB_ENV` | 本部署显式填写 `prod`。程序默认 `dev`。 | 运行环境标识，例如 `prod`、`dev` 或 `test`。生产部署使用 `prod`，后端会对密钥等配置执行生产环境校验。 |
| `TOKENHUB_HTTP_ADDR` | 本部署显式填写 `127.0.0.1:18080`，与 nginx 一致。程序默认 `:8080`。 | Go 后端监听的地址和端口。此 ECS 使用 `127.0.0.1:18080`，由同机 nginx 转发公网请求。 |
| `TOKENHUB_PUBLIC_BASE_URL` | 本部署建议显式填写。程序默认空，例如 OpenAPI 在未设置时回退到请求的来源地址。 | 后端生成对外链接时使用的访问地址，例如 OpenAPI 文档中的服务地址。应填写用户可访问的地址。MaaS 页面实际请求的 API 地址由下面的前端构建变量指定。 |
| `TOKENHUB_DEPLOYMENT_TYPE` | 选填。默认使用二进制的编译值，本手册的构建命令已设为 `native`。 | 覆盖二进制内置的部署类型。此 ECS 为 `native`，对应原生二进制和 systemd 部署。 |
| `TOKENHUB_INSTALL_ROOT` | 本部署显式填写 `/opt/tokenstation`。程序默认 `/opt/tokenhub`。 | 后端安装根目录，此 ECS 为 `/opt/tokenstation`。原生 Release 的版本管理使用该目录定位 `current` 和版本文件。 |
| `TOKENHUB_MANAGED_UPDATES` | 选填，默认 `false`。 | 控制容器部署是否启用应用内托管更新和回退。原生部署的托管更新能力不由此开关控制。本手册使用手工切换版本目录的流程。 |
| `TOKENHUB_SEED_DEMO` | 选填，默认 `false`。 | 执行 `db prepare --initialize` 时，是否额外写入演示项目、模型等数据。现有 ECS 数据库升级只执行 `db prepare`，生产环境应保持 `false`。 |
| `TOKENHUB_PLUGIN_DIR` | 选填。原生部署默认使用安装根目录下的 `plugins/`。已上线环境应保留原路径。 | 后端扫描和加载插件包的目录。放在持久化目录，升级时可继续使用现场安装的插件。 |
| `TOKENHUB_IMAGE_STORAGE_DIR` | 选填。默认 `data/images`，工作目录下存在 `backend/data` 时为 `backend/data/images`。 | 后端生成的图片资产存放目录。放在持久化目录，切换 Release 时可保留已有图片。 |
| `TOKENHUB_SQLITE_BACKUP_DIR` | 选填。默认 `data/backups`，工作目录下存在 `backend/data` 时为 `backend/data/backups`。 | 应用内 SQLite 备份的输出目录。此 ECS 使用 PostgreSQL，其备份由 PostgreSQL 的备份机制管理。 |
| `TOKENHUB_MODEL_CATALOG_FILE` | 本部署显式填写发布包里的路径。程序默认在工作目录附近及容器目录查找，找不到时使用 `data/model-catalog.yaml`。 | 标准模型参考元数据的 YAML 文件路径。当前部署指向 `/opt/tokenstation/current/catalog/model-catalog.yaml`。文件中的条目不会自动变成可调用的模型。 |
| `TOKENHUB_PROVIDER_CATALOG_FILE` | 本部署显式填写发布包里的路径。程序默认在工作目录附近及容器目录查找，找不到时使用 `data/provider-catalog.json`。 | 供应商模板和候选上游模型的 JSON 文件路径。当前部署指向 `/opt/tokenstation/current/catalog/provider-catalog.json`。 |
| **`TOKENHUB_PAYMENT_CONFIG_FILE`** | **启用支付时必填**，默认空。 | 支付配置 YAML 的文件路径。当前部署指向 `/etc/tokenstation/payment-test/payment.yaml`。留空会关闭支付功能。 |

数据库连接串、加密根密钥、Admin API Token 和初始管理员密码的实际值应通过 ECS 环境文件提供。

### ECS 环境文件示例

以下内容对应 `/etc/tokenstation/tokenhub.env`。新部署时先替换占位符。升级现有实例时，以 ECS 原文件为准，逐项核对和补齐，保留实际的数据库连接串、加密根密钥和持久化目录。示例中的域名和路径也应与本次部署的 nginx、版本目录和支付配置一致。前端构建变量在构建命令中传入。

```dotenv
# Runtime and paths
TOKENHUB_ENV=prod
TOKENHUB_HTTP_ADDR=127.0.0.1:18080
TOKENHUB_PUBLIC_BASE_URL=https://tokenstation-test.centlt.com
TOKENHUB_DEPLOYMENT_TYPE=native
TOKENHUB_INSTALL_ROOT=/opt/tokenstation
TOKENHUB_MANAGED_UPDATES=false
TOKENHUB_SEED_DEMO=false

# Replace placeholders with the actual database URL and stable encryption key.
TOKENHUB_DATABASE_URL="postgresql://REPLACE_DB_USER:REPLACE_DB_PASSWORD_URL_ENCODED@db.example.invalid:5432/REPLACE_DB_NAME?sslmode=require"
TOKENHUB_SECRET_KEY=REPLACE_WITH_STABLE_SECRET

# Set only when needed, using the existing values when upgrading.
# TOKENHUB_ADMIN_TOKEN=REPLACE_WITH_ADMIN_API_TOKEN
# TOKENHUB_BOOTSTRAP_ADMIN_PASSWORD=REPLACE_WITH_INITIAL_ADMIN_PASSWORD

# Example persistent directories and release catalogs
TOKENHUB_PLUGIN_DIR=/var/lib/tokenstation/plugins
TOKENHUB_IMAGE_STORAGE_DIR=/var/lib/tokenstation/images
TOKENHUB_SQLITE_BACKUP_DIR=/var/lib/tokenstation/backups
TOKENHUB_MODEL_CATALOG_FILE=/opt/tokenstation/current/catalog/model-catalog.yaml
TOKENHUB_PROVIDER_CATALOG_FILE=/opt/tokenstation/current/catalog/provider-catalog.json

# Keep this line only when payment is configured.
TOKENHUB_PAYMENT_CONFIG_FILE=/etc/tokenstation/payment-test/payment.yaml
```

如果 PostgreSQL 用户名或密码含有 `@`、`#`、`/`、`%` 等保留字符，在 URL 里先做百分号编码。文件权限保持 `0600`，由 root 持有。

### 支付 YAML 和仓库配置文件

ECS 上的 `payment.yaml` 中，`prepaid_usage` 控制是否对符合条件的模型调用按实际用量扣减个人钱包，`plans` 定义可选充值套餐及金额（`amount_fen` 的单位是分），`wechat` 和 `alipay` 分别配置微信支付和支付宝的商户信息、凭据文件及回调地址。相对凭据路径以 YAML 所在目录为起点。实际支付配置和密钥文件留在 ECS，仓库中的 `deploy/payment.example.yaml` 用于参考。

仓库中的 `data/model-catalog.yaml` 和 `data/provider-catalog.json` 是随版本发布的目录文件。当前 systemd 服务没有加载通用项目 `config.yaml`。仓库中的 `deploy/litellm-config.yaml` 用于 LiteLLM 迁移测试。

### MaaS 前端构建变量

下面两个变量在 `maas-ui` 执行 `npm run build` 时传入，会写入公开的静态产物。修改后需要重新构建并发布前端。

| 变量 | 必填与默认值 | 含义与 ECS 对应值 |
| --- | --- | --- |
| **`NEXT_PUBLIC_TOKENHUB_BASE_PATH`** | **本部署必填** `/maas`。程序默认空，即部署在站点根路径。 | MaaS 页面和静态资源挂载的 URL 路径前缀。此 ECS 为 `/maas`，对应 nginx 的页面入口。 |
| **`NEXT_PUBLIC_TOKENHUB_API_BASE_URL`** | **本部署必填** MaaS API 地址。仓库的 `maas-ui/.env.production` 预设 `https://hub.centlt.com`，构建此 ECS 的静态包时须覆盖。未提供任何值时程序默认空。 | 浏览器调用后端 API 时使用的基础地址。此 ECS 为 `https://tokenstation-test.centlt.com/maas-api`，nginx 会去掉 `/maas-api` 前缀后把请求转到后端监听地址。 |

## 1. 在本地构建并打包

从已推送的 `release/maas` 提交构建。使用 `.nvmrc` 指定的 Node 版本和本地 Docker Buildx。Go 二进制面向 ECS 的 Linux amd64 架构，使用 CGO 静态链接。前端使用指定的公开变量构建成静态文件，ECS 上不需要 Node。

以下命令在本地 Bash 中执行，第一段从仓库根目录运行：

```bash
set -euo pipefail
git fetch origin release/maas
build_root=$(mktemp -d)
git worktree add --detach "$build_root/source" origin/release/maas
cd "$build_root/source"
git rev-parse HEAD
release_sha=$(git rev-parse --short=8 HEAD)
package="$build_root/package"
mkdir -p "$package/backend/bin" "$package/backend/catalog" "$package/frontend/maas"

docker buildx build --platform linux/amd64 \
  -f backend/Dockerfile.native \
  --build-arg "TOKENHUB_VERSION=$release_sha" \
  --output "type=local,dest=$build_root/native" .
file "$build_root/native/tokenstation"
cp "$build_root/native/tokenstation" "$package/backend/bin/"
cp data/model-catalog.yaml data/provider-catalog.json "$package/backend/catalog/"
printf '%s\n' "$release_sha" > "$package/backend/VERSION"

(
  cd maas-ui
  npm ci
  NEXT_PUBLIC_TOKENHUB_BASE_PATH=/maas \
    NEXT_PUBLIC_TOKENHUB_API_BASE_URL=https://tokenstation-test.centlt.com/maas-api \
    npm run build
  grep -qF '/maas/_next/' out/index.html
  grep -qF 'https://tokenstation-test.centlt.com/maas-api' out/index.html
  cp -R out/. "$package/frontend/maas/"
)

(cd "$package/backend" && shasum -a 256 bin/tokenstation catalog/* VERSION > ARTIFACT_SHA256)
(cd "$package/frontend/maas" && find . -type f -print0 | xargs -0 shasum -a 256 > ../ARTIFACT_SHA256)
archive="$build_root/tokenstation-maas-$release_sha.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$archive" -C "$package" backend frontend
```

## 2. 上传并校验产物

通过现有 SSH 账号和私钥上传压缩包。私钥留在本机。把下列占位符替换为本机相应路径和目标。上传命令与本地构建使用同一个 Bash 会话，以便沿用 `archive`。

```bash
ecs_ssh=admin@ECS_PUBLIC_IP
ecs_key=/path/to/ecs-ssh-key.pem
scp -o StrictHostKeyChecking=yes -i "$ecs_key" "$archive" "$ecs_ssh:/tmp/"
ssh -o StrictHostKeyChecking=yes -i "$ecs_key" "$ecs_ssh"
```

以下开始在 ECS 的 Bash 中执行。先解压到暂存目录，并在安装前后分别校验哈希。此时线上服务继续使用旧版，两个 `current` 链接均待切换。

```bash
set -euo pipefail
release_sha=REPLACE_WITH_SHA
stage=$(mktemp -d)
tar -xzf "/tmp/tokenstation-maas-$release_sha.tar.gz" -C "$stage"
(cd "$stage/backend" && sha256sum -c ARTIFACT_SHA256)
(cd "$stage/frontend/maas" && sha256sum -c --quiet ../ARTIFACT_SHA256)
test "$(cat "$stage/backend/VERSION")" = "$release_sha"

backend_root=/opt/tokenstation
frontend_root=/opt/tokenstation/maas
backend_release="$backend_root/releases/maas-$release_sha"
frontend_release="$frontend_root/releases/$release_sha"
test ! -e "$backend_release"
test ! -e "$frontend_release"
sudo install -d -m 0755 "$backend_release/bin" "$backend_release/catalog" "$frontend_release/maas"
sudo install -m 0755 "$stage/backend/bin/tokenstation" "$backend_release/bin/"
sudo install -m 0644 "$stage/backend/catalog/"* "$backend_release/catalog/"
sudo install -m 0644 "$stage/backend/"{VERSION,ARTIFACT_SHA256} "$backend_release/"
sudo cp -R "$stage/frontend/maas/." "$frontend_release/maas/"
sudo install -m 0644 "$stage/frontend/ARTIFACT_SHA256" "$frontend_release/"
sudo find "$frontend_release/maas" -type d -exec chmod 0755 {} +
sudo find "$frontend_release/maas" -type f -exec chmod 0644 {} +
(cd "$backend_release" && sha256sum -c ARTIFACT_SHA256)
(cd "$frontend_release/maas" && sha256sum -c --quiet ../ARTIFACT_SHA256)
sudo -u tokenstation test -x "$backend_release/bin/tokenstation"
```

## 3. 用 systemd 停机并迁移 PostgreSQL

先记录两个旧链接的目标。维护命令使用已暂存的新二进制，以 `tokenstation` 用户执行，并通过 systemd 加载同一份环境文件。这样数据库连接串和密钥都留在 ECS 配置中。迁移期间使用目标版本的目录文件。

先在旧服务运行时执行 `run_db status`，核对数据库驱动、版本、脏迁移及待执行项目，并确认连接同一 PostgreSQL 库的旧实例。2026-11-18 的发布前为版本 20，待执行迁移为 21–25。后续升级到含角色统一的版本时，目标为版本 26。迁移 26 会将现有 `system_admin` 账号统一为 `admin`，保留账号 ID 和有效会话。此次部署沿用了之前已验证可恢复的 PostgreSQL 备份，正式切换时没有新建备份容器。后续如需新备份，使用 PostgreSQL 已有的备份或快照渠道。

```bash
readlink -f "$backend_root/current"
readlink -f "$frontend_root/current"

run_db() {
  sudo systemd-run --wait --pipe --collect \
    --property=User=tokenstation --property=Group=tokenstation \
    --property=EnvironmentFile=/etc/tokenstation/tokenhub.env \
    --property="WorkingDirectory=$backend_release" \
    /usr/bin/env \
    "TOKENHUB_MODEL_CATALOG_FILE=$backend_release/catalog/model-catalog.yaml" \
    "TOKENHUB_PROVIDER_CATALOG_FILE=$backend_release/catalog/provider-catalog.json" \
    "$backend_release/bin/tokenstation" db "$@"
}
run_db status
```

在维护窗口停止同库旧实例。此 ECS 上的目标是 `tokenstation.service`。确认该服务已停止、同一应用账号的旧连接已退出后，执行下列迁移。已有库使用 `db prepare`。若任一步失败，停止切换并排查。

```bash
sudo systemctl stop tokenstation.service
test "$(systemctl show -p ActiveState --value tokenstation.service)" = inactive
```

用同一应用账号在既有 PostgreSQL 客户端中检查其他连接。此次停机后的结果为 `0`。

```sql
SELECT count(*) AS other_app_connections
FROM pg_stat_activity
WHERE datname = current_database()
  AND usename = current_user
  AND backend_type = 'client backend'
  AND pid <> pg_backend_pid();
```

```bash
run_db prepare
run_db verify
run_db status
```

此次上线前确认了 `db verify` 通过、迁移版本为 **25**、无脏迁移且无待执行扩展迁移，并通过 PostgreSQL 查询确认新表及索引存在。在已有的 PostgreSQL 管理连接里可复核：

```sql
SELECT max(version) AS schema_version,
       count(*) FILTER (WHERE dirty <> 0) AS dirty_migrations,
       count(*) FILTER (WHERE version BETWEEN 21 AND 25) AS applied_21_to_25
FROM schema_migrations;

SELECT to_regclass('public.team_wallet_rate_history_entries') AS new_table,
       to_regclass('public.idx_team_wallet_rate_history_order') AS new_index;
```

迁移 21 创建汇率历史表和索引，22–25 更新已有表。迁移 25 重命名团队钱包金额字段，并把历史金额从分换算成微元。

## 4. 切换版本并验证上线

先切后端链接并启动服务。等本机健康和就绪检查通过，再切前端链接。nginx 沿用现有配置。

```bash
switch_link() {
  local target=$1 link=$2
  sudo ln -s "$target" "$link.next-$release_sha"
  sudo mv -Tf "$link.next-$release_sha" "$link"
}

switch_link "$backend_release" "$backend_root/current"
sudo systemctl start tokenstation.service
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 3 -o /dev/null http://127.0.0.1:18080/readyz; then
    break
  fi
  sleep 1
done
systemctl is-active tokenstation.service
curl -fsS --max-time 5 http://127.0.0.1:18080/healthz
curl -fsS --max-time 5 http://127.0.0.1:18080/readyz
cat "$backend_root/current/VERSION"

switch_link "$frontend_release" "$frontend_root/current"
readlink -f "$frontend_root/current"
```

通过公网域名验证页面和 API。打开首页并确认浏览器能加载 `/maas/_next/static/` 下的资源；验证登录页调用的身份提供方接口返回 JSON。

```bash
site=https://tokenstation-test.centlt.com
curl -fsS --max-time 10 -o /dev/null -w 'MaaS page HTTP %{http_code}\n' "$site/maas/"
curl -fsS --max-time 10 "$site/maas-api/healthz"
curl -fsS --max-time 10 "$site/maas-api/readyz"
curl -fsS --max-time 10 "$site/maas-api/api/admin/auth/identity-providers" | python3 -m json.tool >/dev/null
```

常规 systemd 启动只校验迁移状态。迁移 25 应用后，若要回退到只支持版本 20 的旧后端，需要先按备份恢复方案处理数据库，再切回旧版本目录。恢复发布前备份可能丢失切换后发生的写入，需先评估影响。应用迁移 26 后，回退前也要确认旧二进制能识别迁移 26；仅支持版本 25 的二进制无法通过账本校验。

相关文档：[数据库演进](docs/zh-CN/database-evolution.md)、[通用部署](docs/zh-CN/deployment.md)、[MaaS 静态构建](maas-ui/docs/static-DEPLOY.md)。
