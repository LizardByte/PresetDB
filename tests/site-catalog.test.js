'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildCatalog } = require('../src/site-catalog');
const { CatalogClient, PAGE_SIZE, gramKey } = require('../gh-pages-template/assets/js/catalog');

function entry(id, name, operatingSystems = ['Windows']) {
  return { id, name, operating_systems: operatingSystems, preset_count: 1,
    image_url: 'https://example.org/cover.png', launch_methods: ['steam'] };
}

function fixture(t, index) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-catalog-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = buildCatalog(index, root);
  const calls = [];
  let bytes = 0;
  const fetcher = async (url, options = {}) => {
    options.signal?.throwIfAborted();
    calls.push({ url, options });
    const file = path.join(root, url.replace('/preview/PresetDB/', ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    const data = fs.readFileSync(file, 'utf8');
    bytes += Buffer.byteLength(data);
    return { ok: true, json: async () => JSON.parse(data) };
  };
  return { root, manifest, calls, fetcher, bytes: () => bytes,
    client: new CatalogClient('/preview/PresetDB', fetcher) };
}

function reference(index, query = '', kind = 'all', os = 'all') {
  return [
    ...index.games.map(item => ({ ...item, kind: 'game' })),
    ...index.apps.map(item => ({ ...item, kind: 'app' }))
  ].filter(item => (kind === 'all' || item.kind === kind) &&
    (os === 'all' || item.operating_systems.includes(os)) &&
    item.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind) ||
      String(a.id).localeCompare(String(b.id)));
}

test('100,001 records need only a manifest and one small chunk on the first visit', async t => {
  const index = { games: Array.from({ length: 100001 }, (_, id) =>
    entry(id + 1, `Game ${String(id).padStart(6, '0')}`, ['Windows', 'Linux', 'macOS'])), apps: [] };
  const { client, calls, bytes, manifest } = fixture(t, index);
  const result = await client.page();
  assert.equal(manifest.counts.all.all, 100001);
  assert.equal(result.total, 100001);
  assert.equal(result.page_count, Math.ceil(100001 / PAGE_SIZE));
  assert.equal(result.items.length, PAGE_SIZE);
  assert.deepEqual(result.items.map(item => item.id), Array.from({ length: PAGE_SIZE }, (_, id) => id + 1));
  assert.deepEqual(calls.map(call => call.url), [
    '/preview/PresetDB/catalog/manifest.json',
    `/preview/PresetDB/catalog/${manifest.revision}/items/0.json`
  ]);
  assert.equal(calls[0].options.cache, 'no-cache');
  assert.ok(bytes() < 25000, `Initial transfer was ${bytes()} bytes`);
  assert.ok(JSON.stringify(index).length > bytes() * 500);
  t.diagnostic(`100,001 items: initial catalog ${bytes()} bytes; full index ${Buffer.byteLength(JSON.stringify(index, null, 2))} bytes`);
  calls.length = 0;
  const last = await client.page({ page: 99999 });
  assert.equal(last.items.length, 17);
  assert.equal(last.items.at(-1).id, 100001);
  assert.equal(last.start, 99984);
  assert.equal(calls.length, 1);
  calls.length = 0;
  const found = await client.page({ query: 'Game 100000' });
  assert.equal(found.total, 1);
  assert.equal(found.items[0].id, 100001);
  assert.ok(calls.length <= 4);
  assert.ok(calls.every(call => call.url.includes('/search/')));
});

test('browse pages and counts agree with the full catalog for every type and OS filter', async t => {
  const index = {
    games: Array.from({ length: 481 }, (_, id) => entry(id + 1, `Game ${String(id).padStart(3, '0')}`,
      id % 2 ? ['Windows', 'Linux', 'macOS'] : ['Windows'])),
    apps: Array.from({ length: 29 }, (_, id) => entry(`app-${id}`, `App ${id}`, ['Linux']))
  };
  const { client } = fixture(t, index);
  for (const kind of ['all', 'game', 'app']) {
    for (const os of ['all', 'Windows', 'Linux', 'macOS']) {
      const expected = reference(index, '', kind, os);
      const actual = [];
      for (let page = 0; page < Math.max(1, Math.ceil(expected.length / PAGE_SIZE)); page++) {
        const result = await client.page({ kind, os, page });
        assert.equal(result.total, expected.length);
        assert.equal(result.page, page);
        assert.ok(result.items.length <= PAGE_SIZE);
        actual.push(...result.items);
      }
      assert.deepEqual(actual, expected, `${kind}/${os}`);
    }
  }
  assert.equal((await client.page({ page: -1 })).page, 0);
  assert.equal((await client.page({ page: NaN })).page, 0);
  await assert.rejects(client.page({ kind: '../bad' }), /Invalid catalog filter/);
  await assert.rejects(client.page({ os: 'Other' }), /Invalid catalog filter/);
});

test('positional search preserves exact substrings, repeated grams, punctuation, and Unicode', async t => {
  const names = ['abcdef', 'abcXXdef', 'aaaaaa', 'aaaaXaaa', 'HALO: Reach',
    '星空🚀冒険', '🚀星空冒険', 'Résumé: Édition', 'short', 'A', 'abcdef'];
  const index = {
    games: names.map((name, id) => entry(id + 1, name, id % 2 ? ['Linux'] : ['Windows', 'macOS'])),
    apps: [entry('abc', 'abcdef', ['Linux']), entry('halo', 'HALO: Reach', ['Windows'])]
  };
  const { client, calls } = fixture(t, index);
  const queries = new Set([' abcdef ', 'AAAaaa', 'HAL', 'o: re', '🚀冒険', 'absent', 'abc def']);
  for (const name of names) {
    const characters = Array.from(name);
    for (let start = 0; start < characters.length; start++) {
      for (let length = 3; length <= characters.length - start; length++) {
        queries.add(characters.slice(start, start + length).join(''));
      }
    }
  }
  for (const query of queries) {
    if (Array.from(query.trim()).length < 3) continue;
    for (const kind of ['all', 'game', 'app']) {
      for (const os of ['all', 'Windows', 'Linux', 'macOS']) {
        const result = await client.page({ query, kind, os });
        const expected = reference(index, query, kind, os);
        assert.equal(result.total, expected.length, `${query}/${kind}/${os}`);
        assert.deepEqual(result.items, expected);
      }
    }
  }
  assert.ok(calls.every(call => !call.url.endsWith('/index.json')));
  assert.ok(calls.some(call => call.url.includes(`/search/${gramKey('🚀冒険')}.json`)));
});

test('short queries fetch no search data; empty catalogs and absent grams give empty results', async t => {
  const { client, calls } = fixture(t, { games: [entry(1, 'Halo')], apps: [] });
  for (const query of ['a', 'ab', '🚀星']) {
    assert.equal((await client.page({ query })).min_query_length, 3);
  }
  assert.equal(calls.length, 1);
  assert.equal((await client.page({ query: 'zzz' })).total, 0);
  assert.equal(calls.length, 2);
  const empty = fixture(t, { games: [], apps: [] });
  assert.deepEqual((await empty.client.page()).items, []);
  assert.equal((await empty.client.page()).total, 0);
  assert.equal(empty.calls.length, 1);
});

test('search pages reuse the last match set and bound cached chunks', async t => {
  const index = { games: Array.from({ length: 2000 }, (_, id) =>
    entry(id + 1, `Halo ${String(id).padStart(4, '0')}`)), apps: [] };
  const { client, calls } = fixture(t, index);
  const first = await client.page({ query: 'halo' });
  assert.equal(first.total, 2000);
  assert.equal(first.items.length, PAGE_SIZE);
  calls.length = 0;
  const second = await client.page({ query: 'HALO', page: 1 });
  assert.equal(second.items[0].id, 25);
  assert.equal(calls.length, 0);
  for (let page = 0; page < 84; page += 4) await client.page({ page });
  assert.equal(client.cache.size, 16);
  assert.ok(!client.cache.has('items/0.json'));
});

test('catalog revisions track metadata, while errors and aborted requests can be retried', async t => {
  const index = { games: [entry(1, 'Halo')], apps: [] };
  const { root, client, manifest, fetcher } = fixture(t, index);
  assert.equal(buildCatalog(index, root).revision, manifest.revision);
  assert.notEqual(buildCatalog({ ...index, games: [entry(1, 'Halo Updated')] }, root).revision, manifest.revision);
  let failed = false;
  client.fetcher = async (...args) => {
    if (!failed) { failed = true; return { ok: false, status: 503 }; }
    return fetcher(...args);
  };
  await assert.rejects(client.page(), /HTTP 503/);
  assert.equal((await client.page()).items[0].name, 'Halo Updated');
  client.fetcher = async () => ({ ok: false, status: 503 });
  await assert.rejects(client.page({ query: 'alo' }), /HTTP 503/);
  client.fetcher = fetcher;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.page({ query: 'alo' }, controller.signal), { name: 'AbortError' });
  assert.equal((await client.page({ query: 'alo' })).total, 1);
  const invalid = new CatalogClient('', async () => ({ ok: true, json: async () => ({ schema_version: 2 }) }));
  await assert.rejects(invalid.page(), /Unsupported catalog version/);
});

test('worker aborts superseded requests and reports only the latest result or error', async t => {
  const { fetcher } = fixture(t, { games: [entry(1, 'Halo')], apps: [] });
  const messages = [];
  let handler;
  let release;
  let first = true;
  let oldSignal;
  const context = vm.createContext({
    AbortController,
    addEventListener: (name, listener) => { assert.equal(name, 'message'); handler = listener; },
    postMessage: message => messages.push(message),
    fetch: async function (url, options) {
      assert.equal(this, vm.runInContext('globalThis', context));
      if (first) {
        first = false;
        oldSignal = options.signal;
        await new Promise(resolve => { release = resolve; });
        return fetcher(url); // Deliberately ignore cancellation to exercise the stale-result guard.
      }
      return fetcher(url, options);
    }
  });
  context.importScripts = file => vm.runInContext(fs.readFileSync(
    path.join(__dirname, '..', 'gh-pages-template/assets/js', file), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..',
    'gh-pages-template/assets/js/search-worker.js'), 'utf8'), context);
  const old = handler({ data: { id: 1, base: '/preview/PresetDB', query: 'zzz' } });
  await handler({ data: { id: 2, base: '/preview/PresetDB', query: 'hal' } });
  assert.equal(oldSignal.aborted, true);
  release();
  await old;
  assert.deepEqual(messages.map(message => message.id), [2]);
  assert.equal(messages[0].result.items[0].name, 'Halo');
  context.fetch = async () => { throw new Error('offline'); };
  await handler({ data: { id: 3, base: '/other', query: '' } });
  assert.equal(messages[1].error, 'offline');
});
