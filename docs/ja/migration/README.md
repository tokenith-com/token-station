# TokenStation 移行フレームワーク

TokenStation 移行フレームワークは、競合 AI ゲートウェイを TokenStation に移行するための反復可能で冪等なワークフローを提供します。

## 現在の状態

現在のブランチには、動作する canonical bundle、store-backed と remote Admin API-backed の両方を備えた TokenStation sink、LiteLLM のファイルベースアダプター、および `extract`、`plan`、`apply`、`verify`、`rollback` を実行できる CLI フローが含まれます。

## ドキュメント

- [アーキテクチャ](./architecture.md)
- [Bundle スキーマ](./bundle-schema.md)
- [LiteLLM アダプター](./litellm.md)
- [CLI](./cli.md)
- [E2E](./e2e.md)

詳細な実装と完全なコマンド仕様は英語版 `docs/migration/` を参照してください。
