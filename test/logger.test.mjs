/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Unit tests for the shared structured server logger (JSON lines, levels, timestamps, correlation fields).
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { logEvent } from '../logger.mjs';

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function captureOutput() {
  const lines = { stdout: [], stderr: [] };
  const original = { log: console.log, warn: console.warn, error: console.error };
  console.log = line => lines.stdout.push(String(line));
  console.warn = line => lines.stderr.push(String(line));
  console.error = line => lines.stderr.push(String(line));
  return {
    lines,
    restore: () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

test('writes one complete JSON record per line with timestamp, level, event, requestId, and context', () => {
  const { lines, restore } = captureOutput();
  try {
    logEvent('info', 'server_start', { host: '127.0.0.1', port: 8081 });
    logEvent('error', 'db_write_failed', { requestId: 'req-123', errorName: 'Error' });
  } finally {
    restore();
  }

  assert.equal(lines.stdout.length, 1);
  assert.equal(lines.stderr.length, 1);
  for (const line of [...lines.stdout, ...lines.stderr]) {
    assert.ok(!line.includes('\n'), 'each record is a single line');
  }

  const startup = JSON.parse(lines.stdout[0]);
  assert.equal(Object.keys(startup).length, 4);
  assert.match(startup.timestamp, TIMESTAMP_PATTERN);
  assert.equal(startup.level, 'info');
  assert.equal(startup.event, 'server_start');
  assert.deepEqual(startup.context, { host: '127.0.0.1', port: 8081 });

  const correlated = JSON.parse(lines.stderr[0]);
  assert.equal(correlated.level, 'error');
  assert.equal(correlated.event, 'db_write_failed');
  assert.equal(correlated.requestId, 'req-123');
  assert.deepEqual(correlated.context, { errorName: 'Error' });
  assert.ok(!('requestId' in correlated.context), 'requestId is a top-level field');
});

test('uses UTC ISO 8601 timestamps with millisecond precision', () => {
  const { lines, restore } = captureOutput();
  try {
    logEvent('info', 'timestamp_check', {});
  } finally {
    restore();
  }
  const { timestamp } = JSON.parse(lines.stdout[0]);
  assert.match(timestamp, TIMESTAMP_PATTERN);
  const parsed = Date.parse(timestamp);
  assert.ok(!Number.isNaN(parsed), 'timestamp parses as a valid date');
  assert.equal(new Date(parsed).toISOString(), timestamp, 'timestamp round-trips exactly');
});

test('routes info records to stdout and warn/error records to stderr', () => {
  const { lines, restore } = captureOutput();
  try {
    logEvent('info', 'info_event', {});
    logEvent('warn', 'warn_event', {});
    logEvent('error', 'error_event', {});
  } finally {
    restore();
  }
  assert.deepEqual(lines.stdout.map(line => JSON.parse(line).event), ['info_event']);
  assert.deepEqual(lines.stderr.map(line => JSON.parse(line).event), ['warn_event', 'error_event']);
});

test('rejects unknown log levels', () => {
  assert.throws(() => logEvent('debug', 'nope', {}), RangeError);
});
