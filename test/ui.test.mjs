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
    for (const listener of this.listeners.get(type) || []) listener({ preventDefault() {} });
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

  let resolveFetch;
  let fetchResult = { ok: true, status: 200, json: async () => ({ response: 'Successful answer.' }) };
  globalThis.fetch = () => new Promise(resolve => {
    resolveFetch = () => resolve(fetchResult);
  });

  try {
    await import('../script.js?ui-test');
    const generate = elements.get('generate-response');
    const run = () => generate.trigger('click');

    elements.get('raw-prompt').value = 'Explain tides.';
    run();
    assert.equal(outputSection.hidden, true, 'a valid run hides the combined-prompt preview');

    const card = elements.get('response-cards').children[0];
    const [title, exactPrompt, responseContent] = card.children;
    assert.equal(title.tagName, 'h3');
    assert.equal(exactPrompt.tagName, 'details');
    assert.equal(responseContent.tagName, 'section');
    const [responseHeading, status, answer, toggle] = responseContent.children;
    assert.equal(responseHeading.textContent, 'Response');
    assert.equal(status.textContent, 'Generating…');
    assert.equal(card.children.indexOf(exactPrompt) < card.children.indexOf(responseContent), true);
    assert.equal(responseContent.children.indexOf(status), responseContent.children.indexOf(responseHeading) + 1);

    resolveFetch();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(answer.textContent, 'Successful answer.');
    assert.equal(toggle.hidden, false);
    assert.equal(toggle.textContent, 'Show more');

    form.trigger('input');
    assert.equal(outputSection.hidden, false, 'input changes restore the live preview');
    assert.equal(elements.get('response-cards').children.length, 0);

    outputSection.hidden = true;
    fetchResult = { ok: false, status: 502, json: async () => ({ error: 'Upstream failed.' }) };
    run();
    resolveFetch();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    const failedResponse = elements.get('response-cards').children[0].children[2];
    assert.equal(failedResponse.children[0].textContent, 'Response');
    assert.equal(failedResponse.children[1].textContent, 'Upstream failed.');

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
  }
});