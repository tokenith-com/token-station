# migration

Migration framework for moving competing AI gateways into TokenStation.

## Packages

| Package | Purpose |
|---------|--------|
| `bundle/` | Canonical bundle types, JSON Schema validation, secret references |
| `source/` | Source adapter interface and registry |
| `source/litellm/` | LiteLLM file-based adapter |
| `sink/tokenhub/` | Store-backed and HTTP-backed TokenStation sink |
| `cli/` | Command implementations for `tokenstation-migrate` |

See `docs/migration/` for user-facing documentation.
