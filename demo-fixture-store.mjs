/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: In-memory demo-session store for milestone 1 of the paired demo-context bridge. Serves clearly labeled synthetic fixture data only, and enforces the pairing lifecycle (expiry, single use, attempt lockout, activation, immediate unpair/revocation) with identity-bound isolation. No database, no real conversation capture.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import { createHash, timingSafeEqual } from 'node:crypto';

export const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // unambiguous: no 0/O/1/I/L
const DEFAULT_SESSION_TTL_MS = 24 * 3_600_000; // 24 hours
const DEFAULT_CODE_TTL_MS = 300_000; // 5 minutes
const DEFAULT_MAX_CODE_ATTEMPTS = 5;

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// Accepts the grouped 4-4 display form ("ABCD-EFGH") as well as the bare form.
export function normalizePairingCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function codeHash(code) {
  return sha256(normalizePairingCode(code));
}

function hashEquals(leftHex, rightHex) {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

// Builds the synthetic conversation served by milestone 1. All text is labeled
// fixture content; nothing here comes from a real prompt, answer, or AI call.
function fixtureRuns(createdAt) {
  return [
    {
      id: 'fixture-run-1',
      runSeq: 1,
      locale: 'en',
      createdAt,
      cards: [
        {
          id: 'fixture-card-1',
          cardSeq: 1,
          label: 'Raw only',
          exactPrompt: 'Synthetic fixture prompt (not user data): "Explain recursion in one short paragraph."\n\nRespond in English.',
          answer: 'Synthetic fixture answer (not AI-generated): recursion is a technique where a function solves a problem by calling itself on a smaller input until it reaches a base case.',
          model: 'fixture-model',
          status: 'success',
          createdAt,
          completedAt: createdAt + 1000,
          turns: [],
        },
        {
          id: 'fixture-card-2',
          cardSeq: 2,
          label: 'With Context',
          exactPrompt: 'Synthetic fixture prompt (not user data): "Context: the audience is new programmers. Explain recursion in one short paragraph."\n\nRespond in English.',
          answer: 'Synthetic fixture answer (not AI-generated): think of recursion like a set of nesting dolls — each call opens a smaller doll until the smallest one stops the chain.',
          model: 'fixture-model',
          status: 'success',
          createdAt,
          completedAt: createdAt + 2000,
          turns: [
            {
              id: 'fixture-turn-1',
              turnSeq: 1,
              submittedPrompt: 'Synthetic fixture follow-up prompt (not user data): "Show a tiny factorial example."',
              completedAnswer: 'Synthetic fixture follow-up answer (not AI-generated): factorial(n) returns 1 when n is 0, otherwise n times factorial(n - 1).',
              offerText: 'Synthetic fixture offer: "Want a concrete factorial example?"',
              status: 'success',
              createdAt,
              completedAt: createdAt + 3000,
            },
            {
              id: 'fixture-turn-2',
              turnSeq: 2,
              submittedPrompt: 'Synthetic fixture follow-up prompt (not user data): "Now show the expected output for factorial(4)."',
              completedAnswer: 'Synthetic fixture follow-up answer (not AI-generated): the expected output is 24.',
              offerText: 'Synthetic fixture offer: "Want the expected output for factorial(4)?"',
              status: 'superseded',
              createdAt,
              completedAt: createdAt + 4000,
            },
          ],
        },
      ],
    },
  ];
}

// Creates the milestone-1 store: one pairable synthetic session plus one foreign
// synthetic session that can never be paired or retrieved, proving that unknown
// and foreign identifiers are indistinguishable. `now` is injectable so tests
// can advance time across expiry boundaries without waiting.
export function createFixtureDemoStore({ pairingCode, now = Date.now, sessionTtlMs = DEFAULT_SESSION_TTL_MS, codeTtlMs = DEFAULT_CODE_TTL_MS, maxCodeAttempts = DEFAULT_MAX_CODE_ATTEMPTS } = {}) {
  if (typeof pairingCode !== 'string' || !normalizePairingCode(pairingCode)) {
    throw new RangeError('A fixture pairing code is required');
  }
  const createdAt = now();
  const session = {
    id: 'fixture-session-1',
    locale: 'en',
    createdAt,
    expiresAt: createdAt + sessionTtlMs,
    revoked: false,
    binding: null, // { iss, sub, state: 'paired' | 'live', pairedAt, activatedAt }
    pairingCode: {
      hash: codeHash(pairingCode),
      createdAt,
      expiresAt: createdAt + codeTtlMs,
      usedAt: null,
      attempts: 0,
      locked: false,
    },
    runs: fixtureRuns(createdAt),
  };
  const foreignSession = {
    id: 'fixture-session-foreign',
    locale: 'en',
    createdAt,
    expiresAt: createdAt + sessionTtlMs,
    revoked: false,
    binding: null,
    pairingCode: null,
    runs: [
      { id: 'fixture-run-foreign', runSeq: 1, locale: 'en', createdAt, cards: [] },
    ],
  };
  const sessions = new Map([[session.id, session], [foreignSession.id, foreignSession]]);

  const identityKey = ({ iss, sub }) => sha256(`${iss}|${sub}`);
  const iso = ms => new Date(ms).toISOString();

  function availability(s) {
    if (s.revoked) return 'session_revoked';
    if (now() > s.expiresAt) return 'session_expired';
    return null;
  }

  // Retrieval gate: the caller's identity must hold a live binding on a
  // still-valid session. Failures are pairing-required style results, never
  // OAuth challenges — the identity is already authenticated.
  function boundLiveSession(identity) {
    const key = identityKey(identity);
    for (const s of sessions.values()) {
      if (s.binding && identityKey(s.binding) === key) {
        const unavailable = availability(s);
        if (unavailable) return { error: unavailable };
        if (s.binding.state !== 'live') return { error: 'activation_required' };
        return { session: s };
      }
    }
    return { error: 'pairing_required' };
  }

  return {
    fixtureSessionId: session.id,

    pair({ code, iss, sub }) {
      const unavailable = availability(session);
      if (unavailable) return { ok: false, reason: unavailable };
      if (session.binding) {
        const sameIdentity = session.binding.iss === iss && session.binding.sub === sub;
        return sameIdentity
          ? { ok: false, reason: 'already_paired', state: session.binding.state }
          : { ok: false, reason: 'session_busy' };
      }
      const entry = session.pairingCode;
      if (entry.locked) return { ok: false, reason: 'locked' };
      if (entry.usedAt !== null) return { ok: false, reason: 'used' };
      if (now() > entry.expiresAt) return { ok: false, reason: 'expired_code' };
      if (!hashEquals(codeHash(code), entry.hash)) {
        entry.attempts += 1;
        if (entry.attempts >= maxCodeAttempts) entry.locked = true;
        return { ok: false, reason: 'invalid_code', attemptsRemaining: Math.max(0, maxCodeAttempts - entry.attempts) };
      }
      entry.usedAt = now();
      session.binding = { iss, sub, state: 'paired', pairedAt: now(), activatedAt: null };
      return { ok: true, state: 'paired', sessionId: session.id };
    },

    activate({ iss, sub }) {
      const key = identityKey({ iss, sub });
      for (const s of sessions.values()) {
        if (s.binding && identityKey(s.binding) === key) {
          const unavailable = availability(s);
          if (unavailable) return { ok: false, reason: unavailable };
          if (s.binding.state === 'paired') {
            s.binding.state = 'live';
            s.binding.activatedAt = now();
          }
          return { ok: true, state: 'live', sessionId: s.id };
        }
      }
      return { ok: false, reason: 'pairing_required' };
    },

    unpair({ iss, sub }) {
      const key = identityKey({ iss, sub });
      for (const s of sessions.values()) {
        if (s.binding && identityKey(s.binding) === key) {
          s.binding = null;
          return { ok: true, state: 'offline', changed: true };
        }
      }
      return { ok: true, state: 'offline', changed: false };
    },

    // Administrative revocation hook used by the future browser revoke route.
    // The binding is retained so the holder sees session_revoked rather than a
    // fresh pairing-required state.
    revokeSession(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return false;
      s.revoked = true;
      return true;
    },

    getSessionView(identity) {
      const { session: s, error } = boundLiveSession(identity);
      if (error) return { ok: false, reason: error };
      return {
        ok: true,
        session: {
          id: s.id,
          state: s.binding.state,
          locale: s.locale,
          createdAt: iso(s.createdAt),
          expiresAt: iso(s.expiresAt),
          pairedAt: iso(s.binding.pairedAt),
          activatedAt: s.binding.activatedAt === null ? null : iso(s.binding.activatedAt),
          runCount: s.runs.length,
        },
      };
    },

    listRuns(identity) {
      const { session: s, error } = boundLiveSession(identity);
      if (error) return { ok: false, reason: error };
      return {
        ok: true,
        sessionId: s.id,
        runs: s.runs.map(run => ({
          id: run.id,
          runSeq: run.runSeq,
          locale: run.locale,
          createdAt: iso(run.createdAt),
          cardCount: run.cards.length,
        })),
      };
    },

    getRun(identity, runId) {
      const { session: s, error } = boundLiveSession(identity);
      if (error) return { ok: false, reason: error };
      const run = s.runs.find(candidate => candidate.id === runId);
      if (!run) return { ok: false, reason: 'not_found' };
      return { ok: true, sessionId: s.id, run: structuredClone(run) };
    },
  };
}
