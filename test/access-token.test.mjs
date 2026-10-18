/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Unit tests for the jose-based Bearer access-token verifier: claim and signature validation, returned AuthInfo scopes, and JWKS cache behavior (bounded lifetime, unknown-key refresh cooldown, concurrent-fetch deduplication, fetch timeout) — all with locally minted keys and an injectable fetch, no network.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { createAccessTokenVerifier, KeysUnavailableError, TokenError } from '../verify-access-token.mjs';

const ISSUER = 'https://idp.fixture.example/';
const AUDIENCE = 'https://mcp.fixture.example';
const KID = 'fixture-key-1';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fixtureJwks = { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] };

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

// A fetch implementation that serves the local fixture JWKS and counts calls.
function countingJwksFetch() {
  const state = { count: 0 };
  const fetchImpl = () => {
    state.count += 1;
    return Promise.resolve(new Response(JSON.stringify(fixtureJwks), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
  };
  return { state, fetchImpl };
}

function makeVerifier(overrides = {}) {
  return createAccessTokenVerifier({
    issuer: ISSUER,
    audience: AUDIENCE,
    jwksUri: 'https://idp.fixture.example/.well-known/jwks.json',
    ...overrides,
  });
}

test('returns AuthInfo including scopes for a valid locally signed token', async () => {
  const { fetchImpl } = countingJwksFetch();
  const verify = makeVerifier({ jwksFetch: fetchImpl });
  const token = mintToken();
  const authInfo = await verify(`Bearer ${token}`);
  assert.deepEqual(authInfo.scopes, ['demo:pair', 'demo:read']);
  assert.equal(authInfo.clientId, 'auth0|fixture-presenter');
  assert.deepEqual(authInfo.extra, { iss: ISSUER, sub: 'auth0|fixture-presenter' });
  assert.equal(typeof authInfo.expiresAt, 'number');
  assert.equal(authInfo.token, token);
  assert.equal(String(authInfo.resource), `${AUDIENCE}/`);
});

test('rejects missing and malformed Authorization headers without fetching keys', async () => {
  const { state, fetchImpl } = countingJwksFetch();
  const verify = makeVerifier({ jwksFetch: fetchImpl });
  await assert.rejects(() => verify(undefined), error => error instanceof TokenError && error.code === 'missing_token');
  await assert.rejects(() => verify('Token abc'), error => error instanceof TokenError && error.code === 'missing_token');
  await assert.rejects(() => verify('Bearer not-a-jwt'), error => error instanceof TokenError && error.code === 'invalid_token');
  assert.equal(state.count, 0);
});

test('rejects bad signatures, wrong issuer, wrong audience, and expiry problems', async () => {
  const { fetchImpl } = countingJwksFetch();
  const verify = makeVerifier({ jwksFetch: fetchImpl });
  const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const nowSec = Math.floor(Date.now() / 1000);
  const cases = [
    ['bad signature', mintToken({}, { key: otherKeys.privateKey })],
    ['unknown key id', mintToken({}, { kid: 'no-such-key' })],
    ['wrong issuer', mintToken({ iss: 'https://evil.example/' })],
    ['wrong audience', mintToken({ aud: 'https://other.example' })],
    ['expired', mintToken({ exp: nowSec - 3600 })],
    ['not yet valid', mintToken({ nbf: nowSec + 3600 })],
    ['missing subject', mintToken({ sub: '' })],
    ['missing expiry', mintToken({ exp: undefined })],
  ];
  for (const [label, token] of cases) {
    await assert.rejects(
      () => verify(`Bearer ${token}`),
      error => error instanceof TokenError && error.code === 'invalid_token',
      label,
    );
  }
  await assert.rejects(() => verify(`Bearer ${mintToken({ exp: nowSec - 3600 })}`), /expired/i);
});

test('rejects tokens signed with a disallowed algorithm', async () => {
  const { fetchImpl } = countingJwksFetch();
  const verify = makeVerifier({ jwksFetch: fetchImpl });
  const nowSec = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', kid: KID, typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: ISSUER, sub: 'u1', aud: AUDIENCE, exp: nowSec + 300 })).toString('base64url');
  const signature = createHmac('sha256', 'attacker-secret').update(`${header}.${payload}`).digest('base64url');
  await assert.rejects(
    () => verify(`Bearer ${header}.${payload}.${signature}`),
    error => error instanceof TokenError && error.code === 'invalid_token',
  );
});

test('unknown-key floods hit the JWKS endpoint at most once per cooldown window', async () => {
  const { state, fetchImpl } = countingJwksFetch();
  const verify = makeVerifier({ jwksFetch: fetchImpl, jwksCooldownMs: 30_000 });
  for (let index = 0; index < 5; index += 1) {
    await assert.rejects(() => verify(`Bearer ${mintToken({}, { kid: `attacker-${index}` })}`), /unknown signing key/i);
  }
  assert.equal(state.count, 1, 'one initial fetch; cooldown suppresses unknown-kid refetches');
});

test('concurrent verifications share a single JWKS fetch', async () => {
  const { state, fetchImpl } = countingJwksFetch();
  const verify = makeVerifier({ jwksFetch: fetchImpl });
  const results = await Promise.all(Array.from({ length: 5 }, (_, index) =>
    verify(`Bearer ${mintToken({ sub: `auth0|concurrent-${index}` })}`)));
  assert.equal(results.length, 5);
  assert.equal(state.count, 1);
});

test('cached keys are revalidated once the bounded cache lifetime elapses', async () => {
  const { state, fetchImpl } = countingJwksFetch();
  const verify = makeVerifier({ jwksFetch: fetchImpl, jwksCacheMaxAgeMs: 50 });
  await verify(`Bearer ${mintToken()}`);
  assert.equal(state.count, 1);
  await new Promise(resolve => setTimeout(resolve, 80));
  await verify(`Bearer ${mintToken()}`);
  assert.equal(state.count, 2, 'stale cache triggers a refetch');
});

test('JWKS fetch timeout and fetch failures yield KeysUnavailableError', async () => {
  const hangingFetch = (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('The operation timed out.', 'TimeoutError')));
  });
  const slow = makeVerifier({ jwksFetch: hangingFetch, jwksTimeoutMs: 50 });
  await assert.rejects(() => slow(`Bearer ${mintToken()}`), error => error instanceof KeysUnavailableError);

  const failingFetch = () => Promise.resolve(new Response('server error', { status: 500 }));
  const failing = makeVerifier({ jwksFetch: failingFetch });
  await assert.rejects(() => failing(`Bearer ${mintToken()}`), error => error instanceof KeysUnavailableError);

  const garbageFetch = () => Promise.resolve(new Response('not json', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const garbage = makeVerifier({ jwksFetch: garbageFetch });
  await assert.rejects(() => garbage(`Bearer ${mintToken()}`), error => error instanceof KeysUnavailableError);

  const offlineFetch = () => Promise.reject(new TypeError('fetch failed'));
  const offline = makeVerifier({ jwksFetch: offlineFetch });
  await assert.rejects(() => offline(`Bearer ${mintToken()}`), error => error instanceof KeysUnavailableError);
});
