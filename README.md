<p align="center">
  <img src="maas-ui/public/brand/tokenstation-readme-logo.png" alt="TokenStation" width="96" />
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

TokenStation has a Go API backend and a MaaS console with one sign-in page for platform administrators, team users, and individual developers.

The repository also retains the original admin console. It shares the backend but has a different frontend build and deployment path from the MaaS console.

## Roles

| Role | Main workflows |
| --- | --- |
| Platform administrator | Configure providers, models, routes, identities, access policies, wallets, and platform operations |
| Team manager | Manage team projects, members, API keys, usage reports, and shared wallet visibility |
| Team member | Discover available models, use the Playground, manage permitted keys, and inspect personal usage |
| Individual developer | Register and sign in, create personal keys, call models, recharge, and review cost details |

Menus and API authorization follow the user's role and resource scope.

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
| `frontend/` | Original Next.js admin console |
| `data/model-catalog.yaml` | Tracked model catalog |
| `deploy/` | Container and native deployment configuration |
| `sdk/` | API integration smoke tests |
| `docs/` | Product, administration, development, and deployment guides |

## Local Development

Use the Node version in `.nvmrc` and the Go toolchain declared by the backend. Configure secrets locally; never commit real credentials or runtime databases.

### Start the backend and MaaS console

From the repository root:

```bash
./start.sh
```

Default addresses:

- MaaS console — `http://localhost:5199`
- Backend API: `http://localhost:8080`
- Health check: `http://localhost:8080/healthz`

## Configuration and deployment

TokenStation release packages are built from version tags on the `release` branch.

### First install on Linux

Download the matching `tokenstation_*.tar.gz` and `checksums.txt` from [Releases](https://github.com/tokenith-com/token-station/releases). This amd64 example installs a separate service in a fresh directory.

```bash
archive=tokenstation_0.11.3_linux_amd64.tar.gz
awk -v f="$archive" '$2 == f {print}' checksums.txt | sha256sum -c - &&
  sudo install -d /opt/tokenstation &&
  sudo tar -xzf "$archive" -C /opt/tokenstation
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin tokenstation
sudo install -d -m 0750 -o tokenstation -g tokenstation /var/lib/tokenstation
```

Create `/etc/tokenstation.env` on the server with mode `0600`. The example uses SQLite. For PostgreSQL, use `postgres://user:password@host:5432/database?sslmode=verify-full`. Replace the example domain. Run `openssl rand -hex 32` separately for the encryption key and initial admin password. Keep the encryption key across upgrades.

```dotenv
TOKENHUB_ENV=prod
TOKENHUB_HTTP_ADDR=127.0.0.1:18080
TOKENHUB_FRONTEND_HOST=127.0.0.1
TOKENHUB_FRONTEND_PORT=13000
TOKENHUB_PUBLIC_BASE_URL=https://maas.example.com
TOKENHUB_DATABASE_URL=sqlite:///var/lib/tokenstation/maas.db
TOKENHUB_SECRET_KEY=<encryption-key>
TOKENHUB_BOOTSTRAP_ADMIN_PASSWORD=<initial-password>
TOKENHUB_INSTALL_ROOT=/var/lib/tokenstation
TOKENHUB_PLUGIN_DIR=/var/lib/tokenstation/plugins
TOKENHUB_MODEL_CATALOG_FILE=/opt/tokenstation/catalog/model-catalog.yaml
TOKENHUB_PROVIDER_CATALOG_FILE=/opt/tokenstation/catalog/provider-catalog.json
```

Save this unit as `/etc/systemd/system/tokenstation.service`.

```ini
[Unit]
Description=TokenStation MaaS
After=network.target

[Service]
User=tokenstation
WorkingDirectory=/var/lib/tokenstation
EnvironmentFile=/etc/tokenstation.env
ExecStart=/opt/tokenstation/bin/tokenstation-run
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Run these commands for a fresh install. For an existing database, back it up, stop all instances using it and run `db prepare` without `--initialize`.

```bash
sudo systemd-run --wait --pipe --collect -p User=tokenstation \
  -p WorkingDirectory=/var/lib/tokenstation -p EnvironmentFile=/etc/tokenstation.env \
  /opt/tokenstation/bin/tokenstation db prepare --initialize
sudo systemctl daemon-reload
sudo systemctl enable --now tokenstation.service
curl -fsS http://127.0.0.1:18080/readyz
```

Forward `/api/`, `/v1/`, and `/v1beta/` to `127.0.0.1:18080` with their paths intact. Forward other requests to the frontend at `127.0.0.1:13000`.

### Optional settings

| Variable | Purpose |
| --- | --- |
| `TOKENHUB_CORS_ALLOWED_ORIGINS` | Allowed browser origins for cross-origin API access, separated by commas. |
| `TOKENHUB_PAYMENT_CONFIG_FILE` | Absolute path to the payment configuration. Keep payment credentials on the server. |
| `NEXT_PUBLIC_TOKENHUB_API_BASE_URL`, `NEXT_PUBLIC_TOKENHUB_BASE_PATH` | The release serves the console at the root. Leave the API URL unset to use the same origin, for example `/api/admin/auth/login`. Set the site base path only when hosting the console under a subpath. |

All variables · [backend/.env.example](backend/.env.example) · [maas-ui/.env.example](maas-ui/.env.example)

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
