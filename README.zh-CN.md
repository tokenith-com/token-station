<p align="center">
  <img src="maas-ui/public/brand/tokenstation-readme-logo.png" alt="TokenStation" width="96" />
</p>

<h1 align="center">TokenStation</h1>

<p align="center">
  面向企业团队与个人开发者的模型即服务平台。<br />
  统一模型接入、API 密钥、用量计费与企业 Token 治理。
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文 | <a href="README.ja.md">日本語</a>
</p>

## 产品概览

TokenStation 将模型发现、Playground、API 接入和成本可视化整合到同一平台。企业团队可以通过项目和共享钱包分配模型访问权限，个人开发者则可以管理个人密钥、充值余额并查看消费记录。平台运营人员集中管理上游服务商、路由、权限、计费和审计，无需向用户分发服务商凭证。

产品由 Go API 后端与 MaaS 控制台组成。平台管理员、团队用户和个人开发者共用一个登录入口。

仓库同时保留了原有管理控制台。它与 MaaS 控制台共用后端，但前端构建和部署路径不同。

## 用户角色

| 角色 | 主要工作流 |
| --- | --- |
| 平台管理员 | 配置服务商、模型、路由、身份源、访问策略、钱包和平台运营 |
| 团队负责人 | 管理团队项目、成员、API 密钥、用量报表，并查看共享钱包 |
| 团队成员 | 发现可用模型、使用 Playground、管理权限范围内的密钥，并查看个人用量 |
| 个人开发者 | 注册登录、创建个人密钥、调用模型、充值并查看费用明细 |

菜单与 API 授权遵循用户角色和资源范围。

## 核心能力

### 模型服务

- 发现可用模型，查看模型能力与价格。
- 使用已授权的 API 密钥在 Playground 中试用模型，查看对话历史与用量反馈。
- 通过 OpenAI 兼容和 Anthropic 兼容 API 集成应用。
- 通过服务商适配器接入托管服务商、本地模型、订阅渠道与自定义上游。
- 集中配置模型路由、优先级、权重、故障切换与健康诊断。

### 企业治理

- 按团队、项目、成员和项目级 API 密钥组织访问权限。
- 应用模型权限、配额、速率限制与并发控制。
- 将消费归因到用户、项目、团队、模型和成本中心。
- 查看请求日志、用量分析、服务商成本与对账工作流。
- 配置企业 OAuth/OIDC 登录、基于角色的访问控制和审计记录。

### 钱包与计费

- **团队钱包：** 共享人民币余额、管理员登记入账、用量结算与钱包账本。团队负责人可以查看所属团队的余额和交易，但不能自行入账。
- **个人在线支付：** 通过已配置的微信支付和支付宝集成创建充值订单，支持支付回调、个人钱包记录、退款与对账。
- **账户余额充值：** 个人门户同时保留独立的 consumer 充值流程。其账本与在线支付钱包相互独立，余额不会自动合并或转移。
- 调用归属团队计费且已配置团队钱包时，优先使用团队钱包而非个人预付费钱包，不会重复扣费。

收款需要运营方完成配置并提供支付服务商凭证，不会因启动控制台而自动启用。团队计费同样需要有效的定价与汇率配置。参见[管理员指南](docs/zh-CN/administrator-guide.md)和[计费指南](docs/zh-CN/billing-pricing.md)。

## 模型 API

| API 类别 | 端点 |
| --- | --- |
| 对话与响应 | `/v1/chat/completions`、`/v1/responses` |
| Anthropic Messages | `/v1/messages`、`/v1/messages/count_tokens` |
| 检索 | `/v1/embeddings`、`/v1/rerank` |
| 图像 | `/v1/images/generations`、`/v1/images/edits` |

可用性取决于所配置的模型、上游服务商与用户权限。图像工作流支持异步任务与服务端留存。各服务商的协议支持情况见[文档](docs/zh-CN/README.md)。

## 仓库结构

| 目录 | 用途 |
| --- | --- |
| `backend/` | Go API、认证、路由、持久化、计费与支付服务 |
| `maas-ui/` | MaaS 企业与个人门户；Next.js 静态导出 |
| `frontend/` | 上游 Next.js 管理控制台 |
| `data/model-catalog.yaml` | 纳入版本控制的模型目录 |
| `deploy/` | 容器与原生部署配置 |
| `sdk/` | API 集成冒烟测试 |
| `docs/` | 产品、管理、开发与部署指南 |

## 本地开发

使用 `.nvmrc` 中的 Node 版本及后端声明的 Go 工具链。在本地配置密钥，切勿提交真实凭证或运行时数据库。

### 启动后端和 MaaS 控制台

在仓库根目录执行：

```bash
./start.sh
```

默认地址：

- MaaS 控制台 — `http://localhost:5199`
- 后端 API：`http://localhost:8080`
- 健康检查：`http://localhost:8080/healthz`

## 配置与部署

### Linux 首次安装

从 [Releases](https://github.com/tokenith-com/token-station/releases) 下载对应架构的 `tokenstation_*.tar.gz` 和 `checksums.txt`。以下以 amd64 为例，在新目录安装独立服务。

```bash
archive=tokenstation_0.11.0-maas.1_linux_amd64.tar.gz
awk -v f="$archive" '$2 == f {print}' checksums.txt | sha256sum -c - &&
  sudo install -d /opt/tokenstation-maas &&
  sudo tar -xzf "$archive" -C /opt/tokenstation-maas
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin tokenstation-maas
sudo install -d -m 0750 -o tokenstation-maas -g tokenstation-maas /var/lib/tokenstation-maas
```

在服务器上新建 `/etc/tokenstation-maas.env`，权限设为 `0600`。示例使用 SQLite；PostgreSQL 使用 `postgres://用户:密码@主机:5432/数据库?sslmode=verify-full`。 把示例域名换成实际地址。用 `openssl rand -hex 32` 分别生成加密密钥和管理员初始密码；升级时保留原加密密钥。

```dotenv
TOKENHUB_ENV=prod
TOKENHUB_HTTP_ADDR=127.0.0.1:18080
TOKENHUB_FRONTEND_HOST=127.0.0.1
TOKENHUB_FRONTEND_PORT=13000
TOKENHUB_PUBLIC_BASE_URL=https://maas.example.com/maas-api
TOKENHUB_DATABASE_URL=sqlite:///var/lib/tokenstation-maas/maas.db
TOKENHUB_SECRET_KEY=<encryption-key>
TOKENHUB_BOOTSTRAP_ADMIN_PASSWORD=<initial-password>
TOKENHUB_INSTALL_ROOT=/var/lib/tokenstation-maas
TOKENHUB_PLUGIN_DIR=/var/lib/tokenstation-maas/plugins
TOKENHUB_MODEL_CATALOG_FILE=/opt/tokenstation-maas/catalog/model-catalog.yaml
TOKENHUB_PROVIDER_CATALOG_FILE=/opt/tokenstation-maas/catalog/provider-catalog.json
```

将以下内容保存为 `/etc/systemd/system/tokenstation-maas.service`。

```ini
[Unit]
Description=TokenStation MaaS
After=network.target

[Service]
User=tokenstation-maas
WorkingDirectory=/var/lib/tokenstation-maas
EnvironmentFile=/etc/tokenstation-maas.env
ExecStart=/opt/tokenstation-maas/bin/tokenstation-run
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

首次安装执行以下命令。升级已有库时先备份、停止使用该库的实例，执行 `db prepare` 时去掉 `--initialize`。

```bash
sudo systemd-run --wait --pipe --collect -p User=tokenstation-maas \
  -p WorkingDirectory=/var/lib/tokenstation-maas -p EnvironmentFile=/etc/tokenstation-maas.env \
  /opt/tokenstation-maas/bin/tokenstation db prepare --initialize
sudo systemctl daemon-reload
sudo systemctl enable --now tokenstation-maas
curl -fsS http://127.0.0.1:18080/readyz
```

在 HTTPS 反向代理中，将 `/` 转发到 `127.0.0.1:13000`，将 `/maas-api/` 去掉前缀后转发到 `127.0.0.1:18080`。

### 可选配置

| 变量 | 用途 |
| --- | --- |
| `TOKENHUB_CORS_ALLOWED_ORIGINS` | 浏览器跨域访问 API 时设置，多个来源用逗号分隔。 |
| `TOKENHUB_PAYMENT_CONFIG_FILE` | 支付配置文件的绝对路径；启用支付时设置，凭据留在服务器。 |
| `NEXT_PUBLIC_TOKENHUB_API_BASE_URL`, `NEXT_PUBLIC_TOKENHUB_BASE_PATH` | 静态前端的 API 地址和站点路径前缀，构建时生效。发布包默认使用同源 `/maas-api`，站点位于根路径。 |

全部变量见 · [backend/.env.example](backend/.env.example) · [maas-ui/.env.example](maas-ui/.env.example)

## 文档

- [文档首页](docs/zh-CN/README.md)
- [用户指南](docs/zh-CN/user-guide.md)
- [团队负责人指南](docs/zh-CN/team-leader-guide.md)
- [管理员指南](docs/zh-CN/administrator-guide.md)
- [架构](docs/zh-CN/architecture.md)
- [计费与定价](docs/zh-CN/billing-pricing.md)
- [MaaS 静态部署](maas-ui/docs/static-deploy.md)
- [开发与贡献指南](CONTRIBUTING.zh-CN.md)

## 许可证

本仓库包含衍生自 [TokenHub](https://github.com/astaxie/TokenHub) 的工作。再分发时，请保留适用的上游版权与署名声明。

TokenStation 采用 [Apache License 2.0](LICENSE) 协议分发。
