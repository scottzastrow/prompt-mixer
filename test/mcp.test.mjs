/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Integration tests for the milestone-1 MCP demo bridge: protected-resource metadata, OAuth Bearer challenge behavior (signature, issuer, audience, expiry), per-tool scope enforcement, the seven tools' annotations, the pair/activate/retrieve/unpair lifecycle, identity isolation, and operational-log hygiene — all with locally minted fixture tokens and no identity-provider network access.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { server } from '../server.mjs';

const realFetch = globalThis.fetch;
const ISSUER = 'https://idp.fixture.example/';
const AUDIENCE = 'https://mcp.fixture.example';
const KID = 'fixture-key-1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fixtureJwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };
const JWKS_URI = `data:application/json;base64,${Buffer.from(JSON.stringify({ keys: [fixtureJwk] })).toString('base64url')}`;

function mintToken(claims = {}, options = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: options.kid ?? KID, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: ISSUER,
    sub: 'auth0|fixture-presenter',
    aud: [AUDIENCE],
    scope: 'demo:pair demo:read',
    iat: nowSec - 5,
    exp: nowSec + 300,
    ...claims,
  })).toString('base64url');
  const signature = cryptoSign('RSA-SHA256', Buffer.from(`${header}.${payload}`), options.key ?? privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const limitStateDir = mkdtempSync(join(tmpdir(), 'prompt-mixer-mcp-limits-'));
let limitStateCounter = 0;

test.after(() => rmSync(limitStateDir, { recursive: true, force: true }));

// Each test gets a fresh fixture pairing code and a fresh limit state file, so
// the server's env-signature cache builds a new bridge with a new store.
function setDemoEnv(code, extraEnv = {}) {
  process.env.DEMO_IDP_ISSUER = ISSUER;
  process.env.DEMO_IDP_JWKS_URI = JWKS_URI;
  process.env.DEMO_MCP_AUDIENCE = AUDIENCE;
  process.env.DEMO_FIXTURE_PAIRING_CODE = code;
  limitStateCounter += 1;
  process.env.DEMO_LIMIT_STATE_FILE = join(limitStateDir, `limits-${limitStateCounter}.json`);
  for (const [name, value] of Object.entries(extraEnv)) {
    process.env[name] = String(value);
  }
}

function clearDemoEnv() {
  delete process.env.DEMO_IDP_ISSUER;
  delete process.env.DEMO_IDP_JWKS_URI;
  delete process.env.DEMO_MCP_AUDIENCE;
  delete process.env.DEMO_FIXTURE_PAIRING_CODE;
  delete process.env.DEMO_LIMIT_STATE_FILE;
  delete process.env.DEMO_MCP_LIMIT_PER_MINUTE;
  delete process.env.DEMO_MCP_LIMIT_PER_IP_DAY;
  delete process.env.DEMO_MCP_LIMIT_SITE_DAY;
  delete process.env.DEMO_MCP_IDENTITY_PER_MINUTE;
}

async function listen() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function mcpPost(base, { token, body }) {
  return realFetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function rpc(base, token, method, params, id = 1) {
  const res = await mcpPost(base, { token, body: { jsonrpc: '2.0', id, method, params } });
  const json = res.status === 200 && res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { res, json };
}

async function callTool(base, token, name, args = {}, id = 2) {
  return rpc(base, token, 'tools/call', { name, arguments: args }, id);
}

async function initialize(base, token) {
  const { res, json } = await rpc(base, token, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'fixture-client', version: '0.0.0' },
  }, 1);
  assert.equal(res.status, 200);
  const notice = await mcpPost(base, { token, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(notice.status, 202);
  return json;
}

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

test('the demo bridge is disabled by default and the app is unchanged', async () => {
  clearDemoEnv();
  const base = await listen();
  try {
    const metadata = await realFetch(`${base}/.well-known/oauth-protected-resource`);
    assert.equal(metadata.status, 404);
    const mcp = await mcpPost(base, { token: mintToken(), body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
    assert.equal(mcp.status, 404);
    const page = await realFetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Generate Response/);
    const health = await realFetch(`${base}/health`);
    assert.deepEqual(await health.json(), { status: 'ok' });
  } finally {
    server.close();
  }
});

test('serves RFC 9728 protected-resource metadata when enabled', async () => {
  setDemoEnv('METACODE1');
  const base = await listen();
  try {
    const res = await realFetch(`${base}/.well-known/oauth-protected-resource`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      resource: AUDIENCE,
      authorization_servers: [ISSUER],
      scopes_supported: ['demo:pair', 'demo:read'],
      bearer_methods_supported: ['header'],
    });
  } finally {
    server.close();
    clearDemoEnv();
  }
});

test('challenges missing, malformed, and untrusted tokens with 401', async () => {
  setDemoEnv('AUTHCODE1');
  const base = await listen();
  const body = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
  const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cases = [
    ['missing', undefined],
    ['not a bearer scheme', 'Token abc'],
    ['malformed compact token', 'Bearer not-a-jwt'],
    ['two-part token', 'Bearer aaa.bbb'],
    ['bad signature', `Bearer ${mintToken({}, { key: otherKeys.privateKey })}`],
    ['unknown key id', `Bearer ${mintToken({}, { kid: 'no-such-key' })}`],
    ['wrong issuer', `Bearer ${mintToken({ iss: 'https://evil.example/' })}`],
    ['wrong audience', `Bearer ${mintToken({ aud: ['https://other.example'] })}`],
    ['expired', `Bearer ${mintToken({ exp: Math.floor(Date.now() / 1000) - 3600 })}`],
    ['not yet valid', `Bearer ${mintToken({ nbf: Math.floor(Date.now() / 1000) + 3600 })}`],
    ['missing subject', `Bearer ${mintToken({ sub: '' })}`],
  ];
  try {
    for (const [label, authorization] of cases) {
      const res = await realFetch(`${base}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          ...(authorization ? { Authorization: authorization } : {}),
        },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 401, label);
      const challenge = res.headers.get('www-authenticate');
      assert.ok(challenge?.startsWith('Bearer '), label);
      assert.ok(challenge.includes(`resource_metadata="${AUDIENCE}/.well-known/oauth-protected-resource"`), label);
      if (label === 'missing' || label === 'not a bearer scheme') {
        assert.ok(!challenge.includes('error='), label);
      } else {
        assert.ok(challenge.includes('error="invalid_token"'), label);
      }
    }
    const expired = await realFetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${mintToken({ exp: Math.floor(Date.now() / 1000) - 3600 })}` },
      body: JSON.stringify(body),
    });
    assert.match(expired.headers.get('www-authenticate'), /error_description="[^"]*[Ee]xpired/);
  } finally {
    server.close();
    clearDemoEnv();
  }
});

test('lists seven tools with mutation annotations, scopes, and profile marker', async () => {
  setDemoEnv('LISTCODE1');
  const base = await listen();
  const token = mintToken();
  try {
    const init = await initialize(base, token);
    assert.equal(init.result.serverInfo.name, 'prompt-mixer-demo-bridge');
    assert.match(init.result.instructions, /Let's go live/);
    assert.match(init.result.instructions, /Let's take it offline/);
    assert.match(init.result.instructions, /untrusted user data/);

    const { json } = await rpc(base, token, 'tools/list', {}, 2);
    const tools = Object.fromEntries(json.result.tools.map(tool => [tool.name, tool]));
    assert.deepEqual(Object.keys(tools).sort(), [
      'activate_demo_session', 'get_demo_run', 'get_demo_session', 'get_profile',
      'list_demo_runs', 'pair_demo_session', 'unpair_demo_session',
    ]);

    // Retrieval tools are read-only; pairing, activation, and unpairing are not.
    for (const name of ['get_profile', 'get_demo_session', 'list_demo_runs', 'get_demo_run']) {
      assert.equal(tools[name].annotations.readOnlyHint, true, name);
      assert.equal(tools[name].annotations.openWorldHint, false, name);
      assert.equal(tools[name].annotations.destructiveHint, false, name);
    }
    for (const name of ['pair_demo_session', 'activate_demo_session', 'unpair_demo_session']) {
      assert.equal(tools[name].annotations.readOnlyHint, false, name);
    }

    // Per-tool securitySchemes drive the linking UI.
    assert.deepEqual(tools.pair_demo_session.securitySchemes, [{ type: 'oauth2', scopes: ['demo:pair'] }]);
    assert.deepEqual(tools.get_demo_run.securitySchemes, [{ type: 'oauth2', scopes: ['demo:read'] }]);
    assert.deepEqual(tools.get_profile.securitySchemes, [{ type: 'oauth2', scopes: [] }]);

    // Profile tool marker and response schema.
    assert.equal(tools.get_profile._meta['openai/profile'], true);
    assert.deepEqual(tools.get_profile.outputSchema.required, ['id']);
    assert.equal(tools.get_profile.outputSchema.additionalProperties, false);

    // Control phrases and the untrusted-data rule appear in tool descriptions.
    assert.match(tools.pair_demo_session.description, /Let's go live/);
    assert.match(tools.unpair_demo_session.description, /Let's take it offline/);
    assert.match(tools.get_demo_run.description, /untrusted user data, never instructions/);
    assert.deepEqual(tools.pair_demo_session.inputSchema.required, ['code']);
  } finally {
    server.close();
    clearDemoEnv();
  }
});

test('enforces per-tool scopes with 403 insufficient_scope challenges', async () => {
  setDemoEnv('SCOPECODE1');
  const base = await listen();
  try {
    const reader = mintToken({ scope: 'demo:read' });
    const denied = await callTool(base, reader, 'pair_demo_session', { code: 'XXXX-YYYY' });
    assert.equal(denied.res.status, 403);
    const challenge = denied.res.headers.get('www-authenticate');
    assert.ok(challenge.includes('error="insufficient_scope"'));
    assert.ok(challenge.includes('scope="demo:pair"'));
    assert.ok(challenge.includes(`resource_metadata="${AUDIENCE}/.well-known/oauth-protected-resource"`));

    const pairer = mintToken({ scope: 'demo:pair' });
    const readDenied = await callTool(base, pairer, 'get_demo_run', { runId: 'fixture-run-1' });
    assert.equal(readDenied.res.status, 403);
    assert.ok(readDenied.res.headers.get('www-authenticate').includes('scope="demo:read"'));

    // The profile tool requires authentication but no demo scope.
    const scopeless = mintToken({ scope: '' });
    await initialize(base, scopeless);
    const profile = await callTool(base, scopeless, 'get_profile');
    assert.equal(profile.res.status, 200);
    assert.equal(profile.json.result.isError, false);
    assert.match(profile.json.result.structuredContent.id, /^[0-9a-f]{64}$/);
  } finally {
    server.close();
    clearDemoEnv();
  }
});

test('runs the pair, go-live, retrieve, offline lifecycle with identity isolation', async () => {
  const code = 'LIFE-CODE1';
  setDemoEnv(code);
  const base = await listen();
  const presenter = mintToken();
  const stranger = mintToken({ sub: 'auth0|fixture-stranger' });
  try {
    await initialize(base, presenter);

    // A stable opaque profile id is returned for the same identity.
    const profileA = await callTool(base, presenter, 'get_profile');
    const profileB = await callTool(base, presenter, 'get_profile');
    assert.equal(profileA.json.result.structuredContent.id, profileB.json.result.structuredContent.id);
    assert.match(profileA.json.result.structuredContent.id, /^\S+$/);

    // Authenticated but unpaired: a pairing-required result, never an OAuth challenge.
    const unpaired = await callTool(base, presenter, 'get_demo_session');
    assert.equal(unpaired.res.status, 200);
    assert.equal(unpaired.json.result.isError, false);
    assert.equal(unpaired.json.result.structuredContent.status, 'pairing_required');
    assert.equal(unpaired.json.result.structuredContent.nextStep, 'pair_demo_session');

    // A wrong code is a tool error with remaining attempts, not a challenge.
    const wrong = await callTool(base, presenter, 'pair_demo_session', { code: 'WXYZ-2345' });
    assert.equal(wrong.json.result.isError, true);
    assert.equal(wrong.json.result.structuredContent.status, 'invalid_code');
    assert.equal(wrong.json.result.structuredContent.attemptsRemaining, 4);

    // Pairing binds the presenter identity; a second identity cannot steal it.
    const paired = await callTool(base, presenter, 'pair_demo_session', { code });
    assert.equal(paired.json.result.isError, false);
    assert.equal(paired.json.result.structuredContent.status, 'paired');
    assert.equal(paired.json.result.structuredContent.nextStep, 'activate_demo_session');

    const strangerAfterPair = await callTool(base, stranger, 'pair_demo_session', { code });
    assert.equal(strangerAfterPair.json.result.structuredContent.status, 'session_busy');
    const strangerReads = await callTool(base, stranger, 'get_demo_session');
    assert.equal(strangerReads.json.result.structuredContent.status, 'pairing_required');

    // Paired but not live: retrieval asks for activation.
    const notLive = await callTool(base, presenter, 'list_demo_runs');
    assert.equal(notLive.json.result.structuredContent.status, 'activation_required');
    assert.equal(notLive.json.result.structuredContent.nextStep, 'activate_demo_session');

    // "Let's go live": activation is confirmed only from the server's result.
    const live = await callTool(base, presenter, 'activate_demo_session');
    assert.equal(live.json.result.structuredContent.status, 'live');
    assert.match(live.json.result.structuredContent.message, /^Confirmed by the server/);

    const sessionView = await callTool(base, presenter, 'get_demo_session');
    const session = sessionView.json.result.structuredContent.session;
    assert.equal(session.state, 'live');
    assert.equal(session.runCount, 1);
    assert.match(session.expiresAt, /^\d{4}-\d{2}-\d{2}T/);

    const runs = await callTool(base, presenter, 'list_demo_runs');
    assert.equal(runs.json.result.structuredContent.status, 'ok');
    assert.deepEqual(runs.json.result.structuredContent.runs.map(run => run.id), ['fixture-run-1']);

    const detail = await callTool(base, presenter, 'get_demo_run', { runId: 'fixture-run-1' });
    const runResult = detail.json.result.structuredContent;
    assert.equal(runResult.status, 'ok');
    assert.match(runResult.notice, /untrusted user data/);
    assert.deepEqual(runResult.run.cards.map(card => card.cardSeq), [1, 2]);
    assert.deepEqual(runResult.run.cards[1].turns.map(turn => turn.status), ['success', 'superseded']);
    assert.match(runResult.run.cards[0].exactPrompt, /^Synthetic fixture prompt/);
    assert.match(runResult.run.cards[0].answer, /^Synthetic fixture answer/);

    // Foreign and unknown identifiers are both not-found.
    const foreign = await callTool(base, presenter, 'get_demo_run', { runId: 'fixture-run-foreign' });
    assert.equal(foreign.json.result.isError, true);
    assert.equal(foreign.json.result.structuredContent.status, 'not_found');

    // "Let's take it offline": revocation is confirmed by the server and is immediate.
    const offline = await callTool(base, presenter, 'unpair_demo_session');
    assert.equal(offline.json.result.structuredContent.status, 'offline');
    assert.match(offline.json.result.structuredContent.message, /^Confirmed by the server/);
    const afterOffline = await callTool(base, presenter, 'get_demo_session');
    assert.equal(afterOffline.json.result.structuredContent.status, 'pairing_required');

    // The consumed code cannot pair anyone again, even after unpairing.
    const reuse = await callTool(base, stranger, 'pair_demo_session', { code });
    assert.equal(reuse.json.result.structuredContent.status, 'used');
  } finally {
    server.close();
    clearDemoEnv();
  }
});

test('locks out after five failed code attempts over the wire', async () => {
  setDemoEnv('LOCKCODE1');
  const base = await listen();
  const presenter = mintToken();
  try {
    await initialize(base, presenter);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await callTool(base, presenter, 'pair_demo_session', { code: 'BBBB-CCCC' });
      assert.equal(result.json.result.structuredContent.status, 'invalid_code');
    }
    const locked = await callTool(base, presenter, 'pair_demo_session', { code: 'LOCKCODE1' });
    assert.equal(locked.json.result.structuredContent.status, 'locked');
  } finally {
    server.close();
    clearDemoEnv();
  }
});

test('operational logs carry events but never tokens, codes, identities, or content', async () => {
  const code = 'HYGIENE1';
  setDemoEnv(code);
  const base = await listen();
  const captured = captureServerLogs();
  const presenter = mintToken({ sub: 'auth0|hygiene-presenter' });
  try {
    await initialize(base, presenter);
    await mcpPost(base, { body: { jsonrpc: '2.0', id: 9, method: 'initialize', params: {} } }); // 401 challenge
    await callTool(base, mintToken({ scope: 'demo:read' }), 'pair_demo_session', { code: 'XXXX-YYYY' }); // 403
    await callTool(base, presenter, 'pair_demo_session', { code: 'XXXX-YYYY' }); // invalid code
    await callTool(base, presenter, 'pair_demo_session', { code });
    await callTool(base, presenter, 'activate_demo_session');
    await callTool(base, presenter, 'get_demo_run', { runId: 'fixture-run-1' });
    await callTool(base, presenter, 'unpair_demo_session');

    const joined = captured.raw.join('\n');
    const token = mintToken({ sub: 'auth0|hygiene-presenter' });
    assert.ok(!joined.includes(token), 'no access-token material');
    assert.ok(!joined.includes('auth0|hygiene-presenter'), 'no subject identity');
    assert.ok(!joined.includes(code) && !joined.includes('HYGIENE1'), 'no pairing-code plaintext');
    assert.ok(!joined.includes('Synthetic fixture prompt'), 'no conversation content');
    assert.ok(!joined.includes('127.0.0.1'), 'no client IP');

    assert.ok(captured.byEvent('mcp_auth_challenge').length >= 1);
    assert.equal(captured.byEvent('mcp_scope_denied').length, 1);
    const outcomes = captured.byEvent('mcp_tool_end').map(record => `${record.context.tool}:${record.context.outcome}`);
    assert.ok(outcomes.includes('pair_demo_session:invalid_code'));
    assert.ok(outcomes.includes('pair_demo_session:paired'));
    assert.ok(outcomes.includes('activate_demo_session:live'));
    assert.ok(outcomes.includes('get_demo_run:ok'));
    assert.ok(outcomes.includes('unpair_demo_session:offline'));

    for (const record of captured.records) {
      assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      assert.ok(['info', 'warn', 'error'].includes(record.level));
      assert.equal(typeof record.event, 'string');
      assert.equal(typeof record.context, 'object');
    }
  } finally {
    captured.restore();
    server.close();
    clearDemoEnv();
  }
});

// Regression for the scopes contract: locally signed tokens go through the real
// jose-based verifier (signature, issuer, audience, expiry) and the real HTTP
// handler — no verification stub — proving a scoped token reaches its tools and
// a scopeless-for-the-tool token is refused with 403.
test('regression: verified scopes authorize tools through the real token path', async () => {
  const code = 'SCOPEREG1';
  setDemoEnv(code);
  const base = await listen();
  const pairer = mintToken({ scope: 'demo:pair' });
  const reader = mintToken({ scope: 'demo:read' });
  try {
    // demo:pair identity pairs and activates through the real verifier.
    await initialize(base, pairer);
    const paired = await callTool(base, pairer, 'pair_demo_session', { code });
    assert.equal(paired.res.status, 200);
    assert.equal(paired.json.result.structuredContent.status, 'paired');
    const live = await callTool(base, pairer, 'activate_demo_session');
    assert.equal(live.json.result.structuredContent.status, 'live');

    // The same identity without demo:read cannot read.
    const pairerRead = await callTool(base, pairer, 'get_demo_session');
    assert.equal(pairerRead.res.status, 403);
    assert.ok(pairerRead.res.headers.get('www-authenticate').includes('error="insufficient_scope"'));

    // A demo:read token for the same identity reads the live session.
    await initialize(base, reader);
    const read = await callTool(base, reader, 'get_demo_session');
    assert.equal(read.res.status, 200);
    assert.equal(read.json.result.structuredContent.status, 'ok');
    assert.equal(read.json.result.structuredContent.session.state, 'live');

    // ...but cannot mutate.
    const readerPair = await callTool(base, reader, 'pair_demo_session', { code });
    assert.equal(readerPair.res.status, 403);
    assert.ok(readerPair.res.headers.get('www-authenticate').includes('scope="demo:pair"'));
  } finally {
    server.close();
    clearDemoEnv();
  }
});

test('limits /mcp requests per client IP before any token verification', async () => {
  setDemoEnv('RATELIMIT', { DEMO_MCP_LIMIT_PER_MINUTE: 2 });
  const base = await listen();
  const captured = captureServerLogs();
  const unknownKeyToken = mintToken({}, { kid: 'flooded-key-id' });
  const body = { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} };
  try {
    // Even repeated unknown-key tokens are answered from the OAuth challenge
    // path until the IP budget runs out; the JWKS cooldown bounds key fetches.
    for (let index = 0; index < 2; index += 1) {
      const res = await mcpPost(base, { token: unknownKeyToken, body });
      assert.equal(res.status, 401);
    }
    const third = await mcpPost(base, { token: unknownKeyToken, body });
    assert.equal(third.status, 429);
    assert.equal((await third.json()).error, 'rate_limited');
    assert.ok(Number(third.headers.get('retry-after')) >= 1);

    const limited = captured.byEvent('mcp_rate_limited');
    assert.equal(limited.length, 1);
    assert.equal(limited[0].context.scope, 'ip');
    assert.ok(!captured.raw.join('\n').includes('127.0.0.1'), 'no client IP in logs');
  } finally {
    captured.restore();
    server.close();
    clearDemoEnv();
  }
});

test('limits tools/call per authenticated identity independently of others', async () => {
  setDemoEnv('IDENTLIMIT', { DEMO_MCP_IDENTITY_PER_MINUTE: 2 });
  const base = await listen();
  const presenter = mintToken();
  const other = mintToken({ sub: 'auth0|fixture-other' });
  try {
    await initialize(base, presenter); // initialize and notifications are not metered
    const first = await callTool(base, presenter, 'get_profile');
    const second = await callTool(base, presenter, 'get_profile');
    assert.equal(first.json.result.isError, false);
    assert.equal(second.json.result.isError, false);

    const third = await callTool(base, presenter, 'get_profile');
    assert.equal(third.res.status, 429);
    assert.equal((await third.res.json()).error, 'rate_limited');
    assert.ok(Number(third.res.headers.get('retry-after')) >= 1);

    // A different authenticated identity keeps its own budget.
    await initialize(base, other);
    const otherCall = await callTool(base, other, 'get_profile');
    assert.equal(otherCall.res.status, 200);
    assert.equal(otherCall.json.result.isError, false);
  } finally {
    server.close();
    clearDemoEnv();
  }
});
