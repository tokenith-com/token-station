# TokenStation 手工发布与服务器运维手册

本手册是独立的中文操作交付物。发布入口只在构建机检查与打包，不连接服务器、不上传、不执行安装。服务器操作由运维人员逐项审核并手动执行；本文命令不是自动发布流水线。示例版本统一为 **0.9.2**，每次发布应选择未使用的新版本，并同步替换所有目录名、文件名和 `--version` 参数。

相关文件：[本地发布入口](tokenstation-release.sh)、[完整构建器](tokenstation-build-full-linux-amd64.sh)、[离线安装器](tokenstation-install-backend.sh)、[启动器](tokenstation-run)、[服务模板](deploy/native/tokenstation.service)。

## 1. 构建机：检查与生成产物

构建机要求 Linux x86_64、Bash、Git、Python 3、sha256sum、Go、Node/npm、Docker/buildx，以及完整构建器所需的 curl、GNU tar 等工具。按仓库规定准备 Go/Node 版本。构建依赖、Docker 基础镜像和 Node 运行时可能需要下载；“本地”指不连接生产服务器，并非离线构建。

在仓库根目录手动执行（本文交付时未执行构建）：

```bash
bash tokenstation-release.sh 0.9.2 --artifact-dir "$HOME/tokenstation-dist/0.9.2"
```

默认执行后端 `go test ./...`、`go vet ./...`，仓库工具测试和四项门禁，前端 lint、typecheck、单元测试，再由完整构建器执行前端 `npm ci` / build 与打包。默认拒绝已跟踪文件的未提交修改；审核后才可显式加 `--allow-dirty`，发布记录会保存 dirty 状态和已跟踪差异的 SHA-256。该哈希不涵盖未跟踪文件，也不是完整源码归档，必须另外审核未跟踪输入。

只有明确接受风险时才加 `--skip-checks`；记录会标为跳过，构建本身仍然执行。默认检查不等于完整 CI：不含 golangci-lint、浏览器端到端测试、真实服务器验证、数据库恢复演练或外部依赖验证，应按风险另行完成。产物目录必须是仓库外的全新绝对路径，不能复用已有目录。旧式 `VERSION user@host`、`--yes` 均被拒绝。

### 产物清单

| 文件 | 用途 |
| --- | --- |
| `tokenstation_0.9.2_linux_amd64.tar.gz` | 完整 Linux amd64 包：后端、内置 Node、前端 standalone、启动器、目录数据、插件、服务模板、VERSION 和 LICENSE |
| `tokenstation_0.9.2_linux_amd64.tar.gz.sha256` | 归档 SHA-256，包含文件名 |
| `tokenstation-install-backend.sh` | 此次产物匹配的离线安装器 |
| `tokenstation-run` | 规范启动器，已与安装器内嵌及归档版本逐字节比较 |
| `tokenstation.service` | 未渲染的服务模板，仅供审阅，不要直接覆盖服务器单元 |
| `release-record` | 版本、commit、dirty、差异哈希、是否跳过检查 |
| `tokenhub_0.9.2_linux_amd64.tar.gz`、对应 `.sha256` | 仅供既有旧更新器使用的完整旧布局兼容包 |
| `checksums.txt` | 主包与旧兼容包的归档校验和 |
| `release-manifest.sha256` | 本次交付文件的 SHA-256 清单 |

人工安装和本文命令统一使用 `tokenstation_*` 主包，不需要安装两份。旧更新器继续选择 `tokenhub_*` 兼容包；两个归档均包含普通文件，不依赖归档内符号链接。主包还包含普通的 `bin/tokenhub-run` 转发入口，以兼容既有 systemd 的旧 ExecStart 路径。

入口完成时打印 `release-manifest.sha256` 自身的 SHA-256。通过独立可信渠道保存该值（例如受控变更单），不要只信任同一上传目录内附带的哈希。SHA-256 可验证完整性，但不是签名，不能证明源码或构建机可信。没有远程辅助脚本随包交付。

## 2. 人工上传

在服务器准备独立暂存目录 `/data/tokenstation/release-0.9.2`。可使用图形化 SFTP/文件管理器上传整个产物目录的内容。也可以由操作员自行在构建机运行以下可选命令；发布入口绝不会代为执行：

```bash
scp -o StrictHostKeyChecking=yes "$HOME/tokenstation-dist/0.9.2/"* user@server:/data/tokenstation/release-0.9.2/
```

先核对服务器主机密钥，不要关闭校验。上传完成后，在进入下节 root 操作前，由管理员将暂存目录及所有文件移交 root，移除普通用户写权限；其父目录也不能允许不受信任用户替换该目录。确认其中仅有预期普通文件，不含链接。不要一边上传一边安装。安装窗口内冻结这份已验证产物，避免校验后被修改。

## 3. 服务器预检（尚不停服）

以下示例用于已有的 Linux x86_64 / systemd 安装：

- 应用：`/opt/tokenhub`，活动指针：`/opt/tokenhub/current`。
- 配置：`/etc/tokenhub/tokenhub.env`；服务：`tokenstation.service`。
- 默认状态：`/var/lib/tokenhub`，默认 SQLite：`/var/lib/tokenhub/tokenhub.db`。
- 单元：`/etc/systemd/system/tokenstation.service`，覆盖目录：`/etc/systemd/system/tokenstation.service.d`。

新安装默认服务名为 `tokenstation.service`。使用 `deploy/native/install.sh` 升级既有安装时会识别并沿用旧 `tokenhub.service`。本文示例的 `systemctl`、`journalctl`、单元和 drop-in 路径均按新默认名书写；实际服务仍为旧名时，必须将这些位置统一替换为 `tokenhub`，并为本文离线安装器显式传入 `TOKENHUB_SERVICE_NAME=tokenhub TOKENHUB_SERVICE_USER=tokenhub`（若原服务用户不同则使用原值），不要创建第二个服务。不要修改现有数据库路径、配置目录或服务账号归属。

**安装器本身支持自定义安装、配置、状态、服务名称及单元目录**，详见其 `--help`。本手册默认路径不是额外的安装限制。若实际部署不同，先修改本文全部验证、备份、停止、安装、健康检查与回退路径，并在校验和升级时一致传递相应 `TOKENHUB_*` 环境变量；不能只改安装命令而沿用默认备份。

在受控终端用 `sudoedit /etc/tokenhub/tokenhub.env` 查看实际配置，不要 `source` 环境文件，不要把秘密、数据库连接串、完整配置或可能含秘密的日志粘贴到工单。核对实际监听端口、数据库、图片、插件、文件挂载、目录数据和独立前端服务。检查有效 systemd 单元及 drop-in，确认没有后置 `ExecStart` 覆盖或独立进程与新服务冲突；审阅时注意自定义单元可能含秘密。安装器保留其他 drop-in，但会重写主单元及自己的 `90-tokenstation-backend.conf`，自定义设置必须人工评估。

默认状态目录的备份不覆盖外部数据库、其他 SQLite 路径、目录外图片/插件、符号链接目标或外部挂载的完整恢复需求。**外部存储必须另做一致性备份并验证恢复**。停止所有写入者（含独立服务、定时任务、其他实例），确认剩余磁盘空间，安排维护窗口，禁止并发部署。备份包含秘密，只能 root 访问，不应放在公开下载目录。

先手动验证可信清单和归档，再验证 shell 语法与安装器完整预检；以下过程不停止服务。将占位值换成构建机独立保存的 64 位清单哈希：

```bash
cd /data/tokenstation/release-0.9.2
EXPECTED_MANIFEST_SHA256='REPLACE_WITH_TRUSTED_64_HEX_DIGEST'
printf '%s  release-manifest.sha256\n' "$EXPECTED_MANIFEST_SHA256" | sha256sum -c - &&
  sha256sum -c release-manifest.sha256 &&
  sha256sum -c tokenstation_0.9.2_linux_amd64.tar.gz.sha256 &&
  bash -n tokenstation-install-backend.sh &&
  sudo bash /data/tokenstation/release-0.9.2/tokenstation-install-backend.sh upgrade \
    --version 0.9.2 \
    --archive /data/tokenstation/release-0.9.2/tokenstation_0.9.2_linux_amd64.tar.gz \
    --sha256-file /data/tokenstation/release-0.9.2/tokenstation_0.9.2_linux_amd64.tar.gz.sha256 \
    --validate-only
```

任何一步失败都应停止操作，不要停服。`--validate-only` 会临时解包校验并清理暂存文件，不安装、不改 current、不启动或停止服务；也不能保证后续启动或数据迁移成功。新装应另行规划并将子命令改为 `install`，不要将下面依赖已有配置与 current 的升级块直接用于新装。

## 4. root 备份后手工升级

下面使用**一个** root Bash 块：严格失败退出、私有 umask、时间戳加 mktemp 创建 root-only 备份目录，先备份配置、单元和 current 路径，停止服务并确认停止，再复制整个状态目录（含 SQLite WAL/SHM、图片及目录内其他状态），最后执行本次上传的匹配安装器。不能提前覆盖服务器上旧安装器。前节所有审阅与外部备份必须已完成，替换可信哈希后才运行。

```bash
sudo bash <<'ROOT'
set -Eeuo pipefail
umask 077
STAGE=/data/tokenstation/release-0.9.2
EXPECTED_MANIFEST_SHA256='REPLACE_WITH_TRUSTED_64_HEX_DIGEST'
BACKUP=''
PHASE=preflight
finish() {
  result=$?
  trap - EXIT
  printf 'Operation exit=%s phase=%s backup=%s\n' "$result" "$PHASE" "${BACKUP:-not-created}"
  if [[ -n "$BACKUP" ]]; then
    printf 'exit=%s\nphase=%s\n' "$result" "$PHASE" >"$BACKUP/operation-status"
  fi
  if ((result != 0)); then
    printf 'Manual inspection required; service may be stopped or new release selected. No automatic rollback or restart.\n' >&2
  fi
  exit "$result"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$STAGE"
[[ "$EXPECTED_MANIFEST_SHA256" =~ ^[0-9a-fA-F]{64}$ ]]
printf '%s  release-manifest.sha256\n' "$EXPECTED_MANIFEST_SHA256" | sha256sum -c -
sha256sum -c release-manifest.sha256
sha256sum -c tokenstation_0.9.2_linux_amd64.tar.gz.sha256
bash -n "$STAGE/tokenstation-install-backend.sh"
bash "$STAGE/tokenstation-install-backend.sh" upgrade --version 0.9.2 \
  --archive "$STAGE/tokenstation_0.9.2_linux_amd64.tar.gz" \
  --sha256-file "$STAGE/tokenstation_0.9.2_linux_amd64.tar.gz.sha256" --validate-only
[[ -L /opt/tokenhub/current ]]
OLD_RELEASE="$(readlink -f /opt/tokenhub/current)"
[[ "$OLD_RELEASE" == /opt/tokenhub/releases/* && -f "$OLD_RELEASE/VERSION" ]]
[[ -d /etc/tokenhub && -f /etc/systemd/system/tokenstation.service && -d /var/lib/tokenhub ]]
[[ ! -L /var/backups/tokenstation-release ]]
install -d -o root -g root -m 0700 /var/backups/tokenstation-release
BACKUP="$(mktemp -d "/var/backups/tokenstation-release/0.9.2-$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")"
printf '%s\n' "$OLD_RELEASE" >"$BACKUP/old-current-resolved"
readlink /opt/tokenhub/current >"$BACKUP/old-current-link"
cp -a /etc/tokenhub "$BACKUP/config"
cp -a /etc/systemd/system/tokenstation.service "$BACKUP/"
if [[ -d /etc/systemd/system/tokenstation.service.d ]]; then
  cp -a /etc/systemd/system/tokenstation.service.d "$BACKUP/"
fi
cp release-record release-manifest.sha256 "$BACKUP/"
PHASE=stopping
systemctl stop tokenstation
[[ "$(systemctl show tokenstation -p ActiveState --value)" == inactive ]]
PHASE=state-backup
cp -a /var/lib/tokenhub "$BACKUP/state"
chmod -R go-rwx "$BACKUP"
PHASE=upgrading
bash "$STAGE/tokenstation-install-backend.sh" upgrade --version 0.9.2 \
  --archive "$STAGE/tokenstation_0.9.2_linux_amd64.tar.gz" \
  --sha256-file "$STAGE/tokenstation_0.9.2_linux_amd64.tar.gz.sha256"
PHASE=backend-ready
printf 'Upgrade completed; verify application and optional frontend manually. Backup: %s\n' "$BACKUP"
ROOT
```

`cp -a` 保留状态的属主等元数据，备份路径本身 root-only；其中链接仍为链接，不代表备份了外部目标。不要把正在写入的 SQLite 文件直接复制当成可靠快照。停止失败、状态复制失败或安装失败时，块立即退出并显示阶段、备份路径；可能停服，也可能已经切换到新版本，**不会自动重启或回退**。先确认 current、服务状态、备份完整性和日志，再决定恢复措施。中断/断电时状态记录也可能不完整，必须人工检查。

## 5. 验证后端和可选前端

安装器只检查配置的后端端口及 `/healthz`，不验证 Node 或前端。原配置（包括前端开关）保持不变，因此已有 `TOKENHUB_ENABLE_FRONTEND=true` 仍可能启动前端，不能仅凭安装器成功信息判断前端状态。

从配置安全读取 `TOKENHUB_HTTP_ADDR` 的实际端口，在下面替换 8080；IPv6 或非回环绑定也需调整健康检查地址。不要通过 shell 加载整个配置：

```bash
sudo systemctl is-active tokenstation
curl --noproxy '*' -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:8080/healthz
readlink -f /opt/tokenhub/current
```

检查登录、关键 API、数据和反向代理路径。日志使用受控终端 `sudo journalctl -u tokenstation --since '10 minutes ago'` 查看，分享前脱敏。

如需同时启用包内前端，先确认不存在独立 `tokenstation-frontend`、其他 Node 服务或 3000 端口冲突。不要未经评估就停止不相关服务。使用 `sudoedit /etc/tokenhub/tokenhub.env` 添加或修改以下键，每个键只保留一份：

```ini
TOKENHUB_ENABLE_FRONTEND=true
TOKENHUB_FRONTEND_HOST=127.0.0.1
TOKENHUB_FRONTEND_PORT=3000
```

开关仅接受字面值 `true` / `false`，缺省 `false`（仅后端）。如确需对外监听，可将 `TOKENHUB_FRONTEND_HOST=0.0.0.0`，但这会暴露全部 IPv4 网卡，必须先规划防火墙、TLS、反向代理、认证与允许来源；优先保持回环监听。前端与后端端口应不同，并按实际部署校验前端 API 路由和跨域设置。

修改配置后手动 `sudo systemctl restart tokenstation`，**这会同时重启后端并造成短暂中断**。前端启用后两进程由同一启动器管理，任一退出都可能触发整个服务重启。再次检查后端健康，并执行：

```bash
curl --noproxy '*' -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:3000/ >/dev/null
```

按实际端口及监听地址替换，另从实际用户入口验证静态资源和登录。首页 HTTP 成功不等于完整业务验收。

## 6. 失败处置、版本唯一性与手工回退

安装器拒绝相同版本、已存在的 release 目录和覆盖已有版本，即使 `rollback` 也不复用留存目录。预检失败应修复原因后重新评估；若失败后 `/opt/tokenhub/releases/0.9.2` 已存在，先确认 current 是否指向它、服务和进程是否仍使用它。**不要删除活动版本目录或用 `rm` 绕过保护**。优先以新的版本号重新构建并重新验证，或由运维人员审阅后制定独立恢复方案。保留失败产物与状态记录用于调查。

回退不是自动操作。新版本可能迁移数据库或改变状态格式；只有确认旧代码可读取当前数据库、文件与配置时，才考虑切回保留的旧目录。否则先停止所有写入者，按经过验证的灾难恢复方案恢复匹配的数据库和文件快照，明确接受恢复点之后的数据损失。不要仅切代码指针来“回退数据库”。

对于仍保留的旧版本，安装器 `rollback` 子命令不适合直接复用目录；下列是独立的人工指针切换示例，只能在兼容性及备份审阅完成后执行。把 `BACKUP` 改为第 4 节实际路径：

```bash
sudo bash <<'ROOT'
set -Eeuo pipefail
umask 077
BACKUP=/var/backups/tokenstation-release/REPLACE_WITH_ACTUAL_BACKUP_DIRECTORY
IFS= read -r OLD <"$BACKUP/old-current-resolved"
[[ -L /opt/tokenhub/current ]]
CURRENT="$(readlink -f /opt/tokenhub/current)"
[[ "$CURRENT" == /opt/tokenhub/releases/* && -f "$CURRENT/VERSION" ]]
[[ "$OLD" == /opt/tokenhub/releases/* && "$OLD" != "$CURRENT" ]]
[[ -d "$OLD" && ! -L "$OLD" && -f "$OLD/VERSION" && -x "$OLD/bin/tokenstation-run" ]]
[[ "$(readlink -f -- "$OLD")" == "$OLD" ]]
# Review both version files and database compatibility before proceeding.
REVIEW="$(mktemp -d /var/backups/tokenstation-release/rollback-review.XXXXXXXX)"
cp -a /etc/tokenhub "$REVIEW/config-current"
cp -a /etc/systemd/system/tokenstation.service "$REVIEW/"
if [[ -d /etc/systemd/system/tokenstation.service.d ]]; then
  cp -a /etc/systemd/system/tokenstation.service.d "$REVIEW/"
fi
printf '%s\n' "$CURRENT" >"$REVIEW/current-before-rollback"
systemctl stop tokenstation
[[ "$(systemctl show tokenstation -p ActiveState --value)" == inactive ]]
cp -a /var/lib/tokenhub "$REVIEW/state-before-rollback"
chmod -R go-rwx "$REVIEW"
LINK_DIR="$(mktemp -d /opt/tokenhub/.rollback-link.XXXXXXXX)"
ln -s -- "$OLD" "$LINK_DIR/current"
mv -Tf -- "$LINK_DIR/current" /opt/tokenhub/current
rmdir "$LINK_DIR"
systemctl start tokenstation
ROOT
```

切换前人工检查旧版本的 `VERSION` 内容与备份记录一致、来源可信、启动器和文件完整；同文件系统上的 `mv -Tf` 原子替换 current。示例故意不自动恢复旧 env/单元/drop-in：它们可能包含已经轮换的密钥、修复或新路径，必须逐项对比旧备份与当前备份后决定。若确需修改单元，审阅后执行 `systemctl daemon-reload`，再启动和验证。回退块失败同样保持现场，不自动补救；服务可能停止或指针已改变，需人工处置。

## 7. 长期安全与验证边界

- 将已发布版本视为不可变，保留源码 commit、审核过的差异、清单可信哈希、检查结果和升级记录。
- 定期做 root-only 备份、加密异机存储、恢复演练与容量检查，谨慎制定旧版本和备份保留策略，不清理 current 或仍被进程使用的目录。
- 监控后端与前端各自的健康、systemd 重启次数、磁盘、SQLite 备份和证书；无需把密钥或完整配置输出到监控。
- 校验和只能证明字节一致，语法检查只能证明可解析，`--validate-only` 不能证明生产兼容；上线前仍需业务验收、权限审查和数据迁移演练。
- 本次交付只执行本地语法、帮助与静态检查，未进行实际构建、依赖下载、服务器连接、安装、停服、升级或回退；这些操作都须由运维人员在适当环境主动执行。
