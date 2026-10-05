import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { server } from '../server.mjs';
import { RequestLimits } from '../limits.mjs';

const realFetch = globalThis.fetch;
const structuredOutput = (answer, followUp = null) => JSON.stringify({ answer, follow_up: followUp });

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
  const oldError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);

  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'resp_empty_123',
    status: 'completed',
    incomplete_details: null,
    error: null,
    usage: { input_tokens: 5, output_tokens: 0 },
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

    const diagnostic = logged.find(args => args.some(arg => arg && typeof arg === 'object' && arg.id === 'resp_empty_123'));
    assert.ok(diagnostic, 'server should log empty output metadata');
    const details = diagnostic.find(arg => arg && typeof arg === 'object' && 'id' in arg);
    assert.deepEqual(details.id, 'resp_empty_123');
    assert.deepEqual(details.xRequestId, 'req-empty-456');
    assert.equal(details.http_status, 200);
    assert.equal(details.response_status, 'completed');
    assert.deepEqual(details.output_item_types, []);
    assert.ok(!JSON.stringify(details).includes('Explain recursion'));
    assert.ok(!JSON.stringify(details).includes('test-only-secret'));
  } finally {
    server.close();
    console.error = oldError;
    globalThis.fetch = oldFetch;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LIMIT_STATE_FILE;
  }
});

test('logs incomplete OpenAI output metadata when partial text still exists', async () => {
  process.env.OPENAI_API_KEY = 'test-only-secret';
  process.env.LIMIT_STATE_FILE = join(tmpdir(), `prompt-mixer-partial-${Date.now()}.json`);
  const oldFetch = globalThis.fetch;
  const oldError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);

  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'resp_partial_123',
    status: 'incomplete',
    incomplete_details: { reason: 'max_output_tokens' },
    error: { message: 'incomplete response' },
    usage: { input_tokens: 7, output_tokens: 3 },
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

    const diagnostic = logged.find(args => args.some(arg => arg && typeof arg === 'object' && arg.id === 'resp_partial_123'));
    assert.ok(diagnostic, 'server should log incomplete metadata even with partial output text');
    const details = diagnostic.find(arg => arg && typeof arg === 'object' && 'id' in arg);
    assert.deepEqual(details.id, 'resp_partial_123');
    assert.deepEqual(details.xRequestId, 'req-partial-456');
    assert.equal(details.http_status, 200);
    assert.equal(details.response_status, 'incomplete');
    assert.deepEqual(details.incomplete_details, { reason: 'max_output_tokens' });
    assert.deepEqual(details.error, { message: 'incomplete response' });
    assert.deepEqual(details.usage, { input_tokens: 7, output_tokens: 3 });
    assert.deepEqual(details.output_item_types, ['message', 'reasoning']);
    assert.ok(!JSON.stringify(details).includes('Explain recursion'));
    assert.ok(!JSON.stringify(details).includes('test-only-secret'));
  } finally {
    server.close();
    console.error = oldError;
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
