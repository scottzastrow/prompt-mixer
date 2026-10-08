/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Integration tests for the HTTP server, input validation, follow-ups, structured operational logging, and rate limits.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Socket } from 'node:net';
import { server } from '../server.mjs';
import { RequestLimits } from '../limits.mjs';

const realFetch = globalThis.fetch;
const structuredOutput = (answer, followUp = null) => JSON.stringify({ answer, follow_up: followUp });

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Captures structured server log lines (stdout/stderr) as parsed JSON records plus raw text.
function captureServerLogs() {
  const records = [];
  const raw = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const collect = (...args) => {
    const line = args.join(' ');
    raw.push(line);
    try {
      records.push(JSON.parse(line));
    } catch {
      // Ignore non-JSON output from other components.
    }
  };
  console.log = collect;
  console.warn = collect;
  console.error = collect;
  return {
    records,
    raw,
    byEvent: event => records.filter(record => record && record.event === event),
    restore: () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

test('serves the UI and rejects invalid input without calling OpenAI', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await realFetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Generate Response/);

    const comparisonModule = await realFetch(`${base}/comparison.mjs`);
    assert.equal(comparisonModule.status, 200);
    assert.match(comparisonModule.headers.get('Content-Type'), /javascript/);
    assert.match(await comparisonModule.text(), /buildComparisonPrompts/);
    const localeModule = await realFetch(`${base}/i18n.mjs`);
    assert.equal(localeModule.status, 200);
    assert.match(await localeModule.text(), /languageDirective/);

    for (const asset of ['pdfmake.min.js', 'vfs_fonts.js']) {
      const pdfAsset = await realFetch(`${base}/${asset}`);
      assert.equal(pdfAsset.status, 200);
      assert.match(pdfAsset.headers.get('Content-Type'), /javascript/);
      assert.match(pdfAsset.headers.get('Content-Security-Policy'), /script-src 'self'/);
      const source = await pdfAsset.text();
      assert.ok(source.length > 1000, `${asset} is served locally`);
      if (asset === 'vfs_fonts.js') {
        assert.match(source, /pdfMake\.addVirtualFileSystem/);
        assert.match(source, /Roboto-Regular\.ttf/);
      }
    }
    const japaneseFont = await realFetch(`${base}/fonts/NotoSansJP-Regular.otf`);
    assert.equal(japaneseFont.status, 200);
    assert.match(japaneseFont.headers.get('Content-Type'), /font\/otf/);
    assert.match(japaneseFont.headers.get('Content-Security-Policy'), /script-src 'self'/);
    assert.ok((await japaneseFont.arrayBuffer()).byteLength > 1_000_000);
    const fontLicense = await realFetch(`${base}/fonts/OFL.txt`);
    assert.match(await fontLicense.text(), /SIL OPEN FONT LICENSE Version 1\.1/);

    const invalid = await realFetch(`${base}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    assert.equal(invalid.status, 400);
    const invalidJapanese = await realFetch(`${base}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '', locale: 'ja' }),
    });
    assert.equal(invalidJapanese.status, 400);
    assert.deepEqual(await invalidJapanese.json(), {
      errorCode: 'invalid_prompt', error: '6,000文字以内のプロンプトを入力してください。',
    });

    const forbidden = await realFetch(`${base}/.env`);
    assert.equal(forbidden.status, 404);
  } finally {
    server.close();
  }
});

test('uses server side key and returns model output without exposing credentials', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-mixer-test-'));
  process.env.LIMIT_STATE_FILE = join(dir, 'limits.json');
  process.env.OPENAI_API_KEY = 'test-only-secret';
  const oldFetch = globalThis.fetch;
  let submitted;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer test-only-secret');
    submitted = JSON.parse(options.body);
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: structuredOutput('A concise explanation.', { offer: 'Want an example?', prompt: 'Give an example.' }) }] }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await realFetch(`http://127.0.0.1:${server.address().port}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Explain recursion.\n\nRespond in Japanese.', locale: 'ja' }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { response: 'A concise explanation.', followUp: { offer: 'Want an example?', prompt: 'Give an example.' } });
    assert.match(submitted.instructions, /「はい／いいえ」で受けるか断るかを判断できる、具体的な一つの行動/);
    assert.match(submitted.instructions, /このテキスト専用アプリが実行できる行動のみを提案してください/);
    assert.match(submitted.instructions, /コードの実行、ウェブサイトの閲覧、ファイルへのアクセス、外部での操作を提案してはいけません/);
    assert.match(submitted.instructions, /予測した出力は、実行結果ではなく予想される出力として正直に説明してください/);
    assert.match(submitted.instructions, /follow_up\.prompt は同じ行動を直接依頼するプロンプトにしてください/);
    assert.match(submitted.instructions, /複数の選択肢からユーザーに選ばせてはいけません/);
    assert.equal(submitted.max_output_tokens, 3000);
    assert.deepEqual(submitted.reasoning, { effort: 'low' });
    assert.equal(submitted.text.format.type, 'json_schema');
    assert.equal(submitted.text.format.strict, true);
    assert.deepEqual(submitted.text.format.schema.required, ['answer', 'follow_up']);
    assert.deepEqual(submitted.text.format.schema.properties.follow_up.anyOf.map(schema => schema.type), ['object', 'null']);
    assert.equal(submitted.store, false);
  } finally {
    server.close();
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('generates a follow-up from ordered history and allows another structured offer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-mixer-follow-up-test-'));
  process.env.LIMIT_STATE_FILE = join(dir, 'limits.json');
  process.env.OPENAI_API_KEY = 'test-only-secret';
  const oldFetch = globalThis.fetch;
  let submitted;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    submitted = JSON.parse(options.body);
    return new Response(JSON.stringify({ output: [{ content: [{
      type: 'output_text', text: structuredOutput('A worked example.', { offer: 'One more question?', prompt: 'What else?' }),
    }] }] }), { status: 200 });
  };

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const payload = {
      originalPrompt: 'Original exact prompt',
      originalResponse: 'Original answer',
      history: [{ prompt: 'Earlier follow-up', response: 'Earlier response.' }],
      nextPrompt: 'Give a worked example.',
      locale: 'en',
    };
    const result = await realFetch(`http://127.0.0.1:${server.address().port}/api/follow-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), {
      response: 'A worked example.', followUp: { offer: 'One more question?', prompt: 'What else?' },
    });
    assert.deepEqual(submitted.input, [
      { role: 'user', content: 'Original exact prompt' },
      { role: 'assistant', content: 'Original answer' },
      { role: 'user', content: 'Earlier follow-up' },
      { role: 'assistant', content: 'Earlier response.' },
      { role: 'user', content: 'Give a worked example.' },
    ]);
    assert.equal(submitted.text.format.name, 'prompt_mixer_follow_up');
    assert.deepEqual(submitted.text.format.schema.properties.follow_up.anyOf.map(schema => schema.type), ['object', 'null']);
    assert.match(submitted.instructions, /exactly one concrete action the user can accept or decline with Yes or No/);
    assert.match(submitted.instructions, /Only offer actions this text-only app can perform: explain something, draft text or code, show examples, predict code output, or provide instructions/);
    assert.match(submitted.instructions, /Never offer to execute code, browse websites, access files, or perform external actions/);
    assert.match(submitted.instructions, /Describe predicted output honestly as expected output, not as an execution result/);
    assert.match(submitted.instructions, /follow_up\.offer a concise Yes\/No question/);
    assert.match(submitted.instructions, /Never ask the user to choose between alternatives/);
    assert.match(submitted.instructions, /If clarification from the user is required/);
  } finally {
    server.close();
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects follow-up turn, conversation-text, and body-size limits before OpenAI', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prompt-mixer-conversation-limit-'));
    process.env.LIMIT_STATE_FILE = join(dir, 'limits.json');
    process.env.OPENAI_API_KEY = 'test-only-secret';
    const oldFetch = globalThis.fetch;
    let paidCalls = 0;
    globalThis.fetch = async () => {
      paidCalls++;
      return new Response('{}', { status: 200 });
    };
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const request = (payload, locale = 'ja') => realFetch(`http://127.0.0.1:${server.address().port}/api/follow-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-UI-Locale': locale },
      body: JSON.stringify({ locale, ...payload }),
    });
    const base = { originalPrompt: 'Original prompt', originalResponse: 'Original answer', nextPrompt: 'Continue.' };
    try {
      const tooManyTurns = await request({
        ...base,
        history: Array.from({ length: 8 }, (_, index) => ({ prompt: `Prompt ${index}`, response: `Answer ${index}` })),
      });
      assert.equal(tooManyTurns.status, 413);
      assert.equal((await tooManyTurns.json()).errorCode, 'conversation_limit_reached');

      const tooMuchText = await request({
        ...base,
        originalResponse: '答'.repeat(24000),
        history: [],
      });
      assert.equal(tooMuchText.status, 413);
      assert.deepEqual(await tooMuchText.json(), {
        errorCode: 'conversation_limit_reached',
        error: 'この会話は上限に達しました。新しいプロンプトを開始してください。',
      });

      const tooLargeBody = await request({ ...base, history: [], nextPrompt: 'x'.repeat(200_100) });
      assert.equal(tooLargeBody.status, 413);
      assert.equal((await tooLargeBody.json()).errorCode, 'conversation_limit_reached');
      assert.equal(paidCalls, 0);
    } finally {
      server.close();
      globalThis.fetch = oldFetch;
      delete process.env.OPENAI_API_KEY;
      delete process.env.LIMIT_STATE_FILE;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('logs empty OpenAI output metadata without exposing prompt or content', async () => {
  process.env.OPENAI_API_KEY = 'test-only-secret';
  process.env.LIMIT_STATE_FILE = join(tmpdir(), `prompt-mixer-empty-${Date.now()}.json`);
  const oldFetch = globalThis.fetch;
  const captured = captureServerLogs();

  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'resp_empty_123',
    status: 'completed',
    incomplete_details: null,
    error: null,
    usage: { input_tokens: 5, output_tokens: 768, output_tokens_details: { reasoning_tokens: 768 } },
    output: [],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-empty-456' },
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await realFetch(`http://127.0.0.1:${server.address().port}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Explain recursion.' }),
    });

    assert.equal(result.status, 502);
    assert.deepEqual(await result.json(), { errorCode: 'empty_response', error: 'The AI returned no text. Please try again.' });

    const diagnostics = captured.byEvent('openai_response_incomplete');
    assert.equal(diagnostics.length, 1, 'server should log one structured empty-output diagnostic');
    const diagnostic = diagnostics[0];
    assert.match(diagnostic.timestamp, TIMESTAMP_PATTERN);
    assert.equal(diagnostic.level, 'warn');
    assert.match(diagnostic.requestId, REQUEST_ID_PATTERN);
    assert.deepEqual(diagnostic.context, {
      responseId: 'resp_empty_123',
      upstreamRequestId: 'req-empty-456',
      httpStatus: 200,
      responseStatus: 'completed',
      incompleteReason: null,
      usage: { inputTokens: 5, outputTokens: 768, totalTokens: null, reasoningTokens: 768 },
      outputItemTypes: [],
    });
    assert.ok(!('error' in diagnostic.context), 'raw upstream error objects are not logged');

    const ends = captured.byEvent('ai_request_end');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].requestId, diagnostic.requestId, 'diagnostic and terminal events share the request ID');
    assert.equal(ends[0].context.outcome, 'empty_response');
    assert.equal(ends[0].context.status, 502);
    assert.equal(typeof ends[0].context.durationMs, 'number');

    const allLines = captured.raw.join('\n');
    assert.ok(!allLines.includes('Explain recursion'));
    assert.ok(!allLines.includes('test-only-secret'));
  } finally {
    server.close();
    captured.restore();
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
  }
});

test('logs incomplete OpenAI output metadata when partial text still exists', async () => {
  process.env.OPENAI_API_KEY = 'test-only-secret';
  process.env.LIMIT_STATE_FILE = join(tmpdir(), `prompt-mixer-partial-${Date.now()}.json`);
  const oldFetch = globalThis.fetch;
  const captured = captureServerLogs();

  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'resp_partial_123',
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    error: { message: 'upstream error echoing submitted content' },
    usage: { input_tokens: 7, output_tokens: 3, output_tokens_details: { reasoning_tokens: 2 } },
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: structuredOutput('A partial answer.') }],
    }, { type: 'reasoning' }],
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'x-request-id': 'req-partial-456' },
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await realFetch(`http://127.0.0.1:${server.address().port}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Explain recursion.' }),
    });

    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { response: 'A partial answer.', followUp: null });

    const diagnostics = captured.byEvent('openai_response_incomplete');
    assert.equal(diagnostics.length, 1, 'server should log incomplete metadata even with partial output text');
    const diagnostic = diagnostics[0];
    assert.match(diagnostic.timestamp, TIMESTAMP_PATTERN);
    assert.equal(diagnostic.level, 'warn');
    assert.match(diagnostic.requestId, REQUEST_ID_PATTERN);
    assert.deepEqual(diagnostic.context, {
      responseId: 'resp_partial_123',
      upstreamRequestId: 'req-partial-456',
      httpStatus: 200,
      responseStatus: 'incomplete',
      incompleteReason: 'max_output_tokens',
      usage: { inputTokens: 7, outputTokens: 3, totalTokens: null, reasoningTokens: 2 },
      outputItemTypes: ['message', 'reasoning'],
    });
    assert.ok(!('error' in diagnostic.context), 'raw upstream error objects are not logged');

    const ends = captured.byEvent('ai_request_end');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].requestId, diagnostic.requestId);
    assert.equal(ends[0].context.outcome, 'success');
    assert.equal(ends[0].context.incomplete, true);

    const allLines = captured.raw.join('\n');
    assert.ok(!allLines.includes('Explain recursion'));
    assert.ok(!allLines.includes('upstream error echoing submitted content'));
    assert.ok(!allLines.includes('test-only-secret'));
  } finally {
    server.close();
    captured.restore();
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
  }
});

test('limits persist across restarts, distinguish IPs, and block before the paid call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-mixer-limit-'));
  const path = join(dir, 'limits.json');
  let now = Date.parse('2026-09-27T12:00:00Z');
  const options = { now: () => now, perMinute: 2, perDay: 3, sitePerDay: 4 };
  try {
    const first = new RequestLimits(path, options);
    assert.equal(first.reserve('192.0.2.1'), null);
    assert.equal(first.reserve('192.0.2.1'), null);
    assert.equal(first.reserve('192.0.2.1').status, 429);
    assert.equal(first.reserve('192.0.2.2'), null);

    now += 60_001;
    const restarted = new RequestLimits(path, options);
    assert.equal(restarted.reserve('192.0.2.1'), null);
    assert.equal(restarted.reserve('192.0.2.2').status, 429); // site ceiling
    now += 60_001;
    assert.equal(restarted.reserve('192.0.2.1').status, 429); // IP ceiling

    const daily = new RequestLimits(join(dir, 'daily.json'), { ...options, sitePerDay: 10 });
    assert.equal(daily.reserve('192.0.2.1'), null);
    now += 60_001;
    assert.equal(daily.reserve('192.0.2.1'), null);
    now += 60_001;
    assert.equal(daily.reserve('192.0.2.1'), null);
    now += 60_001;
    assert.equal(daily.reserve('192.0.2.1').status, 429);
    now = Date.parse('2026-09-28T00:00:00Z');
    assert.equal(daily.reserve('192.0.2.1'), null);

    process.env.LIMIT_STATE_FILE = join(dir, 'http-limits.json');
    process.env.LIMIT_PER_MINUTE = '1';
    process.env.OPENAI_API_KEY = 'test-only-secret';
    const oldFetch = globalThis.fetch;
    let paidCalls = 0;
    globalThis.fetch = async () => {
      paidCalls++;
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: structuredOutput('ok') }] }] }), { status: 200 });
    };
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (ip, path = '/api/generate') => realFetch(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `forged, ${ip}` },
      body: JSON.stringify(path === '/api/follow-up'
        ? { originalPrompt: 'Hello', originalResponse: 'Answer', history: [], nextPrompt: 'Tell me more.' }
        : { prompt: 'Hello' }),
    });
    try {
      assert.equal((await request('192.0.2.3')).status, 200);
      const blocked = await request('192.0.2.3', '/api/follow-up');
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
      assert.deepEqual(await blocked.json(), {
        errorCode: 'rate_ip_minute', error: 'Too many AI requests from this connection. Try again in a minute.',
      });
      assert.equal((await request('192.0.2.4')).status, 200);
      assert.equal(paidCalls, 2);
    } finally {
      server.close();
      globalThis.fetch = oldFetch;
    }
  } finally {
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
    delete process.env.LIMIT_PER_MINUTE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('logs correlated start and terminal events for rejections before any paid call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-mixer-reject-log-'));
  process.env.LIMIT_STATE_FILE = join(dir, 'limits.json');
  process.env.OPENAI_API_KEY = 'test-only-secret';
  const oldFetch = globalThis.fetch;
  let paidCalls = 0;
  globalThis.fetch = async () => {
    paidCalls++;
    return new Response(JSON.stringify({ output: [] }), { status: 200 });
  };
  const captured = captureServerLogs();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const requestEvents = async makeRequest => {
    const before = captured.records.length;
    const response = await makeRequest();
    const events = captured.records.slice(before);
    const starts = events.filter(record => record.event === 'ai_request_start');
    const ends = events.filter(record => record.event === 'ai_request_end');
    assert.equal(starts.length, 1, 'each request logs one start event');
    assert.equal(ends.length, 1, 'each request logs exactly one terminal event');
    assert.equal(ends[0].requestId, starts[0].requestId, 'start and terminal events share a request ID');
    assert.match(ends[0].requestId, REQUEST_ID_PATTERN);
    assert.match(ends[0].timestamp, TIMESTAMP_PATTERN);
    assert.equal(typeof ends[0].context.durationMs, 'number');
    return { response, start: starts[0], end: ends[0] };
  };
  try {
    const invalidMedia = await requestEvents(() => realFetch(`${base}/api/generate`, {
      method: 'POST', body: 'not-json',
    }));
    assert.equal(invalidMedia.response.status, 415);
    assert.equal(invalidMedia.end.level, 'warn');
    assert.equal(invalidMedia.end.context.outcome, 'validation_rejected');
    assert.equal(invalidMedia.end.context.errorCode, 'unsupported_media_type');

    const invalidPrompt = await requestEvents(() => realFetch(`${base}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    }));
    assert.equal(invalidPrompt.response.status, 400);
    assert.equal(invalidPrompt.end.context.outcome, 'validation_rejected');
    assert.equal(invalidPrompt.end.context.errorCode, 'invalid_prompt');

    delete process.env.OPENAI_API_KEY;
    const notConfigured = await requestEvents(() => realFetch(`${base}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Explain recursion.' }),
    }));
    assert.equal(notConfigured.response.status, 503);
    assert.equal(notConfigured.end.level, 'error');
    assert.equal(notConfigured.end.context.outcome, 'not_configured');
    assert.equal(notConfigured.end.context.errorCode, 'ai_not_configured');
    process.env.OPENAI_API_KEY = 'test-only-secret';

    const tooManyTurns = await requestEvents(() => realFetch(`${base}/api/follow-up`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        originalPrompt: 'Original prompt', originalResponse: 'Original answer', nextPrompt: 'Continue.',
        history: Array.from({ length: 8 }, (_, index) => ({ prompt: `Prompt ${index}`, response: `Answer ${index}` })),
      }),
    }));
    assert.equal(tooManyTurns.response.status, 413);
    assert.equal(tooManyTurns.end.context.outcome, 'conversation_limit_reached');
    assert.equal(tooManyTurns.end.context.errorCode, 'conversation_limit_reached');

    assert.equal(paidCalls, 0, 'all rejections happen before any paid OpenAI call');
  } finally {
    server.close();
    captured.restore();
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('logs success, rate-limit, and upstream terminal outcomes with safe correlated metadata', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-mixer-outcome-log-'));
  process.env.LIMIT_STATE_FILE = join(dir, 'limits.json');
  process.env.LIMIT_PER_MINUTE = '1';
  process.env.OPENAI_API_KEY = 'test-only-secret';
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_USER = 'prompt_mixer_test';
  process.env.DB_PASSWORD = 'invalid-test-password';
  process.env.DB_NAME = 'prompt_mixer_test_missing';
  const oldFetch = globalThis.fetch;
  let paidCalls = 0;
  globalThis.fetch = async () => {
    paidCalls++;
    if (paidCalls === 2) return new Response('upstream failure', { status: 500 });
    return new Response(JSON.stringify({
      id: 'resp_ok_1',
      status: 'completed',
      usage: { input_tokens: 11, output_tokens: 4, total_tokens: 15, output_tokens_details: { reasoning_tokens: 1 } },
      output: [{ content: [{ type: 'output_text', text: structuredOutput('A concise answer.') }] }],
    }), { status: 200, headers: { 'x-request-id': 'req-upstream-1' } });
  };
  const captured = captureServerLogs();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const generate = ip => realFetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `proxy, ${ip}` },
    body: JSON.stringify({ prompt: 'Explain recursion.', locale: 'en' }),
  });
  try {
    const success = await generate('192.0.2.10');
    assert.equal(success.status, 200);
    const successEnd = captured.byEvent('ai_request_end').at(-1);
    assert.equal(successEnd.level, 'info');
    assert.equal(successEnd.context.outcome, 'success');
    assert.equal(successEnd.context.status, 200);
    assert.equal(successEnd.context.model, 'gpt-5-mini');
    assert.equal(successEnd.context.locale, 'en');
    assert.deepEqual(successEnd.context.usage, { inputTokens: 11, outputTokens: 4, totalTokens: 15, reasoningTokens: 1 });
    assert.equal(typeof successEnd.context.durationMs, 'number');
    const start = captured.byEvent('ai_request_start').find(record => record.requestId === successEnd.requestId);
    assert.ok(start, 'success terminal event correlates to a start event');
    assert.equal(start.context.endpoint, '/api/generate');

    const dbFailures = captured.byEvent('db_write_failed');
    assert.equal(dbFailures.length, 1, 'database write failure is a separate structured event');
    assert.equal(dbFailures[0].level, 'error');
    assert.equal(dbFailures[0].requestId, successEnd.requestId, 'database failure carries the request ID');
    assert.equal(typeof dbFailures[0].context.errorName, 'string');

    const blocked = await generate('192.0.2.10');
    assert.equal(blocked.status, 429);
    const blockedEnd = captured.byEvent('ai_request_end').at(-1);
    assert.equal(blockedEnd.level, 'warn');
    assert.equal(blockedEnd.context.outcome, 'rate_limited');
    assert.equal(blockedEnd.context.errorCode, 'rate_ip_minute');
    assert.ok(blockedEnd.context.retryAfter > 0);
    assert.equal(paidCalls, 1, 'rate limiting happens before the paid call');

    const upstreamFailed = await generate('192.0.2.11');
    assert.equal(upstreamFailed.status, 502);
    const failureEnd = captured.byEvent('ai_request_end').at(-1);
    assert.equal(failureEnd.level, 'error');
    assert.equal(failureEnd.context.outcome, 'upstream_error');
    assert.equal(failureEnd.context.errorCode, 'upstream_unavailable');
    assert.equal(failureEnd.context.upstreamStatus, 500);
  } finally {
    server.close();
    captured.restore();
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
    delete process.env.LIMIT_PER_MINUTE;
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('operational logs exclude prompts, answers, credentials, connection details, and client IPs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-mixer-log-exclusion-'));
  process.env.LIMIT_STATE_FILE = join(dir, 'limits.json');
  process.env.OPENAI_API_KEY = 'test-only-secret';
  process.env.DB_HOST = 'db-secret-host.internal';
  process.env.DB_USER = 'prompt_mixer_test';
  process.env.DB_PASSWORD = 'db-secret-password';
  process.env.DB_NAME = 'prompt_mixer_test_missing';
  const oldFetch = globalThis.fetch;
  let failUpstream = false;
  globalThis.fetch = async () => {
    if (failUpstream) {
      return new Response('upstream error mentioning SENSITIVE_PROMPT_MARKER', { status: 500 });
    }
    return new Response(JSON.stringify({
      id: 'resp_ok_2',
      status: 'completed',
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
      output: [{ content: [{ type: 'output_text', text: structuredOutput('SENSITIVE_ANSWER_MARKER') }] }],
    }), { status: 200 });
  };
  const captured = captureServerLogs();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const generate = () => realFetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9, 198.51.100.23' },
    body: JSON.stringify({ prompt: 'SENSITIVE_PROMPT_MARKER' }),
  });
  try {
    assert.equal((await generate()).status, 200);
    failUpstream = true;
    assert.equal((await generate()).status, 502);

    assert.ok(captured.byEvent('ai_request_start').length >= 2);
    assert.ok(captured.byEvent('ai_request_end').length >= 2);
    assert.ok(captured.byEvent('db_write_failed').length >= 1);
    const allLines = captured.raw.join('\n');
    for (const forbidden of [
      'SENSITIVE_PROMPT_MARKER',
      'SENSITIVE_ANSWER_MARKER',
      'test-only-secret',
      'db-secret-password',
      'db-secret-host.internal',
      '198.51.100.23',
    ]) {
      assert.ok(!allLines.includes(forbidden), `operational logs must not contain: ${forbidden}`);
    }
  } finally {
    server.close();
    captured.restore();
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('logs exactly one terminal event and makes no paid call when the client disconnects mid-body', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-mixer-interrupt-'));
  process.env.LIMIT_STATE_FILE = join(dir, 'limits.json');
  process.env.OPENAI_API_KEY = 'test-only-secret';
  const oldFetch = globalThis.fetch;
  let paidCalls = 0;
  globalThis.fetch = async () => {
    paidCalls++;
    return new Response(JSON.stringify({
      output: [{ content: [{ type: 'output_text', text: structuredOutput('Recovered answer.') }] }],
    }), { status: 200 });
  };
  const captured = captureServerLogs();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const socket = new Socket();
    socket.on('error', () => {}); // Ignore the reset caused by the forced disconnect.
    await new Promise(resolve => socket.connect(port, '127.0.0.1', resolve));
    socket.write(
      'POST /api/generate HTTP/1.1\r\n' +
      'Host: 127.0.0.1\r\n' +
      'Content-Type: application/json\r\n' +
      'Content-Length: 5000\r\n' +
      'Connection: close\r\n\r\n' +
      '{"prompt":"partial'
    );
    // Let the server start reading, then break the connection before the body completes.
    await new Promise(resolve => setTimeout(resolve, 100));
    socket.destroy();

    let interrupted;
    for (let attempt = 0; attempt < 100 && !interrupted; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 20));
      interrupted = captured.byEvent('ai_request_end')
        .find(record => record.context.outcome === 'request_interrupted');
    }
    assert.ok(interrupted, 'interrupted request produces a terminal event');
    assert.equal(interrupted.level, 'warn');
    assert.match(interrupted.timestamp, TIMESTAMP_PATTERN);
    assert.match(interrupted.requestId, REQUEST_ID_PATTERN);
    assert.equal(typeof interrupted.context.durationMs, 'number');
    assert.equal(typeof interrupted.context.errorName, 'string');
    assert.ok(!('status' in interrupted.context), 'no HTTP status is sent for an interrupted request');
    const start = captured.byEvent('ai_request_start').find(record => record.requestId === interrupted.requestId);
    assert.ok(start, 'the terminal event correlates to a start event');
    assert.equal(
      captured.byEvent('ai_request_end').filter(record => record.requestId === interrupted.requestId).length,
      1,
      'the interrupted request logs exactly one terminal event',
    );
    assert.equal(paidCalls, 0, 'no paid OpenAI call for an interrupted request');

    // The server survived the disconnect and still serves requests.
    const recovered = await realFetch(`http://127.0.0.1:${port}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Explain recursion.' }),
    });
    assert.equal(recovered.status, 200);
    assert.equal(paidCalls, 1);
  } finally {
    server.close();
    captured.restore();
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
    rmSync(dir, { recursive: true, force: true });
  }
});
