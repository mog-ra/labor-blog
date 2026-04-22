// =============================================================================
// netlify/functions/scheduledBlogUpdate.js
// 労務管理ブログ自動更新システム（シンプル版）
//
// 処理フロー:
//   1. 厚生労働省RSSを取得
//   2. 労務関連キーワードでフィルタリング
//   3. Gemini APIで記事を生成
//   4. GitHubへMarkdownをコミット
// =============================================================================

import RSSParser from 'rss-parser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Octokit } from 'octokit';

// =============================================================================
// 設定
// =============================================================================

const RSS_URL = 'https://www.mhlw.go.jp/stf/news.rdf';

const LABOR_KEYWORDS = [
  '法改正', '改正', '施行', '社会保険', '健康保険', '厚生年金',
  '雇用保険', '労災', '労働基準', '労働時間', '時間外', '残業',
  '36協定', '最低賃金', '育児休業', '介護休業', '有給休暇',
  '助成金', '補助金', '年金', '保険料', '労務管理', 'ハラスメント',
];

const BLOG_DIR = 'src/content/blog';

// =============================================================================
// メイン処理
// =============================================================================

export default async (req) => {
  console.log('[自動更新] 開始:', new Date().toISOString());

  try {
    // ① RSS取得・フィルタリング
    const newsItem = await fetchNews();
    if (!newsItem) {
      console.log('[自動更新] 対象ニュースなし。終了します。');
      return ok('対象ニュースなし。スキップしました。');
    }
    console.log('[自動更新] 選定ニュース:', newsItem.title);

    // ② Gemini で記事生成
    const article = await generateArticle(newsItem);
    if (!article) {
      return error('記事生成に失敗しました。');
    }
    console.log('[自動更新] 記事生成完了:', article.title);

    // ③ GitHub へコミット
    await commitToGitHub(article);
    console.log('[自動更新] コミット完了:', article.slug);

    return ok(`記事「${article.title}」を公開しました。`);

  } catch (e) {
    console.error('[自動更新] エラー:', e.message);
    return error(e.message);
  }
};

export const config = {
  schedule: '0 0 1,15 * *', // 毎月1日・15日 0:00 UTC（= JST 9:00）
};

// =============================================================================
// ① RSS取得・フィルタリング
// =============================================================================

async function fetchNews() {
  const parser = new RSSParser({ timeout: 6000 });
  const feed = await parser.parseURL(RSS_URL);

  // 労務関連キーワードにマッチする最初の1件を返す
  for (const item of feed.items.slice(0, 30)) {
    const text = `${item.title ?? ''} ${item.contentSnippet ?? ''}`;
    const matched = LABOR_KEYWORDS.filter(kw => text.includes(kw));

    if (matched.length > 0) {
      return {
        title:   item.title?.trim() ?? '',
        link:    item.link ?? '',
        summary: (item.contentSnippet ?? '').substring(0, 300),
        pubDate: item.pubDate ?? new Date().toISOString(),
      };
    }
  }

  return null; // マッチなし
}

// =============================================================================
// ② Gemini で記事生成
// =============================================================================

async function generateArticle(newsItem) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite-preview-06-17',
    generationConfig: { temperature: 0.4, maxOutputTokens: 2500 },
    systemInstruction:
      'あなたは社会保険労務士事務所のブログライターです。' +
      '法的正確性と中立性を最優先に、人事担当者が実務で役立つ記事を書いてください。',
  });

  const prompt = `
以下のニュースを基に労務管理ブログ記事をJSON形式のみで返してください。
説明文・コードブロック記号は不要です。

【ニュース】
タイトル: ${newsItem.title}
URL: ${newsItem.link}
概要: ${newsItem.summary}

【出力形式】
{
  "title": "SEOタイトル（60文字以内）",
  "description": "記事概要（120文字以内）",
  "tags": ["タグ1", "タグ2", "タグ3"],
  "body": "## 見出し\\n\\n本文（H2/H3見出し・1200〜1600文字・実務ポイント箇条書き・まとめ・出典URL）"
}

【bodyの末尾に必ず追加】
---
> 本記事は一般的な参考情報です。個別具体的なご相談は社会保険労務士にご連絡ください。
`.trim();

  const result = await model.generateContent(prompt);
  const text   = result.response.text();

  // JSONパース
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    console.error('[記事生成] JSONが見つかりません:', text.substring(0, 200));
    return null;
  }

  const parsed = JSON.parse(match[0]);
  if (!parsed.title || !parsed.body) {
    console.error('[記事生成] 必須フィールド不足');
    return null;
  }

  const pubDate = new Date().toISOString();
  const slug    = generateSlug(parsed.title, pubDate);

  // Astro Content Collections 対応 Markdown を組み立て
  const tags     = (Array.isArray(parsed.tags) ? parsed.tags : ['労務管理']).slice(0, 5);
  const tagsYaml = tags.map(t => `  - "${t}"`).join('\n');

  const markdownContent = `---
title: "${parsed.title.replace(/"/g, '\\"')}"
pubDate: ${pubDate}
description: "${(parsed.description ?? '').replace(/"/g, '\\"')}"
tags:
${tagsYaml}
category: "労務管理"
sourceUrl: "${newsItem.link}"
aiGenerated: true
draft: false
---

${parsed.body}
`;

  return { title: parsed.title, slug, markdownContent };
}

// =============================================================================
// ③ GitHub へコミット
// =============================================================================

async function commitToGitHub(article) {
  const { GITHUB_PAT, GITHUB_OWNER, GITHUB_REPO } = process.env;
  const octokit  = new Octokit({ auth: GITHUB_PAT });
  const filePath = `${BLOG_DIR}/${article.slug}.md`;
  const dateStr  = new Date().toISOString().split('T')[0];

  // 既存ファイルのSHAを取得（更新時に必要）
  let sha;
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filePath,
    });
    sha = data.sha;
  } catch (e) {
    if (e.status !== 404) throw e; // 404以外は再スロー
  }

  await octokit.rest.repos.createOrUpdateFileContents({
    owner:     GITHUB_OWNER,
    repo:      GITHUB_REPO,
    path:      filePath,
    message:   `AI Auto Update: ${article.title} ${dateStr}`,
    content:   Buffer.from(article.markdownContent, 'utf-8').toString('base64'),
    branch:    'main',
    committer: { name: 'Labor Blog Bot', email: 'bot@labor-blog.auto' },
    ...(sha ? { sha } : {}),
  });
}

// =============================================================================
// ユーティリティ
// =============================================================================

function generateSlug(title, isoDate) {
  const date = isoDate.split('T')[0];
  const hash = Math.abs(
    [...title].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
  ).toString(36);
  return `${date}-${hash}`;
}

function ok(message)    { return respond({ status: 'ok',    message }); }
function error(message) { return respond({ status: 'error', message }, 500); }
function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
