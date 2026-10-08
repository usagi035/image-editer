# AI-rule.md - AI Coding & Git Workflow Guidelines

## 1. AI Coding Principles
- **壊さない開発**: 既存の動作しているコードを変更する際は、差分を最小限に抑え、破壊的変更を行わない。
- **設定駆動の徹底**: UIの色、フォント、制限サイズ（512px閾値等）のハードコードを禁止し、必ず `config.yaml` から参照する。
- **性能意識**: キャンバスの直接操作（ピクセル処理）では `ctx.fillRect` のループを避け、`ImageData` / `Uint32Array` によるメモリ直接操作を行う。
- **段階的実装**: 1つのプロンプトで複数機能を同時に実装せず、機能単位でコード生成と動作確認を行う。

## 2. Git & Version Management Rules

### 2.1 ブランチ戦略 (GitHub Flow)
- `main`: 常に動作可能な安定版（本番/リリース用）
- `feature/<機能名>`: 機能追加・開発用ブランチ（例: `feature/bucket-tool`, `feature/yaml-loader`）
- `fix/<バグ内容>`: バグ修正用ブランチ

### 2.2 バージョン命名規則 (Semantic Versioning)
`v<MAJOR>.<MINOR>.<PATCH>`
- **MAJOR**: 全体構造の再構築、メジャーリリース
- **MINOR**: 新機能の追加（特殊バケツ追加、Electron化など）
- **PATCH**: バグ修正、微細なUI修正

### 2.3 コミット規約 (Conventional Commits)
コミットメッセージは以下のプレフィックスを必須とします。
- `feat:` 新機能追加
- `fix:` バグ修正
- `refactor:` リファクタリング（機能変更を伴わないコード改善）
- `style:` フォーマット・デザイン調整（ロジック変更なし）
- `docs:` ドキュメント（`*.md`等）の更新
- `config:` `config.yaml` や設定関連の変更

**例**: `feat(bucket): 全域色置換(Global Fill)モードの実装`

### 2.4 Commit & Push ルール
- **AIによる自動コミット**: 1つのタスク（例: バケツツールのアルゴリズム作成）が正常にビルド・完了した時点でコミットを作成する。
- **Pushタイミング**: 機能単位（`feature/*`）の作業が完了し、`npm run build` が通ることを確認してからリモートへPushする。
- **PR・マージ**: `main` ブランチへのマージはビルドエラーおよび主要機能の動作テストを通過した後に実施する。