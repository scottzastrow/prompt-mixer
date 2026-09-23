const form = document.getElementById('prompt-form');
const rawPromptInput = document.getElementById('raw-prompt');
const outputText = document.getElementById('output-text');
const copyButton = document.getElementById('copy-button');

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

document.getElementById('show-mix').addEventListener('click', (event) => {
  event.preventDefault();
  renderPrompt();
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
  outputText.textContent = 'Raw + Context + Role + Constraints  ·  Ready to copy';
});
