const form = document.getElementById('prompt-form');
const rawPromptInput = document.getElementById('raw-prompt');
const outputText = document.getElementById('output-text');
const copyButton = document.getElementById('copy-button');
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
    rawPromptInput.focus();
    rawPromptInput.setCustomValidity('Please enter a raw prompt.');
    rawPromptInput.reportValidity();
    return null;
  }

  rawPromptInput.setCustomValidity('');
  outputText.textContent = assembledPrompt;
  copyButton.classList.remove('is-copied');
  copyButton.textContent = 'Copy';
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

form.addEventListener('input', clearResponse);
form.addEventListener('change', clearResponse);

generateButton.addEventListener('click', async () => {
  const prompt = renderPrompt();
  if (!prompt) return;

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

copyButton.addEventListener('click', async () => {
  const text = outputText.textContent.trim();

  if (!text || text === 'Ready to mix') {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = 'Copied!';
    copyButton.classList.add('is-copied');
  } catch (error) {
    const fallback = document.createElement('textarea');
    fallback.value = text;
    fallback.setAttribute('readonly', '');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand('copy');
    document.body.removeChild(fallback);
    copyButton.textContent = 'Copied!';
    copyButton.classList.add('is-copied');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const initialPrompt = 'Explain recursion.';
  rawPromptInput.value = initialPrompt;
  document.getElementById('context-input').value = 'I am new to programming and understand loops.';
  document.getElementById('role-input').value = 'Act as a patient programming instructor.';
  document.getElementById('constraints-input').value = 'Use a simple analogy and one short Python example.';
  renderPrompt();
});
