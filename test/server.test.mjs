import test from 'node:test';
import assert from 'node:assert/strict';
import { server } from '../server.mjs';

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
  }
});
