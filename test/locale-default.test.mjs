/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Tests for browser-based default language selection and its initialization wiring.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPreferredLocale } from '../i18n.mjs';

test('saved choice takes priority over browser preferences', () => {
  assert.equal(detectPreferredLocale('ja', { languages: ['en-US'], language: 'en-US' }), 'ja');
  assert.equal(detectPreferredLocale('en', { languages: ['ja-JP'], language: 'ja-JP' }), 'en');
});

test('follows navigator.languages preference order', () => {
  assert.equal(detectPreferredLocale(null, { languages: ['fr-FR', 'ja-JP', 'en-US'], language: 'en-US' }), 'ja');
  assert.equal(detectPreferredLocale(null, { languages: ['fr-FR', 'en-US', 'ja-JP'], language: 'ja-JP' }), 'en');
});

test('maps regional language tags case-insensitively', () => {
  assert.equal(detectPreferredLocale(null, { languages: ['en'] }), 'en');
  assert.equal(detectPreferredLocale(null, { languages: ['EN-gb'] }), 'en');
  assert.equal(detectPreferredLocale(null, { languages: ['ja'] }), 'ja');
  assert.equal(detectPreferredLocale(null, { languages: ['JA-JP'] }), 'ja');
});

test('uses navigator.language when the language list is unavailable or empty', () => {
  assert.equal(detectPreferredLocale(null, { language: 'ja-JP' }), 'ja');
  assert.equal(detectPreferredLocale(null, { languages: [], language: 'JA-jp' }), 'ja');
  assert.equal(detectPreferredLocale(null, { languages: undefined, language: 'en-US' }), 'en');
});

test('skips unsupported languages and defaults to English', () => {
  assert.equal(detectPreferredLocale(null, { languages: ['fr-FR', 'de-DE'], language: 'fr-FR' }), 'en');
  assert.equal(detectPreferredLocale(null, { languages: ['fr-FR', 'de-DE'], language: 'ja-JP' }), 'en',
    'a nonempty unsupported list does not consult navigator.language');
});

test('ignores invalid saved values and detects from the browser', () => {
  assert.equal(detectPreferredLocale('fr', { languages: ['ja-JP'] }), 'ja');
  assert.equal(detectPreferredLocale('EN', { languages: ['ja'] }), 'ja');
  assert.equal(detectPreferredLocale('', { languages: ['en-US'] }), 'en');
  assert.equal(detectPreferredLocale(42, { language: 'ja' }), 'ja');
});

test('handles unavailable browser language information', () => {
  assert.equal(detectPreferredLocale(null, undefined), 'en');
  assert.equal(detectPreferredLocale(null, {}), 'en');
  assert.equal(detectPreferredLocale(null, { languages: undefined, language: undefined }), 'en');
  assert.equal(detectPreferredLocale(null, { languages: [undefined, null, 42], language: undefined }), 'en');
  assert.equal(detectPreferredLocale(null, { languages: 'en-US', language: 'en-US' }), 'en',
    'a non-array languages value falls back to navigator.language');
});

class FakeElement {
  constructor(tagName = '') {
    this.tagName = tagName;
    this.value = '';
    this.checked = false;
    this.hidden = false;
    this.disabled = false;
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.classes = new Set();
    this.scrollHeight = 300;
    this.clientHeight = 150;
    this.classList = {
      add: name => this.classes.add(name),
      toggle: (name, force) => force === undefined
        ? (this.classes.has(name) ? this.classes.delete(name) : this.classes.add(name))
        : (force ? this.classes.add(name) : this.classes.delete(name)),
    };
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  trigger(type) {
    let result;
    for (const listener of this.listeners.get(type) || []) result = listener({ preventDefault() {} });
    return result;
  }

  setAttribute(name, value) { this.attributes[name] = value; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setCustomValidity() {}
  reportValidity() {}
  focus() {}
}

const elementIds = [
  'prompt-form', 'raw-prompt', 'preset-select', 'clear-button', 'language-select', 'output-text',
  'generate-response', 'response-status', 'response-cards', 'include-context',
  'context-input', 'include-role', 'role-input', 'include-constraints', 'constraints-input',
];

let importCount = 0;

async function loadScriptWithEnvironment({ saved, storageThrows = false, navigatorInfo } = {}) {
  const elements = new Map(elementIds.map(id => [id, new FakeElement()]));
  const savedLocales = new Map();
  if (saved !== undefined) savedLocales.set('prompt-mixer-language', saved);
  const previousDocument = globalThis.document;
  const previousStorage = globalThis.localStorage;
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const previousPdfMake = globalThis.pdfMake;

  globalThis.localStorage = storageThrows
    ? {
      getItem() { throw new Error('storage denied'); },
      setItem() { throw new Error('storage denied'); },
    }
    : {
      getItem: key => savedLocales.get(key) ?? null,
      setItem: (key, value) => savedLocales.set(key, value),
    };
  Object.defineProperty(globalThis, 'navigator', {
    value: navigatorInfo,
    configurable: true,
    writable: true,
  });
  const outputSection = new FakeElement('section');
  const responseSection = new FakeElement('section');
  const document = {
    documentElement: { lang: '' },
    getElementById: id => elements.get(id),
    querySelector: selector => selector === '.output-section' ? outputSection : responseSection,
    querySelectorAll: () => [],
    createElement: tagName => new FakeElement(tagName),
  };
  globalThis.document = document;
  globalThis.pdfMake = { addFonts: () => {} };

  await import(`../script.js?locale-default-test-${++importCount}`);

  return {
    elements,
    savedLocales,
    document,
    restore() {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = previousStorage;
      if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
      else delete globalThis.navigator;
      if (previousPdfMake === undefined) delete globalThis.pdfMake;
      else globalThis.pdfMake = previousPdfMake;
    },
  };
}

test('initialization honors a valid saved choice over browser preferences', async () => {
  const env = await loadScriptWithEnvironment({ saved: 'ja', navigatorInfo: { languages: ['en-US'], language: 'en-US' } });
  try {
    assert.equal(env.elements.get('language-select').value, 'ja');
    assert.equal(env.document.documentElement.lang, 'ja');
  } finally {
    env.restore();
  }
});

test('initialization detects the first supported browser preference without persisting it', async () => {
  const env = await loadScriptWithEnvironment({ navigatorInfo: { languages: ['fr-FR', 'JA-jp', 'en-US'], language: 'en-US' } });
  try {
    const languageSelect = env.elements.get('language-select');
    assert.equal(languageSelect.value, 'ja', 'the first supported preference wins');
    assert.equal(env.document.documentElement.lang, 'ja');
    assert.equal(env.savedLocales.has('prompt-mixer-language'), false,
      'an automatically detected default is not saved as an explicit choice');

    languageSelect.value = 'en';
    languageSelect.trigger('change');
    assert.equal(env.savedLocales.get('prompt-mixer-language'), 'en', 'an explicit selection persists');
    assert.equal(env.document.documentElement.lang, 'en');
  } finally {
    env.restore();
  }
});

test('initialization defaults to English for unsupported browser preferences', async () => {
  const env = await loadScriptWithEnvironment({ navigatorInfo: { languages: ['fr-FR', 'de-DE'], language: 'fr-FR' } });
  try {
    assert.equal(env.elements.get('language-select').value, 'en');
    assert.equal(env.savedLocales.has('prompt-mixer-language'), false, 'the English fallback is not persisted');
  } finally {
    env.restore();
  }
});

test('initialization ignores an invalid saved value and detects from the browser', async () => {
  const env = await loadScriptWithEnvironment({ saved: 'fr', navigatorInfo: { languages: ['ja-JP'] } });
  try {
    assert.equal(env.elements.get('language-select').value, 'ja');
  } finally {
    env.restore();
  }
});

test('initialization survives unavailable storage and still detects the browser language', async () => {
  const env = await loadScriptWithEnvironment({ storageThrows: true, navigatorInfo: { languages: ['ja-JP'], language: 'ja-JP' } });
  try {
    assert.equal(env.elements.get('language-select').value, 'ja');
  } finally {
    env.restore();
  }
});

test('initialization defaults to English when browser language information is unavailable', async () => {
  const env = await loadScriptWithEnvironment({ navigatorInfo: undefined });
  try {
    assert.equal(env.elements.get('language-select').value, 'en');
    assert.equal(env.document.documentElement.lang, 'en');
  } finally {
    env.restore();
  }
});
