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
| `frontend/` | 当前默认技术栈使用的原有 Next.js 管理控制台 |
| `data/model-catalog.yaml` | 纳入版本控制的模型目录 |
| `deploy/` | 容器与原生部署配置 |
| `sdk/` | API 集成冒烟测试 |
| `docs/` | 产品、管理、开发与部署指南 |

## 本地开发

使用 `.nvmrc` 中的 Node 版本及后端声明的 Go 工具链。在本地配置密钥，切勿提交真实凭证或运行时数据库。

### 启动后端与原有控制台

在仓库根目录执行：

```bash
./start.sh
```

默认地址：

- 原有管理控制台：`http://localhost:3000`
- 后端 API：`http://localhost:8080`
- 健康检查：`http://localhost:8080/healthz`

此脚本启动的是 `frontend/`，**并非** MaaS 控制台。

### 启动 MaaS 控制台

后端启动后，打开另一个终端：

```bash
cd maas-ui
npm ci
NEXT_PUBLIC_TOKENHUB_API_BASE_URL=http://localhost:8080 npm run dev -- --port 3001
```

配置后端 CORS 以允许控制台来源。同一个入口支持账号密码登录、配置好的单点登录和邮箱注册。

现有 `TOKENHUB_*` 和 `NEXT_PUBLIC_TOKENHUB_*` 环境变量名仍是兼容性契约；请使用环境模板中的名称，不要为了匹配产品品牌而重命名。

## 部署

### MaaS 静态控制台

在 `maas-ui/` 下构建，将示例 API 地址替换为你的后端 URL：

```bash
NEXT_PUBLIC_TOKENHUB_API_BASE_URL=https://api.example.com npm run build
```

每个部署环境只需构建并发布一份 `out/`。API 地址和可选的站点路径前缀在构建时固定。为部署后的来源配置 HTTPS、静态路由和后端 CORS。参见 [MaaS 静态部署指南](maas-ui/docs/static-DEPLOY.md)。

### 现有托管技术栈

当前原生部署与 Docker 部署路径打包的是原有控制台，MaaS 控制台按上面的静态方式发布。使用现有 Docker 技术栈时，在仓库根目录执行：

```bash
cp deploy/.env.example deploy/.env
# Configure the image/version and replace all change-me secrets before starting.
./deploy/install.sh
```

部署前请核实镜像与发布来源：现有默认值可能仍指向上游分发渠道，而不是单独发布的 TokenStation MaaS 版本。不要假定这些默认版本包含当前分支的变更。

SQLite 适合单实例安装。PostgreSQL 支持多实例部署的共享持久化；副本协调与连接池必须显式配置。请遵循[部署指南](docs/zh-CN/deployment.md)和 [PostgreSQL 指南](docs/zh-CN/postgresql-setup.md)。

升级现有数据库前，请先备份，并对照目标版本核验迁移历史。如果数据库已应用来自不同开发分支的冲突迁移，升级前必须先协调迁移历史；不要绕过校验和检查或覆盖迁移记录。

## 文档

- [文档首页](docs/zh-CN/README.md)
- [用户指南](docs/zh-CN/user-guide.md)
- [团队负责人指南](docs/zh-CN/team-leader-guide.md)
- [管理员指南](docs/zh-CN/administrator-guide.md)
- [架构](docs/zh-CN/architecture.md)
- [计费与定价](docs/zh-CN/billing-pricing.md)
- [MaaS 静态部署](maas-ui/docs/static-DEPLOY.md)
- [开发与贡献指南](CONTRIBUTING.zh-CN.md)

## 许可证

本仓库包含衍生自 [TokenHub](https://github.com/astaxie/TokenHub) 的工作。再分发时，请保留适用的上游版权与署名声明。

TokenStation 采用 [Apache License 2.0](LICENSE) 协议分发。
