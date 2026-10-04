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
    'prompt-form', 'raw-prompt', 'preset-select', 'clear-button', 'output-text',
    'generate-response', 'response-status', 'response-cards', 'include-context',
    'context-input', 'include-role', 'role-input', 'include-constraints', 'constraints-input',
  ];
  const elements = new Map(ids.map(id => [id, new FakeElement()]));
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
    getElementById: id => elements.get(id),
    querySelector: selector => selector === '.output-section' ? outputSection : responseSection,
    createElement: tagName => new FakeElement(tagName),
  };

  const fetchResolvers = [];
  const pdfDownloads = [];
  const registeredFonts = [];
  const virtualFontFiles = [];
  let generationRequests = 0;
  globalThis.pdfMake = {
    addFonts: fonts => registeredFonts.push(fonts),
    addVirtualFileSystem: files => virtualFontFiles.push(files),
    createPdf: definition => ({ download: filename => pdfDownloads.push({ definition, filename }) }),
  };
  globalThis.fetch = url => {
    if (url === '/fonts/NotoSansJP-Regular.otf') {
      return Promise.resolve({ ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer });
    }
    return new Promise(resolve => {
      generationRequests += 1;
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

    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({ response: 'First line α.\n\nSecond line 東京.' }) });
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(status.textContent, 'Response generated.');
    assert.equal(download.disabled, false, 'a successful card enables its download');
    assert.equal(elements.get('response-cards').children[1].children[3].children[1].textContent, 'Generating…');

    toggle.trigger('click');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(answer.classes.has('is-collapsed'), false);

    fetchResolvers.shift()({ ok: true, status: 200, json: async () => ({ response: 'Context answer.' }) });
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
    const promptRuns = pdfDownloads[0].definition.content[3].text;
    const responseRuns = pdfDownloads[0].definition.content[5].text;
    assert.equal(promptRuns.map(run => run.text).join(''), 'Explain tides – café Ω 東京 コーヒー.\nSecond prompt line.');
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
    const errorGeneration = run();
    fetchResolvers.shift()({ ok: false, status: 502, json: async () => ({ error: 'Upstream failed.' }) });
    await errorGeneration;
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
  } finally {
    delete globalThis.document;
    delete globalThis.fetch;
    delete globalThis.pdfMake;
  }
});