/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Shared structured server logger. Writes one complete JSON event record per line to stdout (info) or stderr (warn/error) for collection by the systemd journal.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

const writers = {
  info: line => console.log(line),
  warn: line => console.warn(line),
  error: line => console.error(line),
};

// Each call writes exactly one JSON line: timestamp (UTC ISO 8601 with milliseconds),
// level, stable event name, optional requestId, and explicitly selected context metadata.
// Callers must pass only safe metadata; prompts, answers, conversation history, credentials,
// connection strings, and client IP addresses must never be logged.
export function logEvent(level, event, { requestId, ...context } = {}) {
  const writer = writers[level];
  if (!writer) throw new RangeError(`Unknown log level: ${level}`);
  writer(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(requestId ? { requestId } : {}),
    context,
  }));
}
