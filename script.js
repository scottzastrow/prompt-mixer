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
const generateButton = document.getElementById('generate-response');
const responseSection = document.querySelector('.response-section');
const responseStatus = document.getElementById('response-status');
const responseText = document.getElementById('response-text');
let activeRequest = null;

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

form.addEventListener('submit', (event) => {
  event.preventDefault();
  renderPrompt();
});

function clearResponse() {
  if (activeRequest) {
    activeRequest.abort();
    activeRequest = null;
  }
  generateButton.disabled = false;
  generateButton.textContent = 'Generate Response';
  responseSection.setAttribute('aria-busy', 'false');
  responseText.hidden = true;
  responseText.textContent = '';
  responseStatus.textContent = 'Generate a response to compare the effect of your selected instructions.';
}

function clearOutputs() {
  clearResponse();
  outputText.textContent = 'Ready to mix';
}

form.addEventListener('input', () => {
  clearResponse();
  renderPrompt();
});
form.addEventListener('change', () => {
  clearResponse();
  renderPrompt();
});

clearButton.addEventListener('click', () => {
  form.reset();
  presetSelect.value = '';
  rawPromptInput.setCustomValidity('');
  clearOutputs();
  rawPromptInput.focus();
});

presetSelect.addEventListener('change', () => {
  const preset = presets[presetSelect.value];
  if (!preset) return;

  rawPromptInput.value = preset.prompt;
  rawPromptInput.setCustomValidity('');
  getOptionalFieldConfigs().forEach(({ enabled, input, label }) => {
    const value = preset[label.toLowerCase()] || '';
    input.value = value;
    enabled.checked = value.trim() !== '';
  });

  clearResponse();
  renderPrompt();
  rawPromptInput.focus();
});

generateButton.addEventListener('click', async () => {
  const prompt = renderPrompt();
  if (!prompt) {
    rawPromptInput.focus();
    rawPromptInput.setCustomValidity('Please enter a raw prompt.');
    rawPromptInput.reportValidity();
    return;
  }

  const request = new AbortController();
  activeRequest = request;
  generateButton.disabled = true;
  generateButton.textContent = 'Generating…';
  responseSection.setAttribute('aria-busy', 'true');
  responseText.hidden = true;
  responseStatus.textContent = 'Generating an AI response…';

  try {
    const result = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: request.signal,
    });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || 'Could not generate a response.');
    responseText.textContent = data.response;
    responseText.hidden = false;
    responseStatus.textContent = 'Response generated. Change a field and generate again to compare.';
  } catch (error) {
    if (error.name !== 'AbortError') {
      responseStatus.textContent = error.message || 'Could not connect to the server.';
    }
  } finally {
    if (activeRequest === request) {
      activeRequest = null;
      generateButton.disabled = false;
      generateButton.textContent = 'Generate Response';
      responseSection.setAttribute('aria-busy', 'false');
    }
  }
});

