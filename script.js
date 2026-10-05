import { buildComparisonPrompts, promptPreviewVisibleAfter, runComparison } from './comparison.mjs';
import { getPreset, normalizeLocale, serverErrorMessage, translate } from './i18n.mjs';

const form = document.getElementById('prompt-form');
const rawPromptInput = document.getElementById('raw-prompt');
const presetSelect = document.getElementById('preset-select');
const clearButton = document.getElementById('clear-button');
const languageSelect = document.getElementById('language-select');
let locale = 'en';
try {
  locale = normalizeLocale(globalThis.localStorage?.getItem('prompt-mixer-language'));
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
    element.className = 'response-card';
    element.setAttribute('aria-busy', 'false');
    const card = { response: undefined, followUp: null, followUpRequested: false, completedFollowUp: null };

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
          await downloadResponsePdf(label, prompt, card.response, cardLocale, card.completedFollowUp);
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
    const followUpTitle = document.createElement('h4');
    followUpTitle.textContent = translate(cardLocale, 'followUp');
    const offer = document.createElement('p');
    offer.className = 'follow-up-offer';
    const followUpActions = document.createElement('div');
    followUpActions.className = 'follow-up-actions';
    const yesButton = document.createElement('button');
    yesButton.type = 'button';
    yesButton.textContent = translate(cardLocale, 'followUpYes');
    const noButton = document.createElement('button');
    noButton.type = 'button';
    noButton.textContent = translate(cardLocale, 'followUpNo');
    const followUpStatus = document.createElement('p');
    followUpStatus.className = 'follow-up-status';
    followUpStatus.setAttribute('role', 'status');
    const followUpAnswer = document.createElement('div');
    followUpAnswer.className = 'follow-up-answer';
    followUpAnswer.hidden = true;
    yesButton.addEventListener('click', () => requestFollowUp(card, cardLocale, revision));
    noButton.addEventListener('click', () => {
      card.followUpDismissed = true;
      followUpArea.hidden = true;
    });
    followUpActions.append(yesButton, noButton);
    followUpArea.append(followUpTitle, offer, followUpActions, followUpStatus, followUpAnswer);
    responseContent.append(followUpArea);
    element.append(heading, download, promptDetails, responseContent);
    Object.assign(card, {
      element, status, answer, toggle, download, prompt, followUpArea, offer,
      yesButton, noButton, followUpStatus, followUpAnswer, lastStatus: 'waiting',
    });
    return card;
  });
}

async function requestFollowUp(card, cardLocale, revision) {
  if (!card.followUp || card.followUpRequested || card.followUpDismissed || revision !== responseRevision) return;

  card.followUpRequested = true;
  card.yesButton.disabled = true;
  card.noButton.disabled = true;
  card.followUpExactPrompt = `${translate(cardLocale, 'exactPrompt')}:\n${card.prompt}\n\n${translate(cardLocale, 'response')}:\n${card.response}\n\n${translate(cardLocale, 'followUpPrompt')}:\n${card.followUp.prompt}`;
  card.followUpStatus.textContent = translate(cardLocale, 'followUpLoading');
  card.followUpArea.setAttribute('aria-busy', 'true');
  const controller = new AbortController();
  activeFollowUps.add(controller);

  try {
    let result;
    try {
      result = await fetch('/api/follow-up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: card.followUpExactPrompt, locale: cardLocale }),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted) return;
      throw new Error(serverErrorMessage(cardLocale, 'upstream_unavailable'));
    }

    let data;
    try {
      data = await result.json();
    } catch {
      throw new Error(serverErrorMessage(cardLocale, 'upstream_unavailable'));
    }
    if (!result.ok) throw new Error(data.error || serverErrorMessage(cardLocale, data.errorCode));
    if (typeof data.response !== 'string' || !data.response.trim() || data.followUp !== null) {
      throw new Error(serverErrorMessage(cardLocale, 'invalid_ai_response'));
    }
    if (revision !== responseRevision) return;
    card.completedFollowUp = { prompt: card.followUpExactPrompt, response: data.response };
    card.followUpAnswer.textContent = data.response;
    card.followUpAnswer.hidden = false;
    card.followUpStatus.textContent = translate(cardLocale, 'followUpGenerated');
  } catch (error) {
    if (revision === responseRevision && !controller.signal.aborted) {
      card.followUpStatus.textContent = error.message;
    }
  } finally {
    activeFollowUps.delete(controller);
    if (revision === responseRevision) card.followUpArea.setAttribute('aria-busy', 'false');
  }
}

async function downloadResponsePdf(label, prompt, response, cardLocale, followUp = null) {
  const pdfTitle = translate(cardLocale, 'pdfTitle');
  const exactPromptHeading = translate(cardLocale, 'pdfExactPrompt');
  const responseHeading = translate(cardLocale, 'pdfResponse');
  if (japaneseCharacterPattern.test(`${label}${pdfTitle}${exactPromptHeading}${responseHeading}${prompt}${response}${followUp?.prompt ?? ''}${followUp?.response ?? ''}`)) {
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
  if (followUp) {
    definition.content.push(
      { text: pdfTextRuns(translate(cardLocale, 'followUpPrompt')), style: 'section' },
      { text: pdfTextRuns(followUp.prompt), preserveLeadingSpaces: true },
      { text: pdfTextRuns(translate(cardLocale, 'followUpResponse')), style: 'section' },
      { text: pdfTextRuns(followUp.response), preserveLeadingSpaces: true },
    );
  }
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
      if (card.followUp && !card.followUpDismissed) {
        card.followUpArea.hidden = false;
        card.offer.textContent = card.followUp.offer;
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

