import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { server } from '../server.mjs';
import { RequestLimits } from '../limits.mjs';

const realFetch = globalThis.fetch;

test('serves the UI and rejects invalid input without calling OpenAI', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await realFetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Generate Response/);

    const invalid = await realFetch(`${base}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '' }),
    });
    assert.equal(invalid.status, 400);

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
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'A concise explanation.' }] }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await realFetch(`http://127.0.0.1:${server.address().port}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Explain recursion.\n\nContext: beginner' }),
    });
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { response: 'A concise explanation.' });
    assert.equal(submitted.input, 'Explain recursion.\n\nContext: beginner');
    assert.equal(submitted.store, false);
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
    assert.deepEqual(await result.json(), { error: 'The AI returned no text. Please try again.' });

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
      content: [{ type: 'output_text', text: 'A partial answer.' }],
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
    assert.deepEqual(await result.json(), { response: 'A partial answer.' });

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
      return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: 'ok' }] }] }), { status: 200 });
    };
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api/generate`;
    const request = ip => realFetch(base, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `forged, ${ip}` },
      body: JSON.stringify({ prompt: 'Hello' }),
    });
    try {
      assert.equal((await request('192.0.2.3')).status, 200);
      const blocked = await request('192.0.2.3');
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
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
