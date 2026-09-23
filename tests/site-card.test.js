'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderPresetCard } = require('../gh-pages-template/assets/js/app');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.handlers = {};
    this.textContent = '';
    this.style = {};
  }

  append(...nodes) {
    this.children.push(...nodes);
    if (this.tagName === 'select' && this.value === undefined && nodes.length) {
      this.value = nodes[0].value;
    }
  }

  addEventListener(name, handler) {
    this.handlers[name] = handler;
  }
}

function findAll(root, tagName) {
  return [root, ...root.children.flatMap(child => findAll(child, tagName))]
    .filter(node => node.tagName === tagName);
}

test('site card changes host command and copies command and Sunshine JSON', async t => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const copied = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement: tag => new FakeElement(tag) }
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true, value: { clipboard: { writeText: async value => copied.push(value) } }
  });
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  });

  const card = renderPresetCard({
    name: 'Example (Steam)',
    notes: 'Install Steam first.',
    commands_by_os: {
      Windows: 'steam://rungameid/464920',
      Linux: 'setsid steam steam://rungameid/464920'
    },
    protondb: { tier: 'gold', reports: 73 },
    protondb_url: 'https://www.protondb.com/app/464920',
    origin_issue: 4,
    source_issue: 9
  });
  const select = findAll(card, 'select')[0];
  const codes = findAll(card, 'code');
  const buttons = findAll(card, 'button');
  assert.equal(select.value, 'Windows');
  assert.equal(codes[0].textContent, 'steam://rungameid/464920');
  assert.equal(JSON.parse(codes[1].textContent).cmd, 'steam://rungameid/464920');
  assert.ok(findAll(card, 'a').some(link => link.href?.endsWith('/issues/4')));
  assert.ok(findAll(card, 'a').some(link => link.textContent === 'ProtonDB: Gold (73 reports)'));

  select.value = 'Linux';
  select.handlers.change();
  assert.equal(codes[0].textContent, 'setsid steam steam://rungameid/464920');
  assert.equal(JSON.parse(codes[1].textContent).cmd, 'setsid steam steam://rungameid/464920');

  await buttons[0].handlers.click();
  await buttons[1].handlers.click();
  assert.deepEqual(copied, [codes[0].textContent, codes[1].textContent]);
  assert.equal(buttons[0].textContent, 'Copied');
  assert.equal(buttons[1].textContent, 'Copied');

  navigator.clipboard.writeText = async () => { throw new Error('clipboard unavailable'); };
  await buttons[0].handlers.click();
  await buttons[1].handlers.click();
  assert.match(buttons[0].textContent, /Select and copy the command/);
  assert.match(buttons[1].textContent, /Select and copy the JSON/);

  const native = renderPresetCard({ name: 'Example (Windows)', command: 'example.exe' });
  assert.equal(findAll(native, 'select').length, 0);
  assert.equal(findAll(native, 'code')[0].textContent, 'example.exe');
});
