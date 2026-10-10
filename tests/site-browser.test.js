'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot } = require('../gh-pages-template/assets/js/app');

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.handlers = {};
    this.attributes = {};
    this.textContent = '';
    this.style = {};
  }

  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, handler) { this.handlers[name] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  scrollIntoView() { this.scrolled = true; }
}

function fixture(t, search = '') {
  const controls = {};
  for (const name of ['search', 'kind', 'os', 'list', 'status', 'detail', 'previous', 'next', 'page']) {
    controls[`preset-${name}`] = new FakeElement('div');
  }
  controls['preset-search'].value = '';
  controls['preset-kind'].value = 'all';
  controls['preset-os'].value = 'all';
  const calls = [];
  const events = {};
  const timers = new Map();
  let timerId = 0;
  let worker;
  const location = { href: `https://example.org/en/pr-123/${search}`, search };
  const globals = {
    document: { getElementById: id => controls[id], createElement: tag => new FakeElement(tag) },
    PRESET_BASE: '/en/pr-123', location,
    history: { pushState: (state, title, url) => { location.href = url.href; location.search = url.search; } },
    addEventListener: (name, listener) => { events[name] = listener; },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ name: 'Halo', source_url: 'https://example.org/halo',
        presets: [{ name: 'Halo', command: 'halo.exe' }] }) };
    },
    Worker: class {
      constructor(url) {
        this.url = url;
        this.handlers = {};
        this.messages = [];
        worker = this;
      }
      addEventListener(name, handler) { this.handlers[name] = handler; }
      postMessage(message) { this.messages.push(message); }
    },
    setTimeout: (handler, ms) => { const id = ++timerId; timers.set(id, { handler, ms }); return id; },
    clearTimeout: id => timers.delete(id)
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    });
  }
  return { controls, calls, events, timers, worker: () => worker };
}

function result(page = 0, total = 50) {
  const start = page * 24;
  return { page, start, total, page_count: Math.ceil(total / 24),
    items: Array.from({ length: Math.min(24, total - start) }, (_, i) => ({
      id: start + i + 1, name: `Game ${start + i + 1}`, kind: 'game',
      preset_count: 1, operating_systems: ['Windows'], launch_methods: ['steam']
    })) };
}

test('browser renders one page, navigates it, and resets pagination when filters change', t => {
  const { controls, calls, worker } = fixture(t);
  boot();
  assert.equal(worker().url, '/en/pr-123/assets/js/search-worker.js');
  assert.equal(worker().messages[0].page, 0);
  assert.equal(calls.length, 0);
  worker().handlers.message({ data: { id: worker().messages.at(-1).id, result: result() } });
  assert.equal(controls['preset-list'].children.length, 24);
  assert.match(controls['preset-status'].textContent, /50 games and apps found.*Showing 1–24/);
  assert.equal(controls['preset-previous'].disabled, true);
  assert.equal(controls['preset-next'].disabled, false);
  assert.equal(controls['preset-page'].textContent, 'Page 1 of 3');
  controls['preset-next'].handlers.click();
  assert.equal(worker().messages.at(-1).page, 1);
  assert.equal(controls['preset-next'].disabled, true);
  worker().handlers.message({ data: { id: worker().messages.at(-1).id, result: result(1) } });
  assert.match(controls['preset-status'].textContent, /Showing 25–48/);
  controls['preset-previous'].handlers.click();
  assert.equal(worker().messages.at(-1).page, 0);
  controls['preset-kind'].value = 'app';
  controls['preset-kind'].handlers.input();
  assert.equal(worker().messages.at(-1).kind, 'app');
  assert.equal(worker().messages.at(-1).page, 0);
  controls['preset-os'].value = 'Linux';
  controls['preset-os'].handlers.input();
  assert.equal(worker().messages.at(-1).os, 'Linux');
  worker().handlers.message({ data: { id: worker().messages.at(-1).id, result: result(0, 0) } });
  assert.equal(controls['preset-next'].disabled, true);
  assert.equal(controls['preset-list'].children.length, 0);
  assert.match(controls['preset-status'].textContent, /No matching/);
});

test('typing is debounced and invalidates results immediately, including during the delay', t => {
  const { controls, timers, worker } = fixture(t);
  boot();
  const first = worker().messages[0];
  controls['preset-search'].value = 'ha';
  controls['preset-search'].handlers.input();
  controls['preset-search'].value = 'halo';
  controls['preset-search'].handlers.input();
  assert.equal(timers.size, 1);
  assert.equal(worker().messages.length, 1);
  assert.equal(timers.values().next().value.ms, 250);
  worker().handlers.message({ data: { id: first.id, result: result() } });
  assert.equal(controls['preset-list'].children.length, 0);
  timers.values().next().value.handler();
  const current = worker().messages.at(-1);
  assert.equal(current.query, 'halo');
  assert.equal(current.page, 0);
  worker().handlers.message({ data: { id: first.id, error: 'stale failure' } });
  assert.ok(!controls['preset-status'].textContent.includes('stale failure'));
  worker().handlers.message({ data: { id: current.id,
    result: { ...result(0, 0), min_query_length: 3 } } });
  assert.match(controls['preset-status'].textContent, /at least 3 characters/);
  assert.equal(controls['preset-list'].attributes['aria-busy'], 'false');
});

test('direct links load records independently of catalog availability and back navigation hides details', async t => {
  const { controls, calls, events, worker } = fixture(t, '?kind=game&id=42');
  boot();
  assert.equal(calls[0].url, '/en/pr-123/games/42.json');
  assert.equal(calls.length, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controls['preset-detail'].children[0].textContent, 'Halo');
  assert.equal(controls['preset-detail'].scrolled, true);
  worker().handlers.message({ data: { id: worker().messages[0].id, error: 'HTTP 503' } });
  assert.match(controls['preset-status'].textContent, /HTTP 503/);
  assert.equal(controls['preset-detail'].hidden, false);
  location.search = '';
  events.popstate();
  assert.equal(controls['preset-detail'].hidden, true);
  assert.equal(calls[0].options.signal.aborted, true);
  location.search = '?kind=app&id=app-one';
  events.popstate();
  assert.equal(calls[1].url, '/en/pr-123/apps/app-one.json');
  location.search = '?kind=invalid&id=42';
  events.popstate();
  assert.equal(controls['preset-detail'].hidden, true);
  worker().handlers.error();
  assert.match(controls['preset-status'].textContent, /Search worker unavailable/);
});

test('selecting a card keeps its direct link and superseded detail responses cannot overwrite it', async t => {
  const { controls, calls, worker } = fixture(t);
  const waiting = [];
  globalThis.fetch = (url, options) => {
    calls.push({ url, options });
    return new Promise(resolve => waiting.push(resolve));
  };
  boot();
  worker().handlers.message({ data: { id: worker().messages[0].id, result: result() } });
  controls['preset-list'].children[0].children[0].handlers.click();
  controls['preset-list'].children[1].children[0].handlers.click();
  assert.equal(new URL(location.href).searchParams.get('id'), '2');
  assert.equal(calls[0].options.signal.aborted, true);
  const response = name => ({ ok: true, json: async () => ({ name, presets: [] }) });
  waiting[1](response('Second game'));
  await new Promise(resolve => setImmediate(resolve));
  waiting[0](response('First game'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controls['preset-detail'].children[0].textContent, 'Second game');
});

test('selecting a card reports a rejected record fetch in the detail panel', async t => {
  const { controls, worker } = fixture(t);
  globalThis.fetch = async () => { throw new Error('Record request failed'); };
  boot();
  worker().handlers.message({ data: { id: worker().messages[0].id, result: result() } });
  controls['preset-list'].children[0].children[0].handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(new URL(location.href).searchParams.get('id'), '1');
  assert.equal(controls['preset-detail'].hidden, false);
  assert.equal(controls['preset-detail'].children[0].textContent,
    'Could not load presets: Record request failed');
});

test('record fetch failures and worker construction failures show usable errors', async t => {
  const { controls } = fixture(t, '?kind=game&id=42');
  globalThis.Worker = class { constructor() { throw new Error('blocked'); } };
  globalThis.fetch = async () => ({ ok: false, status: 404 });
  boot();
  assert.match(controls['preset-status'].textContent, /blocked.*Reload/);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(controls['preset-detail'].children[0].textContent, /HTTP 404/);
});
