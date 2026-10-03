export function buildComparisonPrompts(rawPrompt, optionalFields) {
  const raw = rawPrompt.trim();
  if (!raw) return [];

  const includedLabels = [];
  const promptParts = [raw];
  const prompts = [{ label: 'Raw only', prompt: raw }];

  optionalFields.forEach(({ enabled, input, label }) => {
    const value = input.trim();
    if (!enabled || !value) return;

    includedLabels.push(label);
    promptParts.push(`${label}: ${value}`);
    prompts.push({
      label: `Raw + ${includedLabels.join(' + ')}`,
      prompt: promptParts.join('\n\n'),
    });
  });

  return prompts;
}

export function promptPreviewVisibleAfter(event, currentlyVisible = true) {
  switch (event) {
    case 'valid-generation':
      return false;
    case 'validation-failed':
    case 'input-change':
    case 'checkbox-change':
    case 'preset-selected':
    case 'clear':
      return true;
    default:
      return currentlyVisible;
  }
}

export async function runComparison(prompts, request, onUpdate, isCurrent) {
  const states = prompts.map(() => ({ status: 'waiting', response: '', error: '' }));
  const publish = () => onUpdate(states.map(state => ({ ...state })));
  publish();

  for (let index = 0; index < prompts.length; index++) {
    if (!isCurrent()) break;

    states[index] = { status: 'loading', response: '', error: '' };
    publish();

    try {
      const response = await request(prompts[index].prompt);
      if (!isCurrent()) break;
      states[index] = { status: 'success', response, error: '' };
    } catch (error) {
      if (!isCurrent()) break;
      states[index] = { status: 'error', response: '', error: error.message || 'Could not generate a response.' };
      if (error.status === 429) {
        for (let pending = index + 1; pending < prompts.length; pending++) {
          states[pending] = { status: 'error', response: '', error: 'Not sent because a rate limit was reached.' };
        }
        publish();
        break;
      }
    }

    publish();
  }

  return states;
}