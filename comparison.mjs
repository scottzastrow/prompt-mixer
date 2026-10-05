import { translate } from './i18n.mjs';

export function buildComparisonPrompts(rawPrompt, optionalFields, locale = 'en') {
  const raw = rawPrompt.trim();
  if (!raw) return [];

  const includedLabels = [];
  const promptParts = [raw];
  const instruction = translate(locale, 'languageDirective');
  const withInstruction = prompt => `${prompt}\n\n${instruction}`;
  const labelKeys = { Context: 'context', Role: 'role', Constraints: 'constraints' };
  const prompts = [{ label: translate(locale, 'rawOnly'), prompt: withInstruction(raw) }];

  optionalFields.forEach(({ enabled, input, label }) => {
    const value = input.trim();
    if (!enabled || !value) return;

    const localizedLabel = translate(locale, labelKeys[label] ?? label);
    includedLabels.push(localizedLabel);
    promptParts.push(`${localizedLabel}: ${value}`);
    prompts.push({
      label: translate(locale, 'rawPlus', { labels: includedLabels.join(' + ') }),
      prompt: withInstruction(promptParts.join('\n\n')),
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
    case 'language-change':
      return true;
    default:
      return currentlyVisible;
  }
}

export async function runComparison(prompts, request, onUpdate, isCurrent, messages = {}) {
  const states = prompts.map(() => ({ status: 'waiting', response: '', error: '' }));
  const publish = () => onUpdate(states.map(state => ({ ...state })));
  publish();

  for (let index = 0; index < prompts.length; index++) {
    if (!isCurrent()) break;

    states[index] = { status: 'loading', response: '', error: '' };
    publish();

    try {
      const result = await request(prompts[index].prompt);
      if (!isCurrent()) break;
      states[index] = {
        status: 'success',
        response: typeof result === 'string' ? result : result.response,
        followUp: typeof result === 'string' ? null : result.followUp ?? null,
        error: '',
      };
    } catch (error) {
      if (!isCurrent()) break;
      states[index] = { status: 'error', response: '', error: error.message || 'Could not generate a response.' };
      if (error.status === 429) {
        for (let pending = index + 1; pending < prompts.length; pending++) {
          states[pending] = { status: 'error', response: '', error: messages.rateLimit || 'Not sent because a rate limit was reached.' };
        }
        publish();
        break;
      }
    }

    publish();
  }

  return states;
}