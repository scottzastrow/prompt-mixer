import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('places Generate Response between the preview and comparison in DOM order', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const formEnd = html.indexOf('</form>');
  const previewStart = html.indexOf('<section class="output-section"');
  const previewEnd = html.indexOf('</section>', previewStart) + '</section>'.length;
  const button = html.indexOf('<button id="generate-response"');
  const comparison = html.indexOf('<section class="response-section"');

  assert.ok(formEnd < previewStart, 'the input form ends before the preview');
  assert.ok(previewEnd < button, 'the button follows the complete preview section');
  assert.ok(button < comparison, 'the button precedes response comparison');
  assert.ok(html.indexOf('id="preset-select"') < html.indexOf('id="clear-button"'));
  assert.ok(html.indexOf('id="clear-button"') < html.indexOf('id="language-select"'));
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

test('renders response states below Response and hides/restores the prompt preview correctly', async () => {
  const ids = [
    'prompt-form', 'raw-prompt', 'preset-select', 'clear-button', 'language-select', 'output-text',
    'generate-response', 'response-status', 'response-cards', 'include-context',
    'context-input', 'include-role', 'role-input', 'include-constraints', 'constraints-input',
  ];
  const elements = new Map(ids.map(id => [id, new FakeElement()]));
  const previousStorage = globalThis.localStorage;
  const previousDocument = globalThis.document;
  const savedLocales = new Map();
  globalThis.localStorage = {
    getItem: key => savedLocales.get(key) ?? null,
    setItem: (key, value) => savedLocales.set(key, value),
  };
  const form = elements.get('prompt-form');
  form.reset = () => {
    for (const [id, element] of elements) {
      if (id.startsWith('include-')) element.checked = false;
      if (id.endsWith('-input') || id === 'raw-prompt') element.value = '';
    }
  };

  const outputSection = new FakeElement('section');
  const responseSection = new FakeElement('section');
  globalThis.document = {
    documentElement: { lang: 'en' },
    getElementById: id => elements.get(id),
    querySelector: selector => selector === '.output-section' ? outputSection : responseSection,
    querySelectorAll: () => [],
    createElement: tagName => new FakeElement(tagName),
  };

  const fetchResolvers = [];
  const pdfDownloads = [];
  const registeredFonts = [];
  const virtualFontFiles = [];
  const requestBodies = [];
  const requestUrls = [];
  const requestSignals = [];
  let rejectNextFetch = null;
  let generationRequests = 0;
  globalThis.pdfMake = {
    addFonts: fonts => registeredFonts.push(fonts),
    addVirtualFileSystem: files => virtualFontFiles.push(files),
    createPdf: definition => ({ download: filename => pdfDownloads.push({ definition, filename }) }),
  };
  globalThis.fetch = (url, options) => {
    if (url === '/fonts/NotoSansJP-Regular.otf') {
      return Promise.resolve({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
    }
    return new Promise((resolve, reject) => {
      generationRequests += 1;
      requestBodies.push(options.body);
      requestUrls.push(url);
      requestSignals.push(options.signal);
      if (rejectNextFetch) {
        const error = rejectNextFetch;
        rejectNextFetch = null;
        reject(error);
        return;
      }
      fetchResolvers.push(result => resolve(result));
    });
  };

  try {
    await import('../script.js?ui-test');
    assert.equal(registeredFonts[0].NotoSansJP.normal, 'NotoSansJP-Regular.otf');
    const generate = elements.get('generate-response');
    const run = () => generate.trigger('click');

    elements.get('raw-prompt').value = 'Explain tides – café Ω 東京 コーヒー.\nSecond prompt line.';
    elements.get('context-input').value = 'Near the coast.';
    elements.get('include-context').checked = true;
    elements.get('role-input').value = 'A science teacher.';
    elements.get('include-role').checked = true;
    const generation = run();
    assert.equal(outputSection.hidden, true, 'a valid run hides the combined-prompt preview');

    const card = elements.get('response-cards').children[0];
    const [title, download, exactPrompt, responseContent] = card.children;
    assert.equal(title.tagName, 'h3');
    assert.equal(download.disabled, true);
    assert.equal(download.getAttribute('aria-label'), 'Download response as PDF');
    assert.equal(download.getAttribute('title'), 'Download response as PDF');
    assert.equal(exactPrompt.tagName, 'details');
    assert.equal(responseContent.tagName, 'section');
    const [responseHeading, status, answer, toggle] = responseContent.children;
    assert.equal(responseHeading.textContent, 'Response');
    assert.equal(status.textContent, 'Generating…');
    assert.equal(card.children.indexOf(exactPrompt) < card.children.indexOf(responseContent), true);
    assert.equal(responseContent.children.indexOf(status), responseContent.children.indexOf(responseHeading) + 1);

    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({
      response: 'First line α.\n\nSecond line 東京.',
      followUp: { offer: 'Would you like an example?', prompt: 'Give a concrete example.' },
    }) });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(status.textContent, 'Response generated.');
    assert.equal(download.disabled, false, 'a successful card enables its download');
    assert.equal(elements.get('response-cards').children[1].children[3].children[1].textContent, 'Generating…');

    toggle.trigger('click');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(answer.classes.has('is-collapsed'), false);
    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({
      response: 'Context answer.', followUp: { offer: 'Would an analogy help?', prompt: 'Explain with an analogy.' },
    }) });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(elements.get('response-cards').children[2].children[3].children[1].textContent, 'Generating…');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'later loading preserves the expanded answer');

    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({ response: 'Role answer.' }) });
    await generation;
    assert.equal(answer.textContent, 'First line α.\n\nSecond line 東京.');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'later success preserves the expanded answer');
    assert.equal(toggle.textContent, 'Show less');
    assert.equal(answer.classes.has('is-collapsed'), false);
    assert.equal(toggle.hidden, false);
    assert.equal(elements.get('response-cards').children[2].children[3].children[4].hidden, true, 'a null follow-up hides its section');

  const contextCard = elements.get('response-cards').children[1];
  const contextOfferPanel = contextCard.children[3].children[4];
  const contextTurnRequest = contextOfferPanel.children[2].children[0].trigger('click');
  const contextTurnBody = JSON.parse(requestBodies.at(-1));
  assert.equal(contextTurnBody.originalResponse, 'Context answer.');
  assert.deepEqual(contextTurnBody.history, [], 'each card starts with an independent turn history');
  fetchResolvers.pop()({ ok: true, status: 200, json: async () => ({ response: 'A context-only follow-up.', followUp: null }) });
  await contextTurnRequest;

    const followUpArea = responseContent.children[4];
    const followUpActions = followUpArea.children[2];
    const yesButton = followUpActions.children[0];
    const followUpRequestCount = generationRequests;
    const followUpRequest = yesButton.trigger('click');
    yesButton.trigger('click');
    assert.equal(generationRequests, followUpRequestCount + 1, 'a card accepts only one follow-up request');
    assert.equal(requestUrls.at(-1), '/api/follow-up');
    const firstTurnBody = JSON.parse(requestBodies.at(-1));
    assert.equal(firstTurnBody.originalPrompt, JSON.parse(requestBodies[0]).prompt);
    assert.equal(firstTurnBody.originalResponse, 'First line α.\n\nSecond line 東京.');
    assert.deepEqual(firstTurnBody.history, []);
    assert.equal(firstTurnBody.nextPrompt, 'Give a concrete example.');
    fetchResolvers.pop()({ ok: false, status: 502, json: async () => ({ errorCode: 'upstream_unavailable', error: 'Temporary failure.' }) });
    await followUpRequest;
    assert.equal(answer.textContent, 'First line α.\n\nSecond line 東京.', 'a failed turn does not replace the original response');
    assert.equal(followUpArea.children[6].hidden, false, `a failed turn exposes Retry: ${followUpArea.children[3].textContent}`);
    const failedTurnBody = JSON.parse(requestBodies.at(-1));
    const retryRequest = followUpArea.children[6].trigger('click');
    assert.equal(generationRequests, followUpRequestCount + 2, 'Retry deliberately submits the failed turn again');
    assert.deepEqual(JSON.parse(requestBodies.at(-1)), failedTurnBody, 'retry reuses the same turn history');
    fetchResolvers.pop()({ ok: true, status: 200, json: async () => ({
      response: 'More detail after follow-up.',
      followUp: { offer: 'Want another detail?', prompt: 'Explain one more detail.' },
    }) });
    await retryRequest;
    assert.equal(answer.textContent, 'First line α.\n\nSecond line 東京.', 'the original response remains unchanged');
    assert.equal(followUpArea.children[3].textContent, 'Follow-up generated.');
    assert.equal(followUpArea.children[4].textContent, 'More detail after follow-up.');

    const secondOfferPanel = followUpArea.children[7].children[0];
    const secondYes = secondOfferPanel.children[2].children[0];
    const secondTurnRequest = secondYes.trigger('click');
    const secondTurnBody = JSON.parse(requestBodies.at(-1));
    assert.deepEqual(secondTurnBody.history, [{ prompt: 'Give a concrete example.', response: 'More detail after follow-up.' }]);
    assert.equal(secondTurnBody.nextPrompt, 'Explain one more detail.');
    fetchResolvers.pop()({ ok: true, status: 200, json: async () => ({ response: 'A further detail with enough text to expand.', followUp: null }) });
    await secondTurnRequest;
    secondYes.trigger('click');
    assert.equal(generationRequests, followUpRequestCount + 3, 'a completed turn cannot be duplicated');
    assert.equal(secondOfferPanel.children[5].hidden, false, 'long follow-up answers expose Show more');
    secondOfferPanel.children[5].trigger('click');
    assert.equal(secondOfferPanel.children[5].getAttribute('aria-expanded'), 'true');
    const followUpAnswers = [followUpArea.children[4], secondOfferPanel.children[4], contextOfferPanel.children[4]];
    const followUpToggles = [followUpArea.children[5], secondOfferPanel.children[5], contextOfferPanel.children[5]];
    const followUpAnswerIds = followUpAnswers.map(followUpAnswer => followUpAnswer.id);
    assert.equal(new Set(followUpAnswerIds).size, 3, 'follow-up answer IDs are unique across cards and turns');
    assert.deepEqual(followUpAnswerIds, [
      `${card.id}-follow-up-answer-turn-1`,
      `${card.id}-follow-up-answer-turn-2`,
      `${contextCard.id}-follow-up-answer-turn-1`,
    ]);
    for (let index = 0; index < followUpToggles.length; index++) {
      const toggle = followUpToggles[index];
      const targetId = toggle.getAttribute('aria-controls');
      assert.equal(targetId, followUpAnswers[index].id, 'each Show more / Show less button controls its own answer');
      assert.equal(followUpAnswers.filter(followUpAnswer => followUpAnswer.id === targetId).length, 1);
    }

    toggle.trigger('click');
    const requestsBeforeDownload = generationRequests;
    await download.trigger('click');
    assert.equal(generationRequests, requestsBeforeDownload, 'downloading does not start another generation request');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false', 'downloading preserves collapsed answer state');
    assert.equal(answer.classes.has('is-collapsed'), true);
    assert.equal(pdfDownloads.length, 1);
    assert.deepEqual(virtualFontFiles, [{ 'NotoSansJP-Regular.otf': 'AQ==' }]);
    assert.equal(pdfDownloads[0].filename, 'prompt-mixer-raw-only.pdf');
    const pdfText = JSON.stringify(pdfDownloads[0].definition);
    assert.match(pdfText, /Prompt Mixer/);
    assert.match(pdfText, /Raw only/);
    assert.match(pdfText, /Give a concrete example\./);
    assert.match(pdfText, /More detail after follow-up\./);
    assert.match(pdfText, /Explain one more detail\./);
    assert.match(pdfText, /A further detail with enough text to expand\./);
    const exportedTurns = pdfDownloads[0].definition.content.slice(6).map(section =>
      Array.isArray(section.text) ? section.text.map(run => run.text).join('') : section.text);
    assert.ok(exportedTurns.indexOf('Give a concrete example.') < exportedTurns.indexOf('More detail after follow-up.'));
    assert.ok(exportedTurns.indexOf('More detail after follow-up.') < exportedTurns.indexOf('Explain one more detail.'));
    assert.ok(exportedTurns.indexOf('Explain one more detail.') < exportedTurns.indexOf('A further detail with enough text to expand.'));
    const promptRuns = pdfDownloads[0].definition.content[3].text;
    const responseRuns = pdfDownloads[0].definition.content[5].text;
    assert.equal(promptRuns.map(run => run.text).join(''), 'Explain tides – café Ω 東京 コーヒー.\nSecond prompt line.\n\nRespond in English. Preserve quoted text and code in their original language when appropriate.');
    assert.equal(responseRuns.map(run => run.text).join(''), 'First line α.\n\nSecond line 東京.');
    assert.ok(promptRuns.some(run => run.text.includes('café Ω') && run.font === 'Roboto'));
    assert.ok(promptRuns.some(run => run.text === '東京' && run.font === 'NotoSansJP'));
    assert.ok(promptRuns.some(run => run.text === 'コーヒー' && run.font === 'NotoSansJP'));

    elements.get('context-input').value = '';
    elements.get('include-context').checked = false;
    elements.get('role-input').value = '';
    elements.get('include-role').checked = false;
    form.trigger('input');
    assert.equal(outputSection.hidden, false, 'input changes restore the live preview');
    assert.equal(elements.get('response-cards').children.length, 0);

    outputSection.hidden = true;
    const japaneseErrorGeneration = run();
    fetchResolvers.shift()({ ok: false, status: 502, json: async () => ({ error: 'Upstream failed.' }) });
    await japaneseErrorGeneration;
    const failedCard = elements.get('response-cards').children[0];
    const failedResponse = failedCard.children[3];
    assert.equal(failedResponse.children[0].textContent, 'Response');
    assert.equal(failedResponse.children[1].textContent, 'Upstream failed.');
    assert.equal(failedCard.children[1].disabled, true, 'failed cards keep download disabled');

    outputSection.hidden = true;
    form.trigger('change');
    assert.equal(outputSection.hidden, false, 'checkbox changes restore the preview');
    outputSection.hidden = true;
    elements.get('preset-select').value = 'one';
    elements.get('preset-select').trigger('change');
    assert.equal(outputSection.hidden, false, 'preset selection restores the preview');
    outputSection.hidden = true;
    elements.get('clear-button').trigger('click');
    assert.equal(outputSection.hidden, false, 'Clear restores the preview');

    outputSection.hidden = true;
    run();
    assert.equal(outputSection.hidden, false, 'validation failure keeps the preview visible');

    elements.get('raw-prompt').value = 'Keep this typed prompt.';
    elements.get('context-input').value = 'Keep this context.';
    elements.get('include-context').checked = true;
    form.trigger('input');
    const pendingGeneration = run();
    const requestsBeforeLanguageChange = generationRequests;
    const languageSelect = elements.get('language-select');
    languageSelect.value = 'ja';
    languageSelect.trigger('change');
    assert.equal(globalThis.document.documentElement.lang, 'ja');
    assert.equal(savedLocales.get('prompt-mixer-language'), 'ja');
    assert.equal(elements.get('raw-prompt').value, 'Keep this typed prompt.');
    assert.equal(elements.get('context-input').value, 'Keep this context.');
    assert.equal(elements.get('include-context').checked, true);
    assert.match(elements.get('output-text').textContent, /日本語で回答してください/);
    assert.equal(elements.get('response-cards').children.length, 0);
    assert.equal(outputSection.hidden, false);
    assert.equal(generationRequests, requestsBeforeLanguageChange, 'switching language does not make an AI request');
    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({ response: 'Stale response.' }) });
    await pendingGeneration;
    assert.equal(elements.get('response-cards').children.length, 0, 'late responses from a cancelled run stay cleared');

    elements.get('preset-select').value = 'one';
    elements.get('preset-select').trigger('change');
    assert.match(elements.get('raw-prompt').value, /日帰りハイキング/);
    elements.get('include-context').checked = false;
    elements.get('include-role').checked = false;
    elements.get('include-constraints').checked = false;

    const japaneseGeneration = run();
    const japanesePrompt = fetchResolvers.shift();
    assert.match(JSON.parse(requestBodies.at(-1)).prompt, /日本語で回答してください/);
    japanesePrompt({ ok: true, status: 200, json: async () => ({
      response: '必需品を三つ持っていきましょう。',
      followUp: { offer: '具体例を見ますか？', prompt: '具体例を示してください。' },
    }) });
    await japaneseGeneration;
    const japaneseCard = elements.get('response-cards').children[0];
    assert.equal(japaneseCard.children[0].textContent, '基本プロンプトのみ');
    const japaneseFollowUpArea = japaneseCard.children[3].children[4];
    const japaneseFollowUpActions = japaneseFollowUpArea.children[2];
    assert.equal(japaneseFollowUpActions.children[0].textContent, 'はい');
    assert.equal(japaneseFollowUpActions.children[1].textContent, 'いいえ');
    const japaneseFollowUpRequest = japaneseFollowUpActions.children[0].trigger('click');
    assert.equal(japaneseFollowUpArea.children[3].textContent, '追加回答を生成中…');
    fetchResolvers.shift()({ ok: false, status: 429, json: async () => ({
      errorCode: 'rate_ip_minute', error: 'この接続からのAIリクエストが多すぎます。1分後にもう一度お試しください。',
    }) });
    await japaneseFollowUpRequest;
    assert.equal(japaneseCard.children[3].children[2].textContent, '必需品を三つ持っていきましょう。', 'follow-up errors preserve the original answer');
    assert.equal(japaneseFollowUpArea.children[3].textContent, 'この接続からのAIリクエストが多すぎます。1分後にもう一度お試しください。');
    assert.equal(japaneseFollowUpArea.children[6].hidden, false, 'a Japanese rate-limit error offers deliberate Retry');
    const japaneseRetry = japaneseFollowUpArea.children[6].trigger('click');
    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({ response: '追加の回答です。', followUp: null }) });
    await japaneseRetry;
    await japaneseCard.children[1].trigger('click');
    const japanesePdf = pdfDownloads[1].definition;
    const cardTitleRuns = japanesePdf.content[1].text;
    const promptHeadingRuns = japanesePdf.content[2].text;
    const responseHeadingRuns = japanesePdf.content[4].text;
    assert.equal(cardTitleRuns.map(run => run.text).join(''), '基本プロンプトのみ');
    assert.equal(promptHeadingRuns.map(run => run.text).join(''), '送信したプロンプト');
    assert.equal(responseHeadingRuns.map(run => run.text).join(''), '回答');
    const japaneseTurnTitleRuns = japanesePdf.content[6].text;
    const japaneseTurnPromptRuns = japanesePdf.content[8].text;
    const japaneseTurnResponseRuns = japanesePdf.content[10].text;
    assert.equal(japaneseTurnTitleRuns.map(run => run.text).join(''), '追加回答 1');
    assert.equal(japaneseTurnPromptRuns.map(run => run.text).join(''), '具体例を示してください。');
    assert.equal(japaneseTurnResponseRuns.map(run => run.text).join(''), '追加の回答です。');
    assert.ok(cardTitleRuns.every(run => run.font === 'NotoSansJP'));
    assert.ok(promptHeadingRuns.every(run => run.font === 'NotoSansJP'));
    assert.ok(responseHeadingRuns.every(run => run.font === 'NotoSansJP'));
    assert.ok(japaneseTurnTitleRuns.some(run => run.text.includes('追加回答') && run.font === 'NotoSansJP'));
    assert.ok(japaneseTurnPromptRuns.every(run => run.font === 'NotoSansJP'));
    assert.ok(japaneseTurnResponseRuns.every(run => run.font === 'NotoSansJP'));

    const errorGeneration = run();
    fetchResolvers.shift()({ ok: false, status: 502, json: async () => ({
      errorCode: 'upstream_busy', error: 'AIが混み合っているか、利用が制限されています。しばらくしてからお試しください。',
    }) });
    await errorGeneration;
    assert.match(elements.get('response-cards').children[0].children[3].children[1].textContent, /AIが混み合っています|AIが混み合っているか/);

    rejectNextFetch = new TypeError('Failed to fetch');
    const networkFailureGeneration = run();
    await networkFailureGeneration;
    const networkFailure = elements.get('response-cards').children[0].children[3].children[1].textContent;
    assert.equal(networkFailure, 'AIの回答を利用できません。もう一度お試しください。');
    assert.ok(!networkFailure.includes('Failed to fetch'));

    const parseFailureGeneration = run();
    fetchResolvers.shift()({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token'); } });
    await parseFailureGeneration;
    assert.equal(elements.get('response-cards').children[0].children[3].children[1].textContent, 'AIの回答を利用できません。もう一度お試しください。');

    elements.get('include-context').checked = true;
    const requestsBeforeMalformedRateLimit = generationRequests;
    const malformedRateLimitGeneration = run();
    fetchResolvers.shift()({ ok: false, status: 429, json: async () => { throw new SyntaxError('Unexpected token'); } });
    await malformedRateLimitGeneration;
    assert.equal(generationRequests, requestsBeforeMalformedRateLimit + 1, 'a malformed 429 response still stops later requests');
    assert.equal(elements.get('response-cards').children[1].children[3].children[1].textContent, '利用上限に達したため送信されませんでした。');

    elements.get('raw-prompt').value = 'Cancel a pending follow-up.';
    elements.get('include-context').checked = false;
    form.trigger('input');
    const cancellationGeneration = run();
    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({
      response: 'Original stays visible only until cancellation.',
      followUp: { offer: 'Continue?', prompt: 'Continue the answer.' },
    }) });
    await cancellationGeneration;
    const cancellationCard = elements.get('response-cards').children[0];
    const pendingFollowUp = cancellationCard.children[3].children[4].children[2].children[0].trigger('click');
    const followUpSignal = requestSignals.at(-1);
    form.trigger('input');
    assert.equal(followUpSignal.aborted, true, 'editing fields aborts a pending follow-up request');
    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({ response: 'Stale follow-up.', followUp: null }) });
    await pendingFollowUp;
    assert.equal(elements.get('response-cards').children.length, 0, 'late follow-up responses stay cleared');

    const localeCancellationGeneration = run();
    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({
      response: 'Original answer before language switch.',
      followUp: { offer: '続けますか？', prompt: '続きを説明してください。' },
    }) });
    await localeCancellationGeneration;
    const localeCancellationCard = elements.get('response-cards').children[0];
    const localePendingFollowUp = localeCancellationCard.children[3].children[4].children[2].children[0].trigger('click');
    const localeFollowUpSignal = requestSignals.at(-1);
    languageSelect.value = 'en';
    languageSelect.trigger('change');
    assert.equal(localeFollowUpSignal.aborted, true, 'language changes abort pending follow-up requests');
    assert.equal(elements.get('response-cards').children.length, 0);
    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({ response: 'Stale translated follow-up.', followUp: null }) });
    await localePendingFollowUp;
    languageSelect.value = 'ja';
    languageSelect.trigger('change');

    elements.get('raw-prompt').value = 'Dismiss the first card offer.';
    elements.get('context-input').value = 'A later card is still loading.';
    elements.get('include-context').checked = true;
    form.trigger('input');
    const dismissalGeneration = run();
    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({
      response: 'First card response.',
      followUp: { offer: '続けますか？', prompt: '続きを説明してください。' },
    }) });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const dismissalCard = elements.get('response-cards').children[0];
    const dismissedFollowUpArea = dismissalCard.children[3].children[4];
    const dismissalNoButton = dismissedFollowUpArea.children[2].children[1];
    assert.equal(elements.get('response-cards').children[1].children[3].children[1].textContent, '生成中…');
    const requestsBeforeDismissal = generationRequests;
    const urlsBeforeDismissal = requestUrls.length;
    dismissalNoButton.trigger('click');
      assert.equal(requestUrls.slice(urlsBeforeDismissal).includes('/api/follow-up'), false);
    assert.equal(dismissedFollowUpArea.hidden, true, 'No dismisses the first card offer while another card is loading');
    assert.equal(generationRequests, requestsBeforeDismissal, 'No does not send a follow-up request');

    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({ response: 'Later card response.', followUp: null }) });
    await dismissalGeneration;
    assert.equal(dismissedFollowUpArea.hidden, true, 'later comparison updates leave the offer dismissed');
    assert.equal(requestUrls.slice(urlsBeforeDismissal).includes('/api/follow-up'), false);

    elements.get('clear-button').trigger('click');
    assert.equal(languageSelect.value, 'ja', 'Clear preserves the selected language');
    assert.equal(elements.get('raw-prompt').value, '');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
    delete globalThis.fetch;
    delete globalThis.pdfMake;
  }
});