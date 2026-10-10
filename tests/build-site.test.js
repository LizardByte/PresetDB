'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSite, main } = require('../src/build-site');

const template = path.join(__dirname, '..', 'gh-pages-template');
const now = Date.UTC(2026, 9, 9);
const day = 24 * 60 * 60 * 1000;
const gold = { tier: 'gold', reports: 73 };

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-build-cache-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = path.join(root, 'database');
  const output = path.join(root, 'site');
  const cacheFile = path.join(root, 'cache', 'protondb.json');
  for (const folder of ['games', 'apps']) fs.mkdirSync(path.join(database, folder), { recursive: true });
  fs.mkdirSync(path.dirname(cacheFile));
  for (const [id, launchId] of [[1, '1001'], [2, '1002'], [3, '1003'], [4, '1001'], [5, null]]) {
    fs.writeFileSync(path.join(database, 'games', `${id}.json`), JSON.stringify({
      schema_version: 2, kind: 'game', id, name: `Game ${id}`, presets: [{
        id: launchId ? 'steam' : '42', name: `Game ${id}`, method: launchId ? 'steam' : 'native',
        ...(launchId ? { launch_id: launchId, commands_by_os: { Windows: `steam://rungameid/${launchId}` } }
          : { os: 'Windows', command: 'game.exe' })
      }]
    }));
  }
  fs.writeFileSync(path.join(database, 'apps', 'app-one.json'), JSON.stringify({
    schema_version: 2, kind: 'app', id: 'app-one', name: 'App One',
    presets: [{ id: '43', name: 'App One', method: 'native', os: 'Linux', command: 'app-one' }]
  }));
  return { database, output, cacheFile };
}

function writeCache(file, apps) {
  fs.writeFileSync(file, JSON.stringify({ schema_version: 1, apps }));
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function preset(output, id) {
  return json(path.join(output, 'games', `${id}.json`)).presets[0];
}

test('PR cache-only builds keep the full database and stale ratings with no network or cache writes', async t => {
  const { database, output, cacheFile } = fixture(t);
  writeCache(cacheFile, { 1001: { fetched_at: now - 10 * day, rating: gold } });
  const before = fs.readFileSync(cacheFile, 'utf8');
  const source = fs.readFileSync(path.join(database, 'games', '1.json'), 'utf8');
  let calls = 0;
  const index = await buildSite(database, template, output, async () => { calls++; },
    { cacheFile, mode: 'cache-only', now });
  assert.equal(calls, 0);
  assert.equal(index.games.length, 5);
  assert.equal(index.apps.length, 1);
  assert.deepEqual(preset(output, 1).protondb, gold);
  assert.deepEqual(preset(output, 4).protondb, gold);
  for (const id of [2, 3]) {
    assert.equal(preset(output, id).protondb, null);
    assert.equal(preset(output, id).protondb_url, `https://www.protondb.com/app/${1000 + id}`);
  }
  assert.equal(preset(output, 5).command, 'game.exe');
  assert.equal(preset(output, 5).protondb, undefined);
  assert.equal(json(path.join(output, 'apps', 'app-one.json')).presets[0].command, 'app-one');
  assert.equal(json(path.join(output, 'stats.json')).preset_count, 6);
  assert.equal(fs.readFileSync(cacheFile, 'utf8'), before);
  assert.equal(fs.readFileSync(path.join(database, 'games', '1.json'), 'utf8'), source);
});

test('production reuses six-day-old ratings and refreshes unique Steam IDs at seven days', async t => {
  const { database, output, cacheFile } = fixture(t);
  writeCache(cacheFile, {
    1001: { fetched_at: now - 6 * day, rating: gold },
    1002: { fetched_at: now - 7 * day, rating: { tier: 'bronze', reports: 5 } }
  });
  const calls = [];
  await buildSite(database, template, output, async url => {
    calls.push(url);
    return { ok: true, json: async () => ({ tier: 'platinum', total: 90 }) };
  }, { cacheFile, now });
  assert.deepEqual(calls.sort(), ['1002', '1003'].map(id =>
    `https://www.protondb.com/api/v1/reports/summaries/${id}.json`));
  assert.deepEqual(preset(output, 1).protondb, gold);
  assert.deepEqual(preset(output, 2).protondb, { tier: 'platinum', reports: 90 });
  const cache = json(cacheFile);
  assert.equal(cache.schema_version, 1);
  assert.deepEqual(Object.keys(cache.apps), ['1001', '1002', '1003']);
  assert.equal(cache.apps['1001'].fetched_at, now - 6 * day);
  assert.equal(cache.apps['1002'].fetched_at, now);
  assert.deepEqual(cache.apps['1003'].rating, { tier: 'platinum', reports: 90 });

  calls.length = 0;
  await buildSite(database, template, output, async url => {
    calls.push(url);
    return { ok: true, json: async () => ({ tier: 'native', total: 100 }) };
  }, { cacheFile, now: now + day });
  assert.deepEqual(calls, ['https://www.protondb.com/api/v1/reports/summaries/1001.json']);
  assert.deepEqual(preset(output, 1).protondb, { tier: 'native', reports: 100 });
  assert.deepEqual(preset(output, 4).protondb, { tier: 'native', reports: 100 });
  assert.equal(json(cacheFile).apps['1001'].fetched_at, now + day);
  assert.equal(json(cacheFile).apps['1002'].fetched_at, now);
});

test('failed refreshes retain known ratings and missing ratings are cached to avoid repeated lookups', async t => {
  const { database, output, cacheFile } = fixture(t);
  writeCache(cacheFile, {
    1001: { fetched_at: now - 8 * day, rating: gold },
    1002: { fetched_at: now - 2 * day, rating: null }
  });
  const calls = [];
  await buildSite(database, template, output, async url => {
    calls.push(url);
    if (url.endsWith('/1001.json')) throw new Error('offline');
    return { ok: false, status: 404 };
  }, { cacheFile, now });
  assert.equal(calls.length, 2);
  assert.deepEqual(preset(output, 1).protondb, gold);
  assert.equal(preset(output, 2).protondb, null);
  assert.equal(preset(output, 3).protondb, null);
  assert.deepEqual(json(cacheFile).apps['1001'], { fetched_at: now, rating: gold });
  assert.deepEqual(json(cacheFile).apps['1003'], { fetched_at: now, rating: null });
  let repeatedCalls = 0;
  await buildSite(database, template, output, async () => { repeatedCalls++; },
    { cacheFile, now: now + 1 });
  assert.equal(repeatedCalls, 0);
});

test('production keeps at most 32 requests active and refills each available worker', async t => {
  const { database, output, cacheFile } = fixture(t);
  const game = json(path.join(database, 'games', '1.json'));
  for (let id = 6; id <= 70; id++) {
    const launchId = String(1000 + id);
    fs.writeFileSync(path.join(database, 'games', `${id}.json`), JSON.stringify({
      ...game, id, name: `Game ${id}`, presets: [{
        ...game.presets[0], launch_id: launchId,
        commands_by_os: { Windows: `steam://rungameid/${launchId}` }
      }]
    }));
  }
  writeCache(cacheFile, { 1001: { fetched_at: now, rating: gold } });
  const calls = [];
  const waiting = new Map();
  let released = false;
  let active = 0;
  let maximum = 0;
  const building = buildSite(database, template, output, async url => {
    calls.push(url);
    active++;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => {
      if (released) resolve();
      else waiting.set(url, resolve);
    });
    waiting.delete(url);
    active--;
    return { ok: true, json: async () => ({ tier: 'gold', total: 73 }) };
  }, { cacheFile, now });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 32);
    assert.equal(active, 32);
    waiting.values().next().value();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 33);
    assert.equal(active, 32);
    assert.equal(waiting.size, 32);
  } finally {
    released = true;
    for (const resolve of waiting.values()) resolve();
    await building;
  }
  assert.equal(maximum, 32);
  assert.equal(active, 0);
  assert.equal(calls.length, 67);
  assert.equal(new Set(calls).size, 67);
  assert.ok(calls.every(url => !url.endsWith('/1001.json')));
  assert.equal(json(cacheFile).apps['1001'].fetched_at, now);
  for (const id of [1, 2, 3, 4, 6, 70]) assert.deepEqual(preset(output, id).protondb, gold);
});

test('cold PR builds and invalid caches still publish presets and links without network requests', async t => {
  const { database, output, cacheFile } = fixture(t);
  const inputs = [undefined, '{', 'null', JSON.stringify({ schema_version: 2, apps: {} }),
    JSON.stringify({ schema_version: 1, apps: [] }), JSON.stringify({ schema_version: 1, apps: {
      1001: { fetched_at: now + 1, rating: gold },
      1002: { fetched_at: now, rating: { tier: 'unknown', reports: 0 } },
      1003: { fetched_at: now, rating: { tier: 'gold', reports: -1 } }
    } })];
  let calls = 0;
  for (const input of inputs) {
    if (input !== undefined) fs.writeFileSync(cacheFile, input);
    await buildSite(database, template, output, async () => { calls++; },
      { cacheFile, mode: 'cache-only', now });
    for (const id of [1, 2, 3, 4]) {
      assert.equal(preset(output, id).protondb, null);
      assert.match(preset(output, id).protondb_url, /^https:\/\/www.protondb.com\/app\//);
    }
    if (input === undefined) assert.equal(fs.existsSync(cacheFile), false);
    else assert.equal(fs.readFileSync(cacheFile, 'utf8'), input);
  }
  assert.equal(calls, 0);
});

test('site CLI forwards cache-only options and rejects an invalid rating mode before any requests', async t => {
  const { database, output, cacheFile } = fixture(t);
  writeCache(cacheFile, { 1001: { fetched_at: now, rating: gold } });
  let calls = 0;
  const fetcher = async () => { calls++; };
  const args = ['--database', database, '--template', template, '--output', output,
    '--protondb-cache', cacheFile, '--protondb-mode', 'cache-only'];
  await assert.rejects(main([], fetcher), /Use --database and --output/);
  await assert.rejects(main([...args.slice(0, -1), 'invalid'], fetcher), /ProtonDB mode/);
  assert.equal(fs.existsSync(output), false);
  const index = await main(args, fetcher);
  assert.equal(index.games.length, 5);
  assert.equal(calls, 0);
  assert.deepEqual(preset(output, 1).protondb, gold);
});
