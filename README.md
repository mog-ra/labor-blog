# 労務管理ブログ自動更新システム（シンプル版）

## ファイル構成

```
netlify.toml                          # スケジュール設定
package.json                          # 依存パッケージ（4つのみ）
astro.config.mjs                      # Astro設定
netlify/functions/
  scheduledBlogUpdate.js              # ← これ1ファイルだけ
src/content/
  config.js                           # Astroスキーマ
  blog/                               # 自動生成記事の保存先
```

## セットアップ（3ステップ）

### 1. 依存パッケージをインストール

```bash
npm install
```

### 2. Netlify に環境変数を設定

Netlify Dashboard → Site Settings → Environment Variables

| 変数名 | 値 |
|--------|----|
| `GEMINI_API_KEY` | Google AI Studio で取得 |
| `GITHUB_PAT` | GitHub PAT（`contents:write` 権限のみ） |
| `GITHUB_OWNER` | GitHubユーザー名 |
| `GITHUB_REPO` | リポジトリ名 |

### 3. デプロイ

```bash
git add .
git commit -m "feat: 自動更新システム追加"
git push origin main
```

以上で完了です。毎月1日・15日の9:00（JST）に自動実行されます。

## スケジュール変更

`netlify.toml` と `scheduledBlogUpdate.js` 末尾の `config.schedule` を同じ値に変更。

```
0 0 1,15 * *  → 毎月1・15日 JST 9:00（デフォルト）
0 0 1 * *     → 毎月1日のみ
0 0 * * 1     → 毎週月曜 JST 9:00
```

## 手動実行

```bash
curl -X POST https://[your-site].netlify.app/.netlify/functions/scheduledBlogUpdate
```

## トラブルシューティング

| 症状 | 対処 |
|------|------|
| タイムアウト | Netlify無料プランは10秒制限。Gemini呼び出しが遅い場合はモデルを `gemini-2.5-flash` に変更 |
| 429エラー | Geminiレート制限。翌日まで待つ |
| 401/403エラー | `GITHUB_PAT` の期限切れ・権限不足。再発行して環境変数を更新 |
| ニュースが見つからない | `LABOR_KEYWORDS` にキーワードを追加 |
