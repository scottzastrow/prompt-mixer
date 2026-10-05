/*
 * Project: Prompt Mixer
 * Author: Scott Zastrow
 * Course: SEIS 606 — University of St. Thomas
 * Description: Browser logic that assembles prompt variants, calls the server for AI responses, and renders comparisons, follow-ups, and PDF downloads.
 * Copyright (c) 2026 Scott Zastrow
 * SPDX-License-Identifier: MIT
 */

import { buildComparisonPrompts, promptPreviewVisibleAfter, runComparison } from './comparison.mjs';
import { detectPreferredLocale, getPreset, normalizeLocale, serverErrorMessage, translate } from './i18n.mjs';

const form = document.getElementById('prompt-form');
const rawPromptInput = document.getElementById('raw-prompt');
const presetSelect = document.getElementById('preset-select');
const clearButton = document.getElementById('clear-button');
const languageSelect = document.getElementById('language-select');
function readSavedLocale() {
  try {
    return globalThis.localStorage?.getItem('prompt-mixer-language');
  } catch {
    return null;
  }
}
let locale = 'en';
try {
  locale = detectPreferredLocale(readSavedLocale(), globalThis.navigator);
} catch {
  locale = 'en';
}
const outputText = document.getElementById('output-text');
const outputSection = document.querySelector('.output-section');
const generateButton = document.getElementById('generate-response');
const responseSection = document.querySelector('.response-section');
const responseStatus = document.getElementById('response-status');
const responseCards = document.getElementById('response-cards');
let activeRun = null;
let responseRevision = 0;
const activeFollowUps = new Set();
const japaneseCharacterClass = String.raw`[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script_Extensions=Hiragana}\p{Script_Extensions=Katakana}\u3000-\u303f\uff00-\uffef]`;
const japaneseCharacterPattern = new RegExp(japaneseCharacterClass, 'u');
const japaneseRunPattern = new RegExp(`(${japaneseCharacterClass}+)`, 'gu');
const pdfJapaneseFontFile = 'NotoSansJP-Regular.otf';
let pdfJapaneseFontPromise;

function applyTranslations() {
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = translate(locale, element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.placeholder = translate(locale, element.dataset.i18nPlaceholder);
  });
  presetSelect.setAttribute('aria-label', translate(locale, 'choosePreset'));
  clearButton.setAttribute('aria-label', translate(locale, 'clearAria'));
  languageSelect.setAttribute('aria-label', translate(locale, 'languageAria'));
}

languageSelect.value = locale;
applyTranslations();

globalThis.pdfMake.addFonts({
  NotoSansJP: {
    normal: pdfJapaneseFontFile,
    bold: pdfJapaneseFontFile,
    italics: pdfJapaneseFontFile,
    bolditalics: pdfJapaneseFontFile,
  },
});

async function loadPdfJapaneseFont() {
  if (!pdfJapaneseFontPromise) {
    pdfJapaneseFontPromise = fetch('/fonts/NotoSansJP-Regular.otf')
      .then(async response => {
        if (!response.ok) throw new Error('Could not load the Japanese PDF font.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
        }
        globalThis.pdfMake.addVirtualFileSystem({ [pdfJapaneseFontFile]: btoa(binary) });
      })
      .catch(error => {
        pdfJapaneseFontPromise = null;
        throw error;
      });
  }
  return pdfJapaneseFontPromise;
}

function pdfTextRuns(text) {
  return text.split(japaneseRunPattern)
    .filter(Boolean)
    .map(run => ({
      text: run,
      font: japaneseCharacterPattern.test(run) ? 'NotoSansJP' : 'Roboto',
    }));
}

function getOptionalFieldConfigs() {
  return [
    {
      enabled: document.getElementById('include-context'),
      input: document.getElementById('context-input'),
      label: 'context',
    },
    {
      enabled: document.getElementById('include-role'),
      input: document.getElementById('role-input'),
      label: 'role',
    },
    {
      enabled: document.getElementById('include-constraints'),
      input: document.getElementById('constraints-input'),
      label: 'constraints',
    },
  ];
}

function updateOptionalCheckbox({ enabled, input }) {
  const hasText = input.value.trim() !== '';

  if (!hasText) {
    enabled.checked = false;
    return;
  }

  enabled.checked = true;
}

getOptionalFieldConfigs().forEach(({ enabled, input }) => {
  let manuallyUnchecked = false;

  enabled.addEventListener('change', () => {
    const hasText = input.value.trim() !== '';
    manuallyUnchecked = !enabled.checked && hasText;
    clearResponse();
    renderPrompt();
  });

  input.addEventListener('input', () => {
    const hasText = input.value.trim() !== '';

    if (!hasText) {
      enabled.checked = false;
      manuallyUnchecked = false;
    } else if (manuallyUnchecked) {
      enabled.checked = true;
      manuallyUnchecked = false;
    } else {
      updateOptionalCheckbox({ enabled, input });
    }

    clearResponse();
    renderPrompt();
  });
});

function currentOptionalFields() {
  return getOptionalFieldConfigs().map(({ enabled, input, label }) => ({
    enabled: enabled.checked,
    input: input.value,
    label,
  }));
}

function buildPrompt() {
  const prompts = buildComparisonPrompts(rawPromptInput.value, currentOptionalFields(), locale);
  return prompts.at(-1)?.prompt ?? null;
}

function renderPrompt() {
  const assembledPrompt = buildPrompt();

  if (!assembledPrompt) {
    outputText.textContent = translate(locale, 'ready');
    rawPromptInput.setCustomValidity('');
    return null;
  }

  rawPromptInput.setCustomValidity('');
  outputText.textContent = assembledPrompt;
  return assembledPrompt;
}

function updatePromptPreviewVisibility(event) {
  outputSection.hidden = !promptPreviewVisibleAfter(event, !outputSection.hidden);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  renderPrompt();
});

function clearResponse() {
  responseRevision++;
  if (activeRun) {
    activeRun.controller.abort();
    activeRun = null;
  }
  activeFollowUps.forEach(controller => controller.abort());
  activeFollowUps.clear();
  generateButton.disabled = false;
  responseSection.setAttribute('aria-busy', 'false');
  responseCards.replaceChildren();
  responseCards.hidden = true;
  responseStatus.textContent = translate(locale, 'initialStatus');
}

function clearOutputs() {
  clearResponse();
  outputText.textContent = translate(locale, 'ready');
}

form.addEventListener('input', () => {
  updatePromptPreviewVisibility('input-change');
  clearResponse();
  renderPrompt();
});
form.addEventListener('change', () => {
  updatePromptPreviewVisibility('checkbox-change');
  clearResponse();
  renderPrompt();
});

clearButton.addEventListener('click', () => {
  updatePromptPreviewVisibility('clear');
  form.reset();
  presetSelect.value = '';
  rawPromptInput.setCustomValidity('');
  clearOutputs();
  rawPromptInput.focus();
});

languageSelect.addEventListener('change', () => {
  locale = normalizeLocale(languageSelect.value);
  try {
    globalThis.localStorage?.setItem('prompt-mixer-language', locale);
  } catch {}
  applyTranslations();
  updatePromptPreviewVisibility('language-change');
  clearResponse();
  renderPrompt();
});

presetSelect.addEventListener('change', () => {
  updatePromptPreviewVisibility('preset-selected');
  clearResponse();
  const preset = getPreset(locale, presetSelect.value);
  if (!preset) return;

  rawPromptInput.value = preset.prompt;
  rawPromptInput.setCustomValidity('');
  getOptionalFieldConfigs().forEach(({ enabled, input, label }) => {
    const value = preset[label.toLowerCase()] || '';
    input.value = value;
    enabled.checked = value.trim() !== '';
  });

  renderPrompt();
  rawPromptInput.focus();
});

generateButton.addEventListener('click', async () => {
  if (activeRun) return;

  const combinedPrompt = renderPrompt();
  if (!combinedPrompt) {
    updatePromptPreviewVisibility('validation-failed');
    rawPromptInput.focus();
    rawPromptInput.setCustomValidity(translate(locale, 'rawRequired'));
    rawPromptInput.reportValidity();
    return;
  }

  const prompts = buildComparisonPrompts(rawPromptInput.value, currentOptionalFields(), locale);
  clearResponse();
  const runRevision = responseRevision;
  const run = { controller: new AbortController() };
  activeRun = run;
  updatePromptPreviewVisibility('valid-generation');
  generateButton.disabled = true;
  responseSection.setAttribute('aria-busy', 'true');
  responseStatus.textContent = translate(locale, 'generatingCount', { count: prompts.length });
  responseCards.hidden = false;

  const cards = createResponseCards(prompts, runRevision);
  responseCards.replaceChildren(...cards.map(({ element }) => element));

  try {
    const states = await runComparison(prompts, async prompt => {
      let result;
      try {
        result = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, locale }),
          signal: run.controller.signal,
        });
      } catch (cause) {
        if (run.controller.signal.aborted) throw cause;
        throw new Error(serverErrorMessage(locale, 'upstream_unavailable'));
      }

      let data;
      try {
        data = await result.json();
      } catch {
        const error = new Error(serverErrorMessage(locale, 'upstream_unavailable'));
        if (!result.ok) error.status = result.status;
        throw error;
      }
      if (!result.ok) {
        const error = new Error(data.error || serverErrorMessage(locale, data.errorCode));
        error.status = result.status;
        throw error;
      }
      return { response: data.response, followUp: data.followUp ?? null };
    }, nextStates => {
      if (activeRun !== run) return;
      updateResponseCards(cards, nextStates);
      const loadingIndex = nextStates.findIndex(state => state.status === 'loading');
      if (loadingIndex !== -1) {
        responseStatus.textContent = translate(locale, 'generatingCard', { current: loadingIndex + 1, count: prompts.length });
      }
    }, () => activeRun === run, { rateLimit: translate(locale, 'rateStopped') });

    if (activeRun === run) {
      updateResponseCards(cards, states);
      const succeeded = states.filter(state => state.status === 'success').length;
      const failed = states.filter(state => state.status === 'error').length;
      responseStatus.textContent = failed
        ? translate(locale, 'partialSummary', { succeeded, count: prompts.length, failed })
        : translate(locale, 'successSummary', { count: succeeded });
    }
  } finally {
    if (activeRun === run) {
      activeRun = null;
      generateButton.disabled = false;
      responseSection.setAttribute('aria-busy', 'false');
    }
  }
});

function createResponseCards(prompts, revision) {
  return prompts.map(({ label, prompt }, index) => {
    const cardLocale = locale;
    const element = document.createElement('article');
    const cardId = `response-card-${revision}-${index + 1}`;
    element.id = cardId;
    element.className = 'response-card';
    element.setAttribute('aria-busy', 'false');
    const card = { id: cardId, response: undefined, followUp: null, turns: [], followUpDismissed: false, initialOfferRendered: false };

    const heading = document.createElement('h3');
    heading.textContent = label;

    const download = document.createElement('button');
    download.className = 'card-download';
    download.type = 'button';
    download.disabled = true;
    download.setAttribute('aria-label', translate(cardLocale, 'downloadPdf'));
    download.setAttribute('title', translate(cardLocale, 'downloadPdf'));
    download.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>';
    download.addEventListener('click', async () => {
      if (!download.disabled && card.response !== undefined) {
        try {
          await downloadResponsePdf(label, prompt, card.response, cardLocale, card.turns.filter(turn => turn.status === 'success'));
        } catch {
          responseStatus.textContent = translate(cardLocale, 'pdfError');
        }
      }
    });

    const promptDetails = document.createElement('details');
    promptDetails.className = 'exact-prompt';
    const summary = document.createElement('summary');
    summary.textContent = translate(cardLocale, 'exactPrompt');
    const promptText = document.createElement('pre');
    promptText.textContent = prompt;
    promptDetails.append(summary, promptText);

    const answer = document.createElement('div');
    answer.className = 'answer-preview is-collapsed';
    answer.id = `response-answer-${index + 1}`;

    const toggle = document.createElement('button');
    toggle.className = 'answer-toggle';
    toggle.type = 'button';
    toggle.textContent = translate(cardLocale, 'showMore');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', answer.id);
    toggle.hidden = true;
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      toggle.textContent = translate(cardLocale, expanded ? 'showMore' : 'showLess');
      answer.classList.toggle('is-collapsed', expanded);
    });

    const answerLabel = document.createElement('h4');
    answerLabel.textContent = translate(cardLocale, 'response');
    const responseContent = document.createElement('section');
    responseContent.className = 'card-response';
    responseContent.setAttribute('aria-labelledby', `response-heading-${index + 1}`);
    answerLabel.id = `response-heading-${index + 1}`;

    const status = document.createElement('p');
    status.className = 'card-status';
    status.setAttribute('role', 'status');
    status.textContent = translate(cardLocale, 'waiting');

    responseContent.append(answerLabel, status, answer, toggle);
    const followUpArea = document.createElement('section');
    followUpArea.className = 'follow-up-section';
    followUpArea.hidden = true;
    responseContent.append(followUpArea);
    element.append(heading, download, promptDetails, responseContent);
    Object.assign(card, {
      element, status, answer, toggle, download, prompt, followUpArea, cardLocale,
      revision, lastStatus: 'waiting',
    });
    return card;
  });
}

function createFollowUpOffer(card, parent, offer, turnNumber, revision, isRoot = false) {
  const panel = isRoot ? parent : document.createElement('section');
  panel.className = 'follow-up-section';
  panel.setAttribute('aria-busy', 'false');
  const title = document.createElement('h4');
  title.textContent = translate(card.cardLocale, 'followUpTurn', { count: turnNumber });
  const offerText = document.createElement('p');
  offerText.className = 'follow-up-offer';
  offerText.textContent = offer.offer;
  const actions = document.createElement('div');
  actions.className = 'follow-up-actions';
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.textContent = translate(card.cardLocale, 'followUpYes');
  const no = document.createElement('button');
  no.type = 'button';
  no.textContent = translate(card.cardLocale, 'followUpNo');
  actions.append(yes, no);

  const status = document.createElement('p');
  status.className = 'follow-up-status';
  status.setAttribute('role', 'status');
  const answer = document.createElement('div');
  answer.className = 'follow-up-answer answer-preview is-collapsed';
  answer.id = `${card.id}-follow-up-answer-turn-${turnNumber}`;
  answer.hidden = true;
  const toggle = document.createElement('button');
  toggle.className = 'answer-toggle';
  toggle.type = 'button';
  toggle.textContent = translate(card.cardLocale, 'showMore');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', answer.id);
  toggle.hidden = true;
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    toggle.textContent = translate(card.cardLocale, expanded ? 'showMore' : 'showLess');
    answer.classList.toggle('is-collapsed', expanded);
  });
  const retry = document.createElement('button');
  retry.className = 'follow-up-retry';
  retry.type = 'button';
  retry.textContent = translate(card.cardLocale, 'followUpRetry');
  retry.hidden = true;
  const nextContainer = document.createElement('div');
  nextContainer.className = 'follow-up-chain';
  panel.append(title, offerText, actions, status, answer, toggle, retry, nextContainer);
  if (!isRoot) parent.append(panel);

  const turn = {
    prompt: offer.prompt, status: 'offered', response: '', offer: null,
    panel, statusElement: status, answerElement: answer, toggle, retry,
    actions, nextContainer, turnNumber, revision,
  };
  yes.addEventListener('click', () => {
    if (turn.status !== 'offered') return;
    card.turns.push(turn);
    return requestFollowUpTurn(card, turn);
  });
  no.addEventListener('click', () => {
    if (turn.status !== 'offered') return;
    turn.status = 'dismissed';
    panel.hidden = true;
    if (isRoot) card.followUpDismissed = true;
  });
  retry.addEventListener('click', () => requestFollowUpTurn(card, turn));
  return turn;
}

async function requestFollowUpTurn(card, turn) {
  if (turn.status === 'loading' || turn.status === 'success' || turn.revision !== responseRevision) return;

  turn.status = 'loading';
  turn.actions.hidden = true;
  turn.retry.hidden = true;
  turn.statusElement.textContent = translate(card.cardLocale, 'followUpLoading');
  turn.panel.setAttribute('aria-busy', 'true');
  const controller = new AbortController();
  turn.controller = controller;
  activeFollowUps.add(controller);

  try {
    let result;
    try {
      result = await fetch('/api/follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-UI-Locale': card.cardLocale },
        body: JSON.stringify({
          originalPrompt: card.prompt,
          originalResponse: card.response,
          history: card.turns.filter(item => item !== turn && item.status === 'success')
            .map(item => ({ prompt: item.prompt, response: item.response })),
          nextPrompt: turn.prompt,
          locale: card.cardLocale,
        }),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      throw new Error(serverErrorMessage(card.cardLocale, 'upstream_unavailable'));
    }

    let data;
    try {
      data = await result.json();
    } catch {
      throw new Error(serverErrorMessage(card.cardLocale, 'upstream_unavailable'));
    }
    if (!result.ok) {
      const error = new Error(data.error || serverErrorMessage(card.cardLocale, data.errorCode));
      error.code = data.errorCode;
      throw error;
    }
    if (turn.revision !== responseRevision) return;
    const followUp = data.followUp ?? null;
    if (typeof data.response !== 'string' || !data.response.trim() ||
        !(followUp === null || (typeof followUp.offer === 'string' && followUp.offer.trim() &&
          typeof followUp.prompt === 'string' && followUp.prompt.trim()))) {
      throw new Error(serverErrorMessage(card.cardLocale, 'invalid_ai_response'));
    }
    turn.status = 'success';
    turn.response = data.response;
    turn.offer = followUp;
    turn.answerElement.textContent = data.response;
    turn.answerElement.hidden = false;
    turn.statusElement.textContent = translate(card.cardLocale, 'followUpGenerated');
    turn.toggle.hidden = turn.answerElement.scrollHeight <= turn.answerElement.clientHeight + 1;
    if (followUp) {
      const completedCount = card.turns.filter(item => item.status === 'success').length;
      createFollowUpOffer(card, turn.nextContainer, followUp, completedCount + 1, turn.revision);
    }
  } catch (error) {
    if (turn.revision === responseRevision && !controller.signal.aborted) {
      turn.status = 'error';
      turn.statusElement.textContent = error.message;
      turn.retry.hidden = error.code === 'conversation_limit_reached';
    }
  } finally {
    activeFollowUps.delete(controller);
    if (turn.revision === responseRevision) turn.panel.setAttribute('aria-busy', 'false');
  }
}

async function downloadResponsePdf(label, prompt, response, cardLocale, turns = []) {
  const pdfTitle = translate(cardLocale, 'pdfTitle');
  const exactPromptHeading = translate(cardLocale, 'pdfExactPrompt');
  const responseHeading = translate(cardLocale, 'pdfResponse');
  const turnText = turns.map(turn => `${turn.prompt}${turn.response}`).join('');
  if (japaneseCharacterPattern.test(`${label}${pdfTitle}${exactPromptHeading}${responseHeading}${prompt}${response}${turnText}`)) {
    await loadPdfJapaneseFont();
  }
  const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'response';
  const definition = {
    info: { title: `Prompt Mixer - ${label}` },
    pageSize: 'LETTER',
    pageMargins: [54, 54, 54, 54],
    defaultStyle: { font: 'Roboto', fontSize: 11, lineHeight: 1.35 },
    styles: {
      title: { fontSize: 20, bold: true, margin: [0, 0, 0, 12] },
      cardLabel: { fontSize: 15, bold: true, margin: [0, 0, 0, 18] },
      section: { fontSize: 12, bold: true, margin: [0, 12, 0, 5] },
    },
    content: [
      { text: pdfTextRuns('Prompt Mixer'), style: 'title' },
      { text: pdfTextRuns(label), style: 'cardLabel' },
      { text: pdfTextRuns(exactPromptHeading), style: 'section' },
      { text: pdfTextRuns(prompt), preserveLeadingSpaces: true },
      { text: pdfTextRuns(responseHeading), style: 'section' },
      { text: pdfTextRuns(response), preserveLeadingSpaces: true },
    ],
  };
  turns.forEach((turn, index) => {
    definition.content.push(
      { text: pdfTextRuns(translate(cardLocale, 'followUpTurn', { count: index + 1 })), style: 'cardLabel' },
      { text: pdfTextRuns(translate(cardLocale, 'followUpPrompt')), style: 'section' },
      { text: pdfTextRuns(turn.prompt), preserveLeadingSpaces: true },
      { text: pdfTextRuns(translate(cardLocale, 'followUpResponse')), style: 'section' },
      { text: pdfTextRuns(turn.response), preserveLeadingSpaces: true },
    );
  });
  await globalThis.pdfMake.createPdf(definition).download(`prompt-mixer-${safeLabel}.pdf`);
}

function updateResponseCards(cards, states) {
  cards.forEach((card, index) => {
    const { element, status, answer, toggle, download } = card;
    const state = states[index];
    if (!state) return;

    element.setAttribute('aria-busy', String(state.status === 'loading'));
    download.disabled = state.status !== 'success';
    if (state.status === 'loading') {
      status.textContent = translate(locale, 'generating');
    } else if (state.status === 'success') {
      status.textContent = translate(locale, 'generated');
      card.followUp = state.followUp ?? null;
      if (card.followUp && !card.followUpDismissed && !card.initialOfferRendered) {
        card.initialOfferRendered = true;
        card.followUpArea.hidden = false;
        createFollowUpOffer(card, card.followUpArea, card.followUp, 1, card.revision, true);
      }
      if (card.lastStatus !== 'success') {
        card.response = state.response;
        answer.textContent = state.response;
        answer.classList.add('is-collapsed');
        toggle.textContent = translate(locale, 'showMore');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.hidden = answer.scrollHeight <= answer.clientHeight + 1;
      }
    } else if (state.status === 'error') {
      status.textContent = state.error;
    }

    card.lastStatus = state.status;
  });
}

