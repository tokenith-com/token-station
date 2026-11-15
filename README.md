<p align="center">
  <img src="maas-ui/public/brand/tokenstation-logo.png" alt="TokenStation" width="96" />
</p>

<h1 align="center">TokenStation</h1>

<p align="center">
  A model-as-a-service platform for enterprise teams and individual developers.<br />
  Unified model access, API keys, usage billing, and enterprise Token governance.
</p>

<p align="center">
  English | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja.md">日本語</a>
</p>

## Product Overview

TokenStation brings model discovery, the Playground, API access, and cost visibility into one platform. Enterprise teams can distribute model access through projects and shared wallets, while individual developers can manage personal keys, recharge balances, and review their consumption. Platform operators manage upstream providers, routing, permissions, billing, and audit centrally without distributing provider credentials to users.

The product consists of a Go API backend and a MaaS console with two separately built portals:

- **Enterprise portal (B):** organization and project collaboration, team governance, and platform administration.
- **Individual portal (C):** self-service registration, model access, personal API keys, usage details, and recharge.

The repository also retains the original admin console. It shares the backend but has a different frontend build and deployment path from the MaaS console.

## Portals and Roles

| Role | Portal | Main workflows |
| --- | --- | --- |
| Platform administrator | Enterprise; administrative access to individual portal | Configure providers, models, routes, identities, access policies, wallets, and platform operations |
| Team manager | Enterprise | Manage team projects, members, API keys, usage reports, and shared wallet visibility |
| Team member | Enterprise | Discover available models, use the Playground, manage permitted keys, and inspect personal usage |
| Individual developer | Individual | Register and sign in, create personal keys, call models, recharge, and review cost details |

Menus and API authorization follow the user's role and resource scope. A portal's build configuration does not replace backend access controls.

## Core Capabilities

### Model services

- Discover available models and inspect their capabilities and prices.
- Try models in the Playground using an authorized API key, with conversation history and usage feedback.
- Integrate applications through OpenAI-compatible and Anthropic-compatible APIs.
- Connect hosted providers, local models, subscription channels, and custom upstreams through provider adapters.
- Configure model routing, priorities, weights, failover, and health diagnostics centrally.

### Enterprise governance

- Organize access by team, project, member, and project-scoped API key.
- Apply model permissions, quotas, rate limits, and concurrency controls.
- Attribute consumption to users, projects, teams, models, and cost centers.
- Review request logs, usage analytics, provider costs, and reconciliation workflows.
- Configure enterprise OAuth/OIDC sign-in, role-based access control, and audit records.

### Wallets and billing

- **Team wallets:** shared CNY balances, administrator-recorded credits, usage settlement, and wallet ledgers. Team managers can inspect their team's balance and transactions; they cannot credit wallets themselves.
- **Individual online payments:** recharge orders through configured WeChat Pay and Alipay integrations, payment callbacks, personal wallet records, refunds, and reconciliation.
- **Account-balance recharge:** a separate consumer recharge workflow is also retained in the individual portal. Its ledger and the online-payment wallet are independent; balances are not automatically pooled or transferred.
- A configured team wallet takes precedence over a personal prepaid wallet for calls billed to that team, rather than charging both.

Payment collection requires operator configuration and provider credentials; it is not enabled merely by starting the console. Team billing also requires valid pricing and exchange-rate settings. See the [administrator guide](docs/administrator-guide.md) and [billing guide](docs/billing-pricing.md).

## Model APIs

| API family | Endpoints |
| --- | --- |
| Chat and responses | `/v1/chat/completions`, `/v1/responses` |
| Anthropic Messages | `/v1/messages`, `/v1/messages/count_tokens` |
| Retrieval | `/v1/embeddings`, `/v1/rerank` |
| Images | `/v1/images/generations`, `/v1/images/edits` |

Availability depends on the configured model, upstream provider, and user permissions. Image workflows support asynchronous jobs and server-side retention. Provider-specific protocol support is described in the [documentation](docs/README.md).

## Repository Layout

| Directory | Purpose |
| --- | --- |
| `backend/` | Go API, authentication, routing, persistence, billing, and payment services |
| `maas-ui/` | MaaS enterprise and individual portals; Next.js static export |
| `frontend/` | Original Next.js admin console used by the current default stack |
| `data/model-catalog.yaml` | Tracked model catalog |
| `deploy/` | Container and native deployment configuration |
| `sdk/` | API integration smoke tests |
| `docs/` | Product, administration, development, and deployment guides |

## Local Development

Use the Node version in `.nvmrc` and the Go toolchain declared by the backend. Configure secrets locally; never commit real credentials or runtime databases.

### Start the backend and original console

From the repository root:

```bash
./start.sh
```

Default addresses:

- Original admin console: `http://localhost:3000`
- Backend API: `http://localhost:8080`
- Health check: `http://localhost:8080/healthz`

This script starts `frontend/`, **not** the MaaS console.

### Start the MaaS console

With the backend running, open another terminal:

```bash
cd maas-ui
npm ci
NEXT_PUBLIC_TOKENHUB_API_BASE_URL=http://localhost:8080 npm run dev -- --port 3001
```

The default is the enterprise portal. To run the individual portal, set `NEXT_PUBLIC_TOKENHUB_PORTAL=c` before starting Next.js. Configure backend CORS to allow the console origin.

Existing `TOKENHUB_*` and `NEXT_PUBLIC_TOKENHUB_*` environment names remain compatibility contracts; use the names in the environment templates rather than renaming them to match the product brand.

## Deployment

### MaaS static portals

Build from `maas-ui/`, replacing the example API address with your backend URL:

```bash
# Enterprise portal
NEXT_PUBLIC_TOKENHUB_API_BASE_URL=https://api.example.com npm run build

# Individual portal: build separately and publish its output separately
NEXT_PUBLIC_TOKENHUB_API_BASE_URL=https://api.example.com \
  NEXT_PUBLIC_TOKENHUB_PORTAL=c npm run build
```

Each build produces `out/` and replaces the previous output. Publish the two portal builds to separate hosting locations. API URL and portal selection are fixed at build time. Configure HTTPS, static-route handling, and backend CORS for the deployed origins. See the [MaaS static deployment guide](maas-ui/docs/static-deploy.md).

### Existing managed stack

The current native and Docker deployment paths package the original console, not the MaaS static portals. For the existing Docker stack, from the repository root:

```bash
cp deploy/.env.example deploy/.env
# Configure the image/version and replace all change-me secrets before starting.
./deploy/install.sh
```

Review image and release sources before deployment: existing defaults may still reference upstream distribution channels rather than a separately published TokenStation MaaS release. Do not assume those defaults contain this branch's changes.

SQLite is suitable for a single-instance installation. PostgreSQL supports shared persistence for multi-instance deployments; replica coordination and connection pools must be configured explicitly. Follow the [deployment guide](docs/deployment.md) and [PostgreSQL guide](docs/postgresql-setup.md).

Before upgrading an existing database, back it up and verify its migration history against the target version. Databases that have applied conflicting migrations from divergent development branches require migration-history reconciliation before upgrade; do not bypass checksum checks or overwrite migration records.

## Documentation

- [Documentation home](docs/README.md)
- [User guide](docs/user-guide.md)
- [Team leader guide](docs/team-leader-guide.md)
- [Administrator guide](docs/administrator-guide.md)
- [Architecture](docs/architecture.md)
- [Billing and pricing](docs/billing-pricing.md)
- [MaaS static deployment](maas-ui/docs/static-deploy.md)
- [Development and contribution guide](CONTRIBUTING.md)

## License

This repository includes work derived from [TokenHub](https://github.com/astaxie/TokenHub). Preserve applicable upstream copyright and attribution notices when redistributing it.

TokenStation is distributed under the [Apache License 2.0](LICENSE).
