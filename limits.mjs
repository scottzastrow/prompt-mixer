/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: File-backed request rate limits (per-minute, per-IP-per-day, and site-wide per-day) for AI generation.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

const MINUTE = 60_000;
const DAY = 86_400_000;

export class RequestLimits {
  constructor(path, options = {}) {
    this.path = path;
    this.now = options.now || Date.now;
    this.perMinute = options.perMinute ?? 100;
    this.perDay = options.perDay ?? 200;
    this.sitePerDay = options.sitePerDay ?? 1000;
    this.state = null;
  }

  reserve(ip) {
    const now = this.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const state = this.load(day);
    const key = createHash('sha256').update(ip).digest('hex');
    const entry = state.clients[key] || { count: 0, recent: [] };
    const recent = entry.recent.filter(time => time > now - MINUTE);
    const nextDay = Date.parse(`${day}T00:00:00Z`) + DAY;

    if (state.total >= this.sitePerDay) {
      return { status: 429, retryAfter: Math.ceil((nextDay - now) / 1000), errorCode: 'rate_site_daily' };
    }
    if (entry.count >= this.perDay) {
      return { status: 429, retryAfter: Math.ceil((nextDay - now) / 1000), errorCode: 'rate_ip_daily' };
    }
    if (recent.length >= this.perMinute) {
      return { status: 429, retryAfter: Math.ceil((recent[0] + MINUTE - now) / 1000), errorCode: 'rate_ip_minute' };
    }

    const next = { ...state, total: state.total + 1, clients: { ...state.clients, [key]: { count: entry.count + 1, recent: [...recent, now] } } };
    const temporary = `${this.path}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
    renameSync(temporary, this.path);
    this.state = next;
    return null;
  }

  load(day) {
    if (!this.state) {
      this.state = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : { day, total: 0, clients: {} };
      if (!this.state || typeof this.state.day !== 'string' || !Number.isInteger(this.state.total) || !this.state.clients || typeof this.state.clients !== 'object') {
        throw new Error('Invalid limit state');
      }
    }
    if (this.state.day !== day) this.state = { day, total: 0, clients: {} };
    return this.state;
  }
}
