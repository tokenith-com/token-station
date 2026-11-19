# TokenStation Migration Framework

The TokenStation migration framework provides a repeatable, idempotent workflow for moving competing AI gateways into TokenStation.

## Current Status

The current branch ships a working canonical bundle, a TokenStation sink with both store-backed and remote Admin API-backed execution, a LiteLLM file-based adapter, and a working CLI flow for `extract`, `plan`, `apply`, `verify`, and `rollback`.

## Architecture

See [architecture.md](./architecture.md) for the framework design and extension guide.

## Supported Sources

| Source | Adapter | Supported Versions | Status |
|--------|---------|-------------------|--------|
| LiteLLM | `litellm` | ≥1.52.0, <1.70.0 | Foundation |

See [litellm.md](./litellm.md) for LiteLLM specifics.

## Canonical Bundle

The intermediate representation used between source adapters and the TokenStation sink. See [bundle-schema.md](./bundle-schema.md) for the schema and compatibility policy.

## CLI

```bash
tokenstation-migrate inspect litellm --from proxy_config.yaml
tokenstation-migrate extract litellm --from proxy_config.yaml --out bundle.json
tokenstation-migrate plan --bundle bundle.json
tokenstation-migrate apply --bundle bundle.json
tokenstation-migrate verify --bundle bundle.json
tokenstation-migrate rollback --checkpoint checkpoint.json
```

## Secret Handling

Secrets in the bundle are stored as `{"$secretRef": "ENV_NAME"}` references. The sink resolves them at apply time from environment variables, a file, or an interactive prompt. No plaintext secrets are embedded in the bundle.

## Documentation

- [Architecture](./architecture.md)
- [Bundle Schema](./bundle-schema.md)
- [LiteLLM Adapter](./litellm.md)
- [CLI Reference](./cli.md)
- [E2E Testing](./e2e.md)
