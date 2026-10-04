import { buildComparisonPrompts, promptPreviewVisibleAfter, runComparison } from './comparison.mjs';

const form = document.getElementById('prompt-form');
const rawPromptInput = document.getElementById('raw-prompt');
const presetSelect = document.getElementById('preset-select');
const clearButton = document.getElementById('clear-button');
const presets = {
  one: {
    prompt: 'What should I pack for a day hike? Answer in one sentence.',
    context: 'It will be hot and there is no drinking water on the trail.',
    role: 'Act as an experienced hiking guide.',
    constraints: 'Name three essentials in 18 words or fewer.',
  },
  two: {
    prompt: 'What is a variable in programming? Answer in one sentence.',
    context: 'I am new to programming and have not used variables before.',
    role: 'Act as a patient programming instructor.',
    constraints: 'Use one concrete everyday example in 20 words or fewer.',
  },
  three: {
    prompt: 'Write me a reminder message. Answer in one sentence.',
    context: 'A classmate borrowed my notes last week, and I need them tomorrow.',
    role: 'Write as a friendly classmate.',
    constraints: 'Be polite and direct. Use 18 words or fewer.',
  },
};
const outputText = document.getElementById('output-text');
const outputSection = document.querySelector('.output-section');
const generateButton = document.getElementById('generate-response');
const responseSection = document.querySelector('.response-section');
const responseStatus = document.getElementById('response-status');
const responseCards = document.getElementById('response-cards');
let activeRun = null;

function getOptionalFieldConfigs() {
  return [
    {
      enabled: document.getElementById('include-context'),
      input: document.getElementById('context-input'),
      label: 'Context',
    },
    {
      enabled: document.getElementById('include-role'),
      input: document.getElementById('role-input'),
      label: 'Role',
    },
    {
      enabled: document.getElementById('include-constraints'),
      input: document.getElementById('constraints-input'),
      label: 'Constraints',
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

function buildPrompt() {
  const rawPrompt = rawPromptInput.value.trim();

  if (!rawPrompt) {
    return null;
  }

  const parts = [rawPrompt];

  getOptionalFieldConfigs().forEach(({ enabled, input, label }) => {
    const value = input.value.trim();

    if (enabled.checked && value) {
      parts.push(`${label}: ${value}`);
    }
  });

  return parts.join('\n\n');
}

function renderPrompt() {
  const assembledPrompt = buildPrompt();

  if (!assembledPrompt) {
    outputText.textContent = 'Ready to mix';
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
  if (activeRun) {
    activeRun.controller.abort();
    activeRun = null;
  }
  generateButton.disabled = false;
  responseSection.setAttribute('aria-busy', 'false');
  responseCards.replaceChildren();
  responseCards.hidden = true;
  responseStatus.textContent = 'Generate a response to compare the effect of your selected instructions.';
}

function clearOutputs() {
  clearResponse();
  outputText.textContent = 'Ready to mix';
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

presetSelect.addEventListener('change', () => {
  updatePromptPreviewVisibility('preset-selected');
  clearResponse();
  const preset = presets[presetSelect.value];
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
    rawPromptInput.setCustomValidity('Please enter a raw prompt.');
    rawPromptInput.reportValidity();
    return;
  }

  const prompts = buildComparisonPrompts(rawPromptInput.value, getOptionalFieldConfigs().map(({ enabled, input, label }) => ({
    enabled: enabled.checked,
    input: input.value,
    label,
  })));
  const run = { controller: new AbortController() };
  activeRun = run;
  updatePromptPreviewVisibility('valid-generation');
  generateButton.disabled = true;
  responseSection.setAttribute('aria-busy', 'true');
  responseStatus.textContent = `Generating ${prompts.length} responses…`;
  responseCards.hidden = false;

  const cards = createResponseCards(prompts);
  responseCards.replaceChildren(...cards.map(({ element }) => element));

  try {
    const states = await runComparison(prompts, async prompt => {
      const result = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
        signal: run.controller.signal,
      });
      const data = await result.json();
      if (!result.ok) {
        const error = new Error(data.error || 'Could not generate a response.');
        error.status = result.status;
        throw error;
      }
      return data.response;
    }, nextStates => {
      if (activeRun !== run) return;
      updateResponseCards(cards, nextStates);
      const loadingIndex = nextStates.findIndex(state => state.status === 'loading');
      if (loadingIndex !== -1) {
        responseStatus.textContent = `Generating response ${loadingIndex + 1} of ${prompts.length}…`;
      }
    }, () => activeRun === run);

    if (activeRun === run) {
      updateResponseCards(cards, states);
      const succeeded = states.filter(state => state.status === 'success').length;
      const failed = states.filter(state => state.status === 'error').length;
      responseStatus.textContent = failed
        ? `${succeeded} of ${prompts.length} responses generated; ${failed} could not be generated.`
        : `${succeeded} responses generated.`;
    }
  } finally {
    if (activeRun === run) {
      activeRun = null;
      generateButton.disabled = false;
      responseSection.setAttribute('aria-busy', 'false');
    }
  }
});

function createResponseCards(prompts) {
  return prompts.map(({ label, prompt }, index) => {
    const element = document.createElement('article');
    element.className = 'response-card';
    element.setAttribute('aria-busy', 'false');
    const card = { response: undefined };

    const heading = document.createElement('h3');
    heading.textContent = label;

    const download = document.createElement('button');
    download.className = 'card-download';
    download.type = 'button';
    download.disabled = true;
    download.setAttribute('aria-label', 'Download response as PDF');
    download.setAttribute('title', 'Download response as PDF');
    download.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"/></svg>';
    download.addEventListener('click', () => {
      if (!download.disabled && card.response !== undefined) {
        downloadResponsePdf(label, prompt, card.response);
      }
    });

    const promptDetails = document.createElement('details');
    promptDetails.className = 'exact-prompt';
    const summary = document.createElement('summary');
    summary.textContent = 'Exact prompt';
    const promptText = document.createElement('pre');
    promptText.textContent = prompt;
    promptDetails.append(summary, promptText);

    const answer = document.createElement('div');
    answer.className = 'answer-preview is-collapsed';
    answer.id = `response-answer-${index + 1}`;

    const toggle = document.createElement('button');
    toggle.className = 'answer-toggle';
    toggle.type = 'button';
    toggle.textContent = 'Show more';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', answer.id);
    toggle.hidden = true;
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      toggle.textContent = expanded ? 'Show more' : 'Show less';
      answer.classList.toggle('is-collapsed', expanded);
    });

    const answerLabel = document.createElement('h4');
    answerLabel.textContent = 'Response';
    const responseContent = document.createElement('section');
    responseContent.className = 'card-response';
    responseContent.setAttribute('aria-labelledby', `response-heading-${index + 1}`);
    answerLabel.id = `response-heading-${index + 1}`;

    const status = document.createElement('p');
    status.className = 'card-status';
    status.setAttribute('role', 'status');
    status.textContent = 'Waiting to generate.';

    responseContent.append(answerLabel, status, answer, toggle);
    element.append(heading, download, promptDetails, responseContent);
    Object.assign(card, { element, status, answer, toggle, download, prompt, lastStatus: 'waiting' });
    return card;
  });
}

function downloadResponsePdf(label, prompt, response) {
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
      { text: 'Prompt Mixer', style: 'title' },
      { text: label, style: 'cardLabel' },
      { text: 'Exact submitted prompt', style: 'section' },
      { text: prompt, preserveLeadingSpaces: true },
      { text: 'Response', style: 'section' },
      { text: response, preserveLeadingSpaces: true },
    ],
  };
  globalThis.pdfMake.createPdf(definition).download(`prompt-mixer-${safeLabel}.pdf`);
}

function updateResponseCards(cards, states) {
  cards.forEach((card, index) => {
    const { element, status, answer, toggle, download } = card;
    const state = states[index];
    if (!state) return;

    element.setAttribute('aria-busy', String(state.status === 'loading'));
    download.disabled = state.status !== 'success';
    if (state.status === 'loading') {
      status.textContent = 'Generating…';
    } else if (state.status === 'success') {
      status.textContent = 'Response generated.';
      if (card.lastStatus !== 'success') {
        card.response = state.response;
        answer.textContent = state.response;
        answer.classList.add('is-collapsed');
        toggle.textContent = 'Show more';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.hidden = answer.scrollHeight <= answer.clientHeight + 1;
      }
    } else if (state.status === 'error') {
      status.textContent = state.error;
    }

    card.lastStatus = state.status;
  });
}

