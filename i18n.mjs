/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: English and Japanese UI messages, presets, and locale helpers shared by the browser and server.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

const messages = {
  en: {
    examples: 'Examples', choosePreset: 'Choose a preset', presetOne: 'Preset 1 · Day hike',
    presetTwo: 'Preset 2 · Variables', presetThree: 'Preset 3 · Friendly reminder',
    clear: 'Clear', clearAria: 'Clear all fields and results', language: 'Language',
    languageAria: 'Choose interface language', intro: 'Choose a preset or write your own prompt. The combined prompt updates live as you type or change selections.',
    rawPrompt: 'Raw prompt', alwaysIncluded: 'Always included', rawPlaceholder: 'Enter your raw prompt',
    context: 'Context', contextPlaceholder: 'Add context to include', role: 'Role', rolePlaceholder: 'Add a role or perspective',
    constraints: 'Constraints', constraintsPlaceholder: 'Define constraints or style guidance',
    combinedPrompt: 'Combined prompt', ready: 'Ready to mix', generate: 'Generate Response',
    comparison: 'Response comparison', initialStatus: 'Generate a response to compare the effect of your selected instructions.',
    rawRequired: 'Please enter a raw prompt.', generatingCount: 'Generating {count} responses…',
    generatingCard: 'Generating response {current} of {count}…', partialSummary: '{succeeded} of {count} responses generated; {failed} could not be generated.',
    successSummary: '{count} responses generated.', rawOnly: 'Raw only', rawPlus: 'Raw + {labels}',
    downloadPdf: 'Download response as PDF', pdfError: 'Could not create the PDF. Please try again.',
    exactPrompt: 'Exact prompt', showMore: 'Show more', showLess: 'Show less', response: 'Response',
    waiting: 'Waiting to generate.', generating: 'Generating…', generated: 'Response generated.',
    languageDirective: 'Respond in English. Preserve quoted text and code in their original language when appropriate.',
    pdfTitle: 'Prompt Mixer', pdfExactPrompt: 'Exact submitted prompt', pdfResponse: 'Response',
    rateStopped: 'Not sent because a rate limit was reached.',
    followUp: 'Follow-up', followUpPrompt: 'Follow-up prompt', followUpResponse: 'Follow-up response',
    followUpYes: 'Yes', followUpNo: 'No', followUpLoading: 'Generating follow-up…', followUpGenerated: 'Follow-up generated.',
    followUpRetry: 'Retry', followUpTurn: 'Follow-up {count}',
    errors: {
      unsupported_media_type: 'Send a JSON request.', request_too_large: 'Prompt is too long.',
      invalid_json: 'Invalid JSON.', invalid_prompt: 'Enter a prompt of up to 6,000 characters.',
      ai_not_configured: 'AI is not configured on this server.', rate_site_daily: 'The site has reached its daily AI response limit. Try again tomorrow.',
      rate_ip_daily: 'This connection has reached its daily AI response limit. Try again tomorrow.',
      rate_ip_minute: 'Too many AI requests from this connection. Try again in a minute.',
      rate_limit_unavailable: 'AI responses are temporarily unavailable. Please try again later.',
      upstream_busy: 'AI is busy or usage is limited. Try again later.', upstream_unavailable: 'AI response unavailable. Please try again.',
      empty_response: 'The AI returned no text. Please try again.', not_found: 'Not found.', page_load_failed: 'Could not load the page.',
      invalid_ai_response: 'The AI returned an invalid structured response. Please try again.', invalid_follow_up: 'The follow-up request is invalid or too long.',
        conversation_limit_reached: 'This conversation reached its limit. Start a new prompt to continue.',
      followUp: 'Follow-up', followUpPrompt: 'Follow-up prompt', followUpResponse: 'Follow-up response',
    },
  },
  ja: {
    examples: '例', choosePreset: 'プリセットを選択', presetOne: 'プリセット1 · 日帰りハイキング',
    presetTwo: 'プリセット2 · 変数', presetThree: 'プリセット3 · やさしいリマインダー',
    clear: 'クリア', clearAria: 'すべての入力と結果をクリア', language: '言語',
    languageAria: '表示言語を選択', intro: 'プリセットを選ぶか、プロンプトを入力してください。入力や選択に応じて、統合プロンプトが更新されます。',
    rawPrompt: '基本プロンプト', alwaysIncluded: '常に含める', rawPlaceholder: '基本プロンプトを入力',
    context: '背景', contextPlaceholder: '含める背景情報を入力', role: '役割', rolePlaceholder: '役割や視点を入力',
    constraints: '条件', constraintsPlaceholder: '条件や文体の指定を入力',
    combinedPrompt: '統合プロンプト', ready: '入力待ち', generate: '回答を生成',
    comparison: '回答の比較', initialStatus: '回答を生成して、選択した指示による違いを比較できます。',
    rawRequired: '基本プロンプトを入力してください。', generatingCount: '{count}件の回答を生成中…',
    generatingCard: '{count}件中{current}件目の回答を生成中…', partialSummary: '{count}件中{succeeded}件の回答を生成しました。{failed}件は生成できませんでした。',
    successSummary: '{count}件の回答を生成しました。', rawOnly: '基本プロンプトのみ', rawPlus: '基本プロンプト + {labels}',
    downloadPdf: '回答をPDFでダウンロード', pdfError: 'PDFを作成できませんでした。もう一度お試しください。',
    exactPrompt: '送信したプロンプト', showMore: '続きを読む', showLess: '折りたたむ', response: '回答',
    waiting: '生成待ちです。', generating: '生成中…', generated: '回答を生成しました。',
    languageDirective: '日本語で回答してください。必要に応じて、引用文とコードは元の言語のまま保持してください。',
    pdfTitle: 'Prompt Mixer', pdfExactPrompt: '送信したプロンプト', pdfResponse: '回答',
    rateStopped: '利用上限に達したため送信されませんでした。',
    followUp: '追加質問', followUpPrompt: '追加質問のプロンプト', followUpResponse: '追加回答',
    followUpYes: 'はい', followUpNo: 'いいえ', followUpLoading: '追加回答を生成中…', followUpGenerated: '追加回答を生成しました。',
    followUpRetry: '再試行', followUpTurn: '追加回答 {count}',
    errors: {
      unsupported_media_type: 'JSON形式で送信してください。', request_too_large: 'プロンプトが長すぎます。',
      invalid_json: 'JSONが正しくありません。', invalid_prompt: '6,000文字以内のプロンプトを入力してください。',
      ai_not_configured: 'このサーバーではAIが設定されていません。', rate_site_daily: 'サイト全体の本日のAI回答上限に達しました。明日もう一度お試しください。',
      rate_ip_daily: 'この接続の本日のAI回答上限に達しました。明日もう一度お試しください。',
      rate_ip_minute: 'この接続からのAIリクエストが多すぎます。1分後にもう一度お試しください。',
      rate_limit_unavailable: 'AI回答を一時的に利用できません。しばらくしてからもう一度お試しください。',
      upstream_busy: 'AIが混み合っているか、利用が制限されています。しばらくしてからお試しください。',
      upstream_unavailable: 'AIの回答を利用できません。もう一度お試しください。',
      empty_response: 'AIから回答がありませんでした。もう一度お試しください。', not_found: 'ページが見つかりません。',
      page_load_failed: 'ページを読み込めませんでした。',
      invalid_ai_response: 'AIから正しい形式の回答を受け取れませんでした。もう一度お試しください。', invalid_follow_up: '追加質問のリクエストが無効か、長すぎます。',
        conversation_limit_reached: 'この会話は上限に達しました。新しいプロンプトを開始してください。',
      followUp: '追加質問', followUpPrompt: '追加質問のプロンプト', followUpResponse: '追加回答',
    },
  },
};

export function normalizeLocale(locale) {
  return locale === 'ja' ? 'ja' : 'en';
}

export function matchSupportedLocale(languageTag) {
  if (typeof languageTag !== 'string') return null;
  const tag = languageTag.toLowerCase();
  if (tag === 'en' || tag.startsWith('en-')) return 'en';
  if (tag === 'ja' || tag.startsWith('ja-')) return 'ja';
  return null;
}

export function detectPreferredLocale(saved, navigatorInfo) {
  if (saved === 'en' || saved === 'ja') return saved;
  const preferences = Array.isArray(navigatorInfo?.languages) && navigatorInfo.languages.length > 0
    ? navigatorInfo.languages
    : [navigatorInfo?.language];
  for (const languageTag of preferences) {
    const match = matchSupportedLocale(languageTag);
    if (match) return match;
  }
  return 'en';
}

export function translate(locale, key, values = {}) {
  const language = normalizeLocale(locale);
  const template = messages[language][key] ?? messages.en[key] ?? key;
  if (typeof template !== 'string') return key;
  return template.replace(/\{([a-z]+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
}

export function serverErrorMessage(locale, code) {
  const language = normalizeLocale(locale);
  return messages[language].errors[code] ?? messages.en.errors[code] ?? messages.en.errors.upstream_unavailable;
}

export function getPreset(locale, id) {
  const presets = {
    en: {
      one: {
        prompt: 'What should I pack for a day hike? Answer in one sentence.',
        context: 'It will be hot and there is no drinking water on the trail.',
        role: 'Act as an experienced hiking guide.',
        constraints: 'Name three essentials in 18 words or fewer.',
      },
      two: {
        prompt: 'What is a variable in programming? Answer in one sentence.',
        context: 'I am new to programming and have not used variables before.',
        role: 'Act as a patient programming instructor.',
        constraints: 'Use one concrete everyday example in 20 words or fewer.',
      },
      three: {
        prompt: 'Write me a reminder message. Answer in one sentence.',
        context: 'A classmate borrowed my notes last week, and I need them tomorrow.',
        role: 'Write as a friendly classmate.',
        constraints: 'Be polite and direct. Use 18 words or fewer.',
      },
    },
    ja: {
      one: {
        prompt: '日帰りハイキングには何を持っていけばよいですか。一文で答えてください。',
        context: '暑くなる予報で、登山道に飲み水はありません。',
        role: '経験豊富なハイキングガイドとして答えてください。',
        constraints: '必需品を3つ、簡潔に挙げてください。',
      },
      two: {
        prompt: 'プログラミングにおける変数とは何ですか。一文で答えてください。',
        context: 'プログラミングを始めたばかりで、変数を使ったことがありません。',
        role: '忍耐強いプログラミング講師として答えてください。',
        constraints: '身近な具体例を1つ使って説明してください。',
      },
      three: {
        prompt: 'リマインドのメッセージを書いてください。一文で答えてください。',
        context: '先週クラスメートにノートを貸しました。明日返してもらう必要があります。',
        role: '親しいクラスメートのように書いてください。',
        constraints: '丁寧で率直な表現にしてください。',
      },
    },
  };
  return presets[normalizeLocale(locale)][id] ?? null;
}