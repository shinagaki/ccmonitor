# ccmonitor

Claude Code の使用パターンを時系列分析するコマンドラインツール。 Linux の SAR コマンドのように Claude Code セッションを監視します。

> **📢 リポジトリ名変更のお知らせ**: このプロジェクトは以前 `claude-usage-monitor` という名前でしたが、簡潔にするため `ccmonitor` に変更されました。ブックマークやローカルリポジトリの URL を更新してください。
>
> **🚀 npx 対応開始**: v3.0.0 より、 ccmonitor は`npx ccmonitor`でのインストール不要実行に対応！手動ダウンロードや Bun 依存性が不要になりました。 Node.js（npm/npx 経由）と Bun ランタイム両方をサポートします。

## 機能

- 📊 **時間別使用量レポート**: 入力/出力トークンとコストを時間別に追跡
- 🔄 **ローリングウィンドウ監視**: Claude Code サブスクリプションプランの制限をリアルタイム監視（デフォルト：Pro の$10/5 時間）
- 🎯 **正確なコスト計算**: Claude Sonnet 4 、 Opus 4 、 Haiku 3.5 のモデル別料金
- 📈 **進捗の可視化**: 使用量制限に対するカラーコード付きプログレスバー
- ⚡ **自動データ収集**: 最新の Claude Code ログを自動スキャン・処理
- 🔍 **柔軟なフィルタリング**: 時間範囲フィルタリングと tail オプション
- 🎛️ **コンパクト表示**: スクリプトや監視用の `--no-header` オプション

## クイックスタート

### 前提条件

- Node.js16+ がインストール済み
- Claude Code がインストールされ使用済み（`~/.claude/projects/`にログが生成される）
- オプション: 開発用の [Bun ランタイム](https://bun.sh/)（TypeScript 直接実行）

### インストール

#### オプション 1: npx（推奨 - インストール不要）
```bash
# npx で直接実行（最も便利）
npx ccmonitor report
npx ccmonitor rolling

# またはグローバルインストール
npm install -g ccmonitor
ccmonitor report
```

#### オプション 2: ローカルダウンロードと実行（開発用）
```bash
# リポジトリをクローン
git clone https://github.com/shinagaki/ccmonitor.git
cd ccmonitor

# Node.js ユーザー - JavaScript バージョンをビルドして実行
npm run build
./ccmonitor.js report

# Bun 開発用 - TypeScript を直接実行  
chmod +x ccmonitor.ts
./ccmonitor.ts report
```

#### オプション 3: 直接ダウンロード
```bash
# ビルド済み JavaScript バージョンをダウンロード（Node.js 互換）
curl -O https://raw.githubusercontent.com/shinagaki/ccmonitor/main/ccmonitor.js
chmod +x ccmonitor.js
./ccmonitor.js report

# または TypeScript バージョンをダウンロード（Bun 必須）
curl -O https://raw.githubusercontent.com/shinagaki/ccmonitor/main/ccmonitor.ts
chmod +x ccmonitor.ts
./ccmonitor.ts report
```

### 基本的な使用方法

```bash
# npx 使用（インストール不要）
npx ccmonitor report
npx ccmonitor rolling

# ローカルインストール使用
./ccmonitor.js report  # Node.js バージョン（TypeScript からビルド）
./ccmonitor.ts report  # Bun バージョン（TypeScript 直接実行）

# グローバルインストール使用
ccmonitor report
ccmonitor rolling
```

## 使用例

### 時間別レポート

```bash
# 基本的な時間別レポート
npx ccmonitor report        # npx 版
./ccmonitor.js report      # ローカル版

# 直近 24 時間のみ
npx ccmonitor report --tail 24

# 特定の時間範囲
npx ccmonitor report --since "2025-06-20 09:00" --until "2025-06-20 18:00"

# スクリプト用 JSON 出力
npx ccmonitor report --json

# ゼロ使用量を含む全時間表示
npx ccmonitor report --full

# 機能説明ヘッダーなしのコンパクト表示（スクリプト用）
npx ccmonitor report --no-header --tail 5
```

### ローリング使用量監視

```bash
# 使用量制限の監視（5 時間ローリングウィンドウ、デフォルト：$10 Pro 制限）
npx ccmonitor rolling

# 異なるサブスクリプションプラン用のカスタム制限値
npx ccmonitor rolling --cost-limit 50   # Max$100 プラン用
npx ccmonitor rolling --cost-limit 200  # Max$200 プラン用

# レポートにローリングビューを含める
npx ccmonitor report --rolling --cost-limit 50

# 監視用のコンパクトローリング表示
npx ccmonitor rolling --no-header
```

### `watch` コマンドを使ったリアルタイム監視
```bash
# 60 秒ごとにローリング使用量を監視
watch -n 60 'npx ccmonitor rolling --no-header'

# フル時間範囲での継続監視
watch -n 30 'npx ccmonitor rolling --full --no-header'

# 直近の使用パターンを監視
watch -n 120 'npx ccmonitor report --no-header --tail 12'
```

## 出力の理解

### 時間別レポート

```
 ╭─────────────────────────────────────────╮
 │                                         │
 │     ccmonitor - Hourly Usage Report     │
 │                                         │
 ╰─────────────────────────────────────────╯

┌──────────────────┬──────────────┬──────────────┬──────────────┬────────────┐
│ Hour             │        Input │       Output │        Total │ Cost (USD) │
├──────────────────┼──────────────┼──────────────┼──────────────┼────────────┤
│ 2025-06-20 14:00 │        1,234 │        5,678 │        6,912 │      $0.45 │
│ 2025-06-20 15:00 │        2,345 │        6,789 │        9,134 │      $0.67 │
│ 2025-06-20 16:00 │        3,456 │        7,890 │       11,346 │      $0.89 │
└──────────────────┴──────────────┴──────────────┴──────────────┴────────────┘
│ Total            │        7,035 │       20,357 │       27,392 │      $2.01 │
└──────────────────┴──────────────┴──────────────┴──────────────┴────────────┘
```

### ローリング使用量モニター

```
╭───────────────────────────────────────────╮
│                                           │
│    ccmonitor - Limit Monitor (5-Hour)     │
│                                           │
╰───────────────────────────────────────────╯

┌──────────────────┬───────────┬───────────┬───────────────┐
│ Current Hour     │ Hour Cost │5-Hour Cost│ Limit Progress│
├──────────────────┼───────────┼───────────┼───────────────┤
│ 2025-06-20 14:00 │     $0.45 │     $2.34 │  23.0% ██░░░░░░│
│ 2025-06-20 15:00 │     $0.67 │     $3.12 │  31.0% ███░░░░░│
│ 2025-06-20 16:00 │     $1.23 │     $8.45 │  84.0% ███████░│
│ 2025-06-20 17:00 │     $0.89 │     $9.12 │  91.0% ████████│
└──────────────────┴───────────┴───────────┴───────────────┘

📊 Claude CodePro 制限:
   • コスト制限: 5 時間ウィンドウあたり$10.00
   • 時間ウィンドウ: ローリング 5 時間期間
   • 色分け: 緑（安全）| 黄（注意）| 赤（危険）
```

- **緑のバー**: $10 制限の 0-59%（安全）
- **黄色のバー**: 制限の 60-79%（注意）
- **赤のバー**: 制限の 80% 以上（危険）
- **警告**: 80% で ⚠️ HIGH USAGE 、 90% で 🚨 OVER LIMIT

## データソース

ツールが自動処理するデータ：

- **Claude Code ログ**: `~/.claude/projects/*/`の JSONL ファイル
- **集約データ**: `~/.ccmonitor/usage-log.jsonl`に保存
- **重複排除**: メッセージ ID を使用して同じメッセージの重複カウントを防止

## コスト計算

モデル別料金（1K トークンあたり）：
- **Claude Sonnet 4**: 入力$3 、出力$15 、キャッシュ作成$3.75 、キャッシュ読み取り$0.30
- **Claude Opus 4**: 入力$15 、出力$75 、キャッシュ作成$18.75 、キャッシュ読み取り$1.50
- **Claude Haiku 3.5**: 入力$0.80 、出力$4 、キャッシュ作成$1 、キャッシュ読み取り$0.08

モデル検出は Claude Code ログから自動で行われます。

## コマンドリファレンス

### グローバルオプション

- `--help`: ヘルプ情報を表示
- `--version`: バージョン情報を表示

### report コマンド

```bash
npx ccmonitor report [オプション]
# または
./ccmonitor.js report [オプション]
```

**オプション:**

- `--since <日時>`: 開始時刻（例: "2025-06-20 09:00"）
- `--until <日時>`: 終了時刻（例: "2025-06-20 18:00"）
- `--tail <時間数>`: 直近 N 時間のみ表示
- `--rolling`: ローリング使用量ビューを含める
- `--full`: ゼロ使用量を含む全時間表示
- `--cost-limit <金額>`: ローリングビューのカスタム制限値（デフォルト: 10）
- `--json`: JSON 形式で出力

### rolling コマンド

```bash
npx ccmonitor rolling [オプション]
# または
./ccmonitor.js rolling [オプション]
```

**オプション:**

- `--tail <時間数>`: 直近 N 時間のみ表示
- `--full`: ゼロ使用量を含む全時間表示
- `--cost-limit <金額>`: カスタム制限値（デフォルト: 10）
- `--json`: JSON 形式で出力

## 使用量制限

Claude Code サブスクリプションプランには 5 時間ローリングウィンドウあたりの支出制限があります（作者による推測値）。ローリングモニターでこれらの制限を追跡できます：

- **Pro プラン**: $10/5 時間（デフォルト）
- **Max プラン**: `--cost-limit` オプションでカスタム制限を設定可能

モニターの用途：

- ⚠️ **制限到達前の追跡** - 制限に達する前に警告
- 📊 **使用パターンの可視化** - 一日を通じた使用状況
- 🚨 **アラート取得** - 80%（HIGH USAGE）と 90%（OVER LIMIT）でアラート
- ⏰ **使用計画** - ローリングウィンドウを考慮した使用計画

## トラブルシューティング

### よくある問題

**"No Claude Codedata found"**

- Claude Code がインストールされ使用されていることを確認
- `~/.claude/projects/`が存在し JSONL ファイルが含まれていることを確認
- ログファイルの読み取り権限を確認

**"Buncommand not found"**

- Bun をインストール: `curl -fsSL https://bun.sh/install | bash`
- ターミナルを再起動するかシェルプロファイルをリロード

**不正確な使用量データ**

- ツールはメッセージ ID を使用して自動的にエントリを重複排除
- 重複が見つかった場合はバグとして報告してください

**旧バージョンからの移行**

- 以前に`claude-usage-monitor.ts`を使用していた場合は`ccmonitor.ts`にリネーム
- 旧集約データは`~/.claude-usage-monitor/`に保存されていますが、 ccmonitor は`~/.ccmonitor/`を使用
- 移行オプション:
  - **クイック移行**: `mv ~/.claude-usage-monitor ~/.ccmonitor`（集約データを保持）
  - **フレッシュスタート**: 旧ディレクトリを削除して Claude Code ログから再構築
- 移行後は`~/.claude-usage-monitor/`を安全に削除可能（データを移動した場合）
- **注意**: 集約データは使用量要約のみを含み、元の Claude Code ログではないため、再構築は常に可能

### ヘルプの取得

```bash
# 詳細ヘルプを表示
npx ccmonitor --help

# バージョンを確認
npx ccmonitor --version
```

## 技術詳細

### アーキテクチャ

- **単一ファイル**: Node.js/Bun ランタイム対応 TypeScript/JavaScript
- **データ処理**: 重複排除機能付き効率的な JSONL 解析
- **ストレージ**: `~/.ccmonitor/`でのローカル集約
- **表示**: カラーコーディング付きターミナル最適化フォーマット

### パフォーマンス

- 数千のログエントリを効率的に処理
- 自動増分更新（新しいデータのみ処理）
- 最小限のメモリ使用量

## 開発

### Node.js 用ビルド

TypeScript ソースから Node.js 互換バージョンを作成する場合：

```bash
# TypeScript から JavaScript バージョンをビルド
npm run build

# ビルド版をテスト
./ccmonitor.js --version
```

### npm 公開

```bash
# ビルドして公開（公開前に自動ビルド実行）
npm publish

# npm からのインストールをテスト
npm install -g ccmonitor
ccmonitor --version
```

## コントリビューティング

1. リポジトリをフォーク
2. フィーチャーブランチを作成: `git checkout -b feature-name`
3. 変更を加える
4. 自分の Claude Code データで十分にテスト
5. `npm run build`で JavaScript バージョンが動作することを確認
6. プルリクエストを提出

## ライセンス

MIT License - 詳細は[LICENSE](LICENSE) ファイルを参照。

---

**注意**: このツールは非公式で Anthropic とは関連がありません。ローカルに保存された Claude Code ログを分析し、外部にデータを送信することはありません。
