/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Unit tests for the milestone-1 in-memory fixture demo store: pairing expiry, single use, attempt lockout, activation, unpair/revocation, session expiry, and identity-bound isolation, with injected time.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureDemoStore, normalizePairingCode } from '../demo-fixture-store.mjs';

const CODE = 'ABCD-EFGH';
const PRESENTER = { iss: 'https://idp.fixture.example/', sub: 'auth0|presenter-1' };
const STRANGER = { iss: 'https://idp.fixture.example/', sub: 'auth0|stranger-2' };

function makeStore(overrides = {}) {
  let currentTime = overrides.start ?? 1_760_000_000_000;
  const store = createFixtureDemoStore({
    pairingCode: CODE,
    now: () => currentTime,
    sessionTtlMs: 24 * 3_600_000,
    codeTtlMs: 300_000,
    maxCodeAttempts: 5,
    ...overrides.storeOptions,
  });
  return { store, advance: ms => { currentTime += ms; }, setTime: ms => { currentTime = ms; } };
}

test('normalizes grouped pairing codes for hashing', () => {
  assert.equal(normalizePairingCode('abcd-efgh'), 'ABCDEFGH');
  assert.equal(normalizePairingCode('  ABCD EFGH '), 'ABCDEFGH');
  assert.equal(normalizePairingCode('ABCD-EFGH'), 'ABCDEFGH');
});

test('requires a fixture pairing code', () => {
  assert.throws(() => createFixtureDemoStore({}), /pairing code/i);
});

test('pairs with the correct code and enforces single use', () => {
  const { store } = makeStore();
  const paired = store.pair({ code: CODE, ...PRESENTER });
  assert.deepEqual(paired, { ok: true, state: 'paired', sessionId: 'fixture-session-1' });

  // The code is consumed: even after unpairing, it cannot pair again.
  store.unpair(PRESENTER);
  const reuse = store.pair({ code: CODE, ...STRANGER });
  assert.deepEqual(reuse, { ok: false, reason: 'used' });
});

test('locks the code after the failed-attempt cap', () => {
  const { store } = makeStore();
  for (let index = 0; index < 4; index += 1) {
    const attempt = store.pair({ code: 'XXXX-YYYY', ...PRESENTER });
    assert.equal(attempt.ok, false);
    assert.equal(attempt.reason, 'invalid_code');
    assert.equal(attempt.attemptsRemaining, 4 - index);
  }
  const fifth = store.pair({ code: 'XXXX-YYYY', ...PRESENTER });
  assert.deepEqual(fifth, { ok: false, reason: 'invalid_code', attemptsRemaining: 0 });
  const correct = store.pair({ code: CODE, ...PRESENTER });
  assert.deepEqual(correct, { ok: false, reason: 'locked' });
});

test('rejects an expired pairing code', () => {
  const { store, advance } = makeStore();
  advance(300_001);
  const attempt = store.pair({ code: CODE, ...PRESENTER });
  assert.deepEqual(attempt, { ok: false, reason: 'expired_code' });
});

test('rejects pairing while another identity holds the binding', () => {
  const { store } = makeStore();
  assert.equal(store.pair({ code: CODE, ...PRESENTER }).ok, true);
  const busy = store.pair({ code: CODE, ...STRANGER });
  assert.deepEqual(busy, { ok: false, reason: 'session_busy' });
  const again = store.pair({ code: CODE, ...PRESENTER });
  assert.deepEqual(again, { ok: false, reason: 'already_paired', state: 'paired' });
});

test('activation gates retrieval and unpair revokes it immediately', () => {
  const { store } = makeStore();

  assert.deepEqual(store.getSessionView(PRESENTER), { ok: false, reason: 'pairing_required' });
  assert.deepEqual(store.activate(PRESENTER), { ok: false, reason: 'pairing_required' });

  store.pair({ code: CODE, ...PRESENTER });
  assert.deepEqual(store.listRuns(PRESENTER), { ok: false, reason: 'activation_required' });

  assert.deepEqual(store.activate(PRESENTER), { ok: true, state: 'live', sessionId: 'fixture-session-1' });
  // Activation is idempotent.
  assert.deepEqual(store.activate(PRESENTER), { ok: true, state: 'live', sessionId: 'fixture-session-1' });

  const sessionView = store.getSessionView(PRESENTER);
  assert.equal(sessionView.ok, true);
  assert.equal(sessionView.session.state, 'live');
  assert.equal(sessionView.session.runCount, 1);

  const unpaired = store.unpair(PRESENTER);
  assert.deepEqual(unpaired, { ok: true, state: 'offline', changed: true });
  assert.deepEqual(store.getSessionView(PRESENTER), { ok: false, reason: 'pairing_required' });

  // Unpairing with no binding is a harmless no-op confirmation.
  assert.deepEqual(store.unpair(PRESENTER), { ok: true, state: 'offline', changed: false });
});

test('a second identity is fully isolated from the bound session', () => {
  const { store } = makeStore();
  store.pair({ code: CODE, ...PRESENTER });
  store.activate(PRESENTER);

  assert.deepEqual(store.getSessionView(STRANGER), { ok: false, reason: 'pairing_required' });
  assert.deepEqual(store.listRuns(STRANGER), { ok: false, reason: 'pairing_required' });
  assert.deepEqual(store.getRun(STRANGER, 'fixture-run-1'), { ok: false, reason: 'pairing_required' });
  assert.deepEqual(store.activate(STRANGER), { ok: false, reason: 'pairing_required' });

  // Foreign run identifiers are indistinguishable from unknown ones.
  assert.deepEqual(store.getRun(PRESENTER, 'fixture-run-foreign'), { ok: false, reason: 'not_found' });
  assert.deepEqual(store.getRun(PRESENTER, 'no-such-run'), { ok: false, reason: 'not_found' });
});

test('returns run contents in order with verbatim statuses and no code material', () => {
  const { store } = makeStore();
  store.pair({ code: CODE, ...PRESENTER });
  store.activate(PRESENTER);

  const runs = store.listRuns(PRESENTER);
  assert.equal(runs.ok, true);
  assert.deepEqual(runs.runs.map(run => run.id), ['fixture-run-1']);

  const detail = store.getRun(PRESENTER, 'fixture-run-1');
  assert.equal(detail.ok, true);
  assert.deepEqual(detail.run.cards.map(card => card.cardSeq), [1, 2]);
  assert.deepEqual(detail.run.cards[1].turns.map(turn => turn.status), ['success', 'superseded']);
  assert.match(detail.run.cards[0].exactPrompt, /^Synthetic fixture prompt/);
  assert.match(detail.run.cards[0].answer, /^Synthetic fixture answer/);

  // Retrieval output never exposes the pairing code in any form.
  const serialized = JSON.stringify(detail) + JSON.stringify(runs) + JSON.stringify(store.getSessionView(PRESENTER));
  assert.ok(!serialized.includes(normalizePairingCode(CODE)));
  assert.ok(!serialized.includes(CODE));
});

test('session expiry terminates pairing, activation, and retrieval', () => {
  const { store, advance } = makeStore();
  store.pair({ code: CODE, ...PRESENTER });
  store.activate(PRESENTER);
  advance(24 * 3_600_000 + 1);

  assert.deepEqual(store.getSessionView(PRESENTER), { ok: false, reason: 'session_expired' });
  assert.deepEqual(store.activate(PRESENTER), { ok: false, reason: 'session_expired' });
  assert.deepEqual(store.pair({ code: CODE, ...STRANGER }), { ok: false, reason: 'session_expired' });
});

test('administrative revocation terminates access immediately', () => {
  const { store } = makeStore();
  store.pair({ code: CODE, ...PRESENTER });
  store.activate(PRESENTER);
  assert.equal(store.revokeSession('fixture-session-1'), true);
  assert.deepEqual(store.getSessionView(PRESENTER), { ok: false, reason: 'session_revoked' });
  assert.equal(store.revokeSession('no-such-session'), false);
});
