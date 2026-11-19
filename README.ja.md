<p align="center">
  <img src="maas-ui/public/brand/tokenstation-readme-logo.png" alt="TokenStation" width="96" />
</p>

<h1 align="center">TokenStation</h1>

<p align="center">
  企業チームと個人開発者のための Model-as-a-Service プラットフォーム。<br />
  モデルアクセス、API キー、利用量課金、企業の Token ガバナンスを一元化します。
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | 日本語
</p>

## 製品概要

TokenStation は、モデルの検索、Playground、API アクセス、コストの可視化を 1 つのプラットフォームに統合します。企業チームはプロジェクトと共有ウォレットを通じてモデルアクセスを割り当て、個人開発者は個人キーの管理、残高のチャージ、利用状況の確認を行えます。プラットフォーム運営者は、プロバイダーの認証情報をユーザーへ配布することなく、上流プロバイダー、ルーティング、権限、課金、監査を一元管理できます。

製品は Go API バックエンドと MaaS コンソールで構成されます。プラットフォーム管理者、チームユーザー、個人開発者が同じサインイン画面を使用します。

リポジトリには従来の管理コンソールも残されています。バックエンドは共通ですが、MaaS コンソールとはフロントエンドのビルド方法とデプロイ経路が異なります。

## ユーザーロール

| ロール | 主なワークフロー |
| --- | --- |
| プラットフォーム管理者 | プロバイダー、モデル、ルート、ID、アクセスポリシー、ウォレット、プラットフォーム運用の設定 |
| チーム管理者 | チームのプロジェクト、メンバー、API キー、利用レポートの管理、共有ウォレットの確認 |
| チームメンバー | 利用可能なモデルの検索、Playground の利用、権限内のキーの管理、個人利用状況の確認 |
| 個人開発者 | 登録・サインイン、個人キーの作成、モデルの呼び出し、チャージ、費用明細の確認 |

メニューと API 認可は、ユーザーのロールとリソース範囲に従います。

## 主な機能

### モデルサービス

- 利用可能なモデルを検索し、機能と価格を確認できます。
- 認可済みの API キーで Playground からモデルを試し、会話履歴と利用量のフィードバックを確認できます。
- OpenAI 互換および Anthropic 互換 API を通じてアプリケーションを統合できます。
- プロバイダーアダプターを通じて、ホスト型プロバイダー、ローカルモデル、サブスクリプションチャネル、カスタム上流に接続できます。
- モデルルーティング、優先度、重み、フェイルオーバー、ヘルス診断を一元設定できます。

### 企業ガバナンス

- チーム、プロジェクト、メンバー、プロジェクト単位の API キーごとにアクセスを管理できます。
- モデル権限、クォータ、レート制限、同時実行数の制御を適用できます。
- 利用額をユーザー、プロジェクト、チーム、モデル、コストセンターに紐づけられます。
- リクエストログ、利用分析、プロバイダーコスト、照合ワークフローを確認できます。
- 企業向け OAuth/OIDC サインイン、ロールベースのアクセス制御、監査記録を設定できます。

### ウォレットと課金

- **チームウォレット：** 共有の人民元残高、管理者による入金記録、利用量に基づく精算、ウォレット台帳に対応します。チーム管理者は所属チームの残高と取引を確認できますが、自ら入金を記録することはできません。
- **個人のオンライン決済：** 設定済みの WeChat Pay と Alipay の連携によるチャージ注文、決済コールバック、個人ウォレット記録、返金、照合に対応します。
- **アカウント残高のチャージ：** 個人ポータルには独立した consumer チャージフローも残されています。その台帳とオンライン決済ウォレットは独立しており、残高が自動的に合算・移動されることはありません。
- チームに課金される呼び出しでは、設定済みのチームウォレットが個人のプリペイドウォレットより優先され、両方から課金されることはありません。

決済の受け付けには、運営者による設定と決済プロバイダーの認証情報が必要です。コンソールを起動するだけでは有効になりません。チーム課金にも、有効な価格設定と為替レート設定が必要です。[管理者ガイド](docs/ja/administrator-guide.md)と[課金ガイド](docs/ja/billing-pricing.md)を参照してください。

## モデル API

| API 分類 | エンドポイント |
| --- | --- |
| チャットとレスポンス | `/v1/chat/completions`、`/v1/responses` |
| Anthropic Messages | `/v1/messages`、`/v1/messages/count_tokens` |
| 検索 | `/v1/embeddings`、`/v1/rerank` |
| 画像 | `/v1/images/generations`、`/v1/images/edits` |

利用可否は、設定されたモデル、上流プロバイダー、ユーザー権限によって異なります。画像ワークフローは非同期ジョブとサーバー側の保持に対応しています。プロバイダー別のプロトコル対応については、[ドキュメント](docs/ja/README.md)を参照してください。

## リポジトリ構成

| ディレクトリ | 用途 |
| --- | --- |
| `backend/` | Go API、認証、ルーティング、永続化、課金、決済サービス |
| `maas-ui/` | MaaS の企業・個人ポータル。Next.js 静的エクスポート |
| `frontend/` | 上流の Next.js 管理コンソール |
| `data/model-catalog.yaml` | バージョン管理対象のモデルカタログ |
| `deploy/` | コンテナおよびネイティブデプロイの設定 |
| `sdk/` | API 統合のスモークテスト |
| `docs/` | 製品、管理、開発、デプロイのガイド |

## ローカル開発

`.nvmrc` の Node バージョンと、バックエンドで宣言された Go ツールチェーンを使用してください。シークレットはローカルで設定し、実際の認証情報や実行時データベースをコミットしないでください。

### バックエンドと MaaS コンソールの起動

リポジトリのルートで実行します。

```bash
./start.sh
```

デフォルトのアドレス：

- MaaS コンソール — `http://localhost:5199`
- バックエンド API：`http://localhost:8080`
- ヘルスチェック：`http://localhost:8080/healthz`

## 設定とデプロイ

### Linux への新規インストール

[Releases](https://github.com/tokenith-com/token-station/releases) から対象アーキテクチャの `tokenstation_*.tar.gz` と `checksums.txt` を取得します。以下は amd64 の独立サービスを新しいディレクトリに配置する例です。

```bash
archive=tokenstation_0.11.0-maas.1_linux_amd64.tar.gz
awk -v f="$archive" '$2 == f {print}' checksums.txt | sha256sum -c - &&
  sudo install -d /opt/tokenstation-maas &&
  sudo tar -xzf "$archive" -C /opt/tokenstation-maas
sudo useradd --system --user-group --no-create-home --shell /usr/sbin/nologin tokenstation-maas
sudo install -d -m 0750 -o tokenstation-maas -g tokenstation-maas /var/lib/tokenstation-maas
```

サーバーに `/etc/tokenstation-maas.env` を作成し、権限を `0600` に設定します。例は SQLite 用です。PostgreSQL の場合は `postgres://user:password@host:5432/database?sslmode=verify-full` を指定します。 ドメインを実際の値に置き換えます。暗号鍵と初期管理者パスワードはそれぞれ `openssl rand -hex 32` で生成します。アップグレード時は既存の暗号鍵を引き継ぎます。

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

以下を `/etc/systemd/system/tokenstation-maas.service` に保存します。

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

新規導入では以下を実行します。既存のデータベースではバックアップ後に使用中のインスタンスを停止し、`--initialize` を付けずに `db prepare` を実行します。

```bash
sudo systemd-run --wait --pipe --collect -p User=tokenstation-maas \
  -p WorkingDirectory=/var/lib/tokenstation-maas -p EnvironmentFile=/etc/tokenstation-maas.env \
  /opt/tokenstation-maas/bin/tokenstation db prepare --initialize
sudo systemctl daemon-reload
sudo systemctl enable --now tokenstation-maas
curl -fsS http://127.0.0.1:18080/readyz
```

HTTPS リバースプロキシで `/` を `127.0.0.1:13000` に転送し、`/maas-api/` はプレフィックスを除いて `127.0.0.1:18080` に転送します。

### 任意の設定

| 変数 | 用途 |
| --- | --- |
| `TOKENHUB_CORS_ALLOWED_ORIGINS` | クロスオリジン API アクセスを許可するオリジン。複数指定はカンマ区切り。 |
| `TOKENHUB_PAYMENT_CONFIG_FILE` | 決済設定ファイルの絶対パス。認証情報はサーバー上で管理します。 |
| `NEXT_PUBLIC_TOKENHUB_API_BASE_URL`, `NEXT_PUBLIC_TOKENHUB_BASE_PATH` | ビルド時に埋め込む API URL とサイトのプレフィックス。配布版はルートで公開し、同一オリジンの `/maas-api` に接続します。 |

変数一覧 · [backend/.env.example](backend/.env.example) · [maas-ui/.env.example](maas-ui/.env.example)

## ドキュメント

- [ドキュメントホーム](docs/ja/README.md)
- [ユーザーガイド](docs/ja/user-guide.md)
- [チームリーダーガイド](docs/ja/team-leader-guide.md)
- [管理者ガイド](docs/ja/administrator-guide.md)
- [アーキテクチャ](docs/ja/architecture.md)
- [課金と価格設定](docs/ja/billing-pricing.md)
- [MaaS 静的デプロイ](maas-ui/docs/static-deploy.md)
- [開発・コントリビューションガイド](CONTRIBUTING.ja.md)

## ライセンス

このリポジトリには [TokenHub](https://github.com/astaxie/TokenHub) に由来する成果物が含まれています。再配布する際は、適用される上流の著作権表示と帰属表示を保持してください。

TokenStation は [Apache License 2.0](LICENSE) の下で配布されています。
