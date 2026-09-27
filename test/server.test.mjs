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
