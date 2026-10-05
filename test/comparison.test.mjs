/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Unit tests for prompt assembly, preview visibility, and comparison-run behavior.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComparisonPrompts, promptPreviewVisibleAfter, runComparison } from '../comparison.mjs';

const allFields = [
  { enabled: true, input: 'near the coast', label: 'Context' },
  { enabled: true, input: 'a science teacher', label: 'Role' },
  { enabled: true, input: 'under 20 words', label: 'Constraints' },
];

test('builds a raw response followed by cumulative optional prompts in order', () => {
  assert.deepEqual(buildComparisonPrompts('  Explain tides.  ', allFields), [
    { label: 'Raw only', prompt: 'Explain tides.\n\nRespond in English. Preserve quoted text and code in their original language when appropriate.' },
    { label: 'Raw + Context', prompt: 'Explain tides.\n\nContext: near the coast\n\nRespond in English. Preserve quoted text and code in their original language when appropriate.' },
    { label: 'Raw + Context + Role', prompt: 'Explain tides.\n\nContext: near the coast\n\nRole: a science teacher\n\nRespond in English. Preserve quoted text and code in their original language when appropriate.' },
    { label: 'Raw + Context + Role + Constraints', prompt: 'Explain tides.\n\nContext: near the coast\n\nRole: a science teacher\n\nConstraints: under 20 words\n\nRespond in English. Preserve quoted text and code in their original language when appropriate.' },
  ]);
});

test('skips unchecked and blank optional fields without breaking cumulative order', () => {
  const prompts = buildComparisonPrompts('Question', [
    { enabled: false, input: 'hidden context', label: 'Context' },
    { enabled: true, input: '  ', label: 'Role' },
    { enabled: true, input: 'briefly', label: 'Constraints' },
  ]);

  assert.deepEqual(prompts, [
    { label: 'Raw only', prompt: 'Question\n\nRespond in English. Preserve quoted text and code in their original language when appropriate.' },
    { label: 'Raw + Constraints', prompt: 'Question\n\nConstraints: briefly\n\nRespond in English. Preserve quoted text and code in their original language when appropriate.' },
  ]);
  assert.deepEqual(buildComparisonPrompts('  ', allFields), []);
});

test('hides the combined-prompt preview only for valid generation and restores it on changes', () => {
  assert.equal(promptPreviewVisibleAfter('valid-generation', true), false);
  assert.equal(promptPreviewVisibleAfter('validation-failed', false), true);

  for (const event of ['input-change', 'checkbox-change', 'preset-selected', 'clear']) {
    assert.equal(promptPreviewVisibleAfter(event, false), true);
  }
});

test('preserves successful cards and continues after a request error', async () => {
  const prompts = buildComparisonPrompts('Question', allFields.slice(0, 2));
  const calls = [];
  let latest;
  const states = await runComparison(prompts, async prompt => {
    calls.push(prompt);
    if (prompt === prompts[1].prompt) throw new Error('Temporary upstream failure.');
    return 'Raw answer';
  }, next => { latest = next; }, () => true);

  assert.equal(calls.length, 3);
  assert.equal(states[0].status, 'success');
  assert.equal(states[0].response, 'Raw answer');
  assert.equal(states[1].status, 'error');
  assert.equal(states[1].error, 'Temporary upstream failure.');
  assert.equal(states[2].status, 'success');
  assert.equal(latest[0].response, 'Raw answer');
});

test('stops after a rate-limit response and marks remaining cards unsent', async () => {
  const prompts = buildComparisonPrompts('Question', allFields);
  const calls = [];
  const states = await runComparison(prompts, async prompt => {
    calls.push(prompt);
    if (calls.length === 2) {
      const error = new Error('Rate limit reached.');
      error.status = 429;
      throw error;
    }
    return 'Answer';
  }, () => {}, () => true);

  assert.equal(calls.length, 2);
  assert.equal(states[0].status, 'success');
  assert.equal(states[1].status, 'error');
  assert.equal(states[2].error, 'Not sent because a rate limit was reached.');
  assert.equal(states[3].error, 'Not sent because a rate limit was reached.');
});

test('ignores late responses and does not send later prompts after cancellation', async () => {
  const prompts = buildComparisonPrompts('Question', allFields);
  let current = true;
  let releaseRequest;
  const updates = [];
  const running = runComparison(prompts, () => new Promise(resolve => { releaseRequest = resolve; }),
    states => updates.push(states), () => current);

  await new Promise(resolve => setImmediate(resolve));
  current = false;
  releaseRequest('Stale answer');
  const states = await running;

  assert.equal(states[0].status, 'loading');
  assert.equal(states[0].response, '');
  assert.equal(states[1].status, 'waiting');
  assert.equal(updates.at(-1)[0].status, 'loading');
});

test('adds the selected language instruction to every cumulative prompt, including raw only', () => {
  const prompts = buildComparisonPrompts('Question', allFields.slice(0, 2), 'ja');
  const instruction = '日本語で回答してください。必要に応じて、引用文とコードは元の言語のまま保持してください。';

  assert.deepEqual(prompts.map(({ label }) => label), [
    '基本プロンプトのみ', '基本プロンプト + 背景', '基本プロンプト + 背景 + 役割',
  ]);
  for (const prompt of prompts) assert.ok(prompt.prompt.endsWith(instruction));
  assert.equal(prompts[0].prompt, `Question\n\n${instruction}`);
});