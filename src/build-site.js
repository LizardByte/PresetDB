'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildStatistics } = require('./statistics');
const { normalizeRecord } = require('./record');
const { buildCatalog } = require('./site-catalog');

function supportedOs(preset) {
  if (preset.os) return [preset.os];
  return preset.commands_by_os ? Object.keys(preset.commands_by_os) : ['Windows', 'Linux', 'macOS'];
}

const PROTON_TIERS = new Set(['borked', 'bronze', 'silver', 'gold', 'platinum', 'native']);
const PROTON_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function readProtonDbCache(file) {
  if (!file || !fs.existsSync(file)) return {};
  try {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (cache?.schema_version === 1 && cache.apps && typeof cache.apps === 'object' &&
        !Array.isArray(cache.apps)) return cache.apps;
  } catch {
    // Ratings are optional; a missing or invalid cache must not block a preview.
  }
  return {};
}

function validProtonDbCacheEntry(entry, now) {
  if (!Number.isSafeInteger(entry?.fetched_at) || entry.fetched_at < 0 || entry.fetched_at > now) return false;
  const rating = entry.rating;
  return rating === null || (rating && PROTON_TIERS.has(rating.tier) &&
    (rating.reports === null || (Number.isInteger(rating.reports) && rating.reports >= 0)));
}

async function protonDbRating(appId, fetcher) {
  try {
    const response = await fetcher('https://www.protondb.com/api/v1/reports/summaries/' + appId + '.json', {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return null;
    const summary = await response.json();
    if (!summary || !PROTON_TIERS.has(summary.tier)) return null;
    return {
      tier: summary.tier,
      reports: Number.isInteger(summary.total) && summary.total >= 0 ? summary.total : null
    };
  } catch {
    return null;
  }
}

function applyProtonDbRatings(records, cache) {
  for (const item of records) {
    for (const preset of item.presets) {
      if (!cache.has(preset.launch_id)) continue;
      preset.protondb_url = 'https://www.protondb.com/app/' + preset.launch_id;
      preset.protondb = cache.get(preset.launch_id)?.rating ?? null;
    }
  }
}

async function addProtonDb(records, fetcher, { cacheFile, mode, now }) {
  const ids = [...new Set(records.flatMap(item => item.presets
    .filter(preset => preset.method === 'steam' && /^[1-9]\d{0,9}$/.test(preset.launch_id || ''))
    .map(preset => preset.launch_id)))];
  const prior = readProtonDbCache(cacheFile);
  const cache = new Map();
  const pending = [];
  let cached = 0;
  for (const appId of ids) {
    const entry = validProtonDbCacheEntry(prior[appId], now) ? prior[appId] : null;
    if (mode === 'cache-only' || (entry && now - entry.fetched_at < PROTON_CACHE_MAX_AGE)) {
      if (entry) cached++;
      cache.set(appId, entry);
    } else {
      pending.push({ appId, entry });
    }
  }
  let next = 0;
  async function refreshNext() {
    if (next >= pending.length) return;
    const { appId, entry } = pending[next++];
    const rating = await protonDbRating(appId, fetcher);
    cache.set(appId, { fetched_at: now, rating: rating ?? entry?.rating ?? null });
    return refreshNext();
  }
  // Each worker takes another ID only after its current request finishes.
  await Promise.all(Array.from({ length: Math.min(32, pending.length) }, refreshNext));
  applyProtonDbRatings(records, cache);
  if (cacheFile && mode === 'refresh') {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ schema_version: 1, apps: Object.fromEntries(cache) }) + '\n');
  }
  console.log(`ProtonDB ratings: ${ids.length} Steam IDs, ${cached} cached, ${pending.length} fetched`);
}

async function buildSite(database, template, output, fetcher = globalThis.fetch, {
  cacheFile, mode = 'refresh', now = Date.now()
} = {}) {
  if (!['refresh', 'cache-only'].includes(mode)) throw new Error('ProtonDB mode must be refresh or cache-only');
  fs.mkdirSync(output, { recursive: true });
  fs.cpSync(template, output, { recursive: true });
  const index = { schema_version: 1, games: [], apps: [] };
  const records = [];
  for (const [folder, kind] of [['games', 'game'], ['apps', 'app']]) {
    const directory = path.join(database, folder);
    if (!fs.existsSync(directory)) continue;
    const files = fs.readdirSync(directory).filter(file => file.endsWith('.json')).sort();
    const target = path.join(output, folder);
    fs.mkdirSync(target, { recursive: true });
    for (const file of files) {
      const item = normalizeRecord(JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')));
      if (item.kind !== kind || !Array.isArray(item.presets) || item.presets.length === 0 ||
          String(item.id) !== path.basename(file, '.json')) {
        throw new Error(`Invalid database record: ${folder}/${file}`);
      }
      records.push(item);
      index[folder].push({
        id: item.id, name: item.name, preset_count: item.presets.length,
        image_url: item.image_url || null,
        operating_systems: [...new Set(item.presets.flatMap(supportedOs))].sort((a, b) => a.localeCompare(b)),
        ...(kind === 'game' ? { launch_methods: [...new Set(item.presets.map(preset => preset.method))].sort((a, b) => a.localeCompare(b)) } : {})
      });
    }
    index[folder].sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
  }
  await addProtonDb(records, fetcher, { cacheFile, mode, now });
  for (const item of records) {
    const folder = item.kind === 'game' ? 'games' : 'apps';
    fs.writeFileSync(path.join(output, folder, `${item.id}.json`), JSON.stringify(item, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(output, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  buildCatalog(index, output);
  const statistics = buildStatistics(index, records);
  fs.writeFileSync(path.join(output, 'stats.json'), `${JSON.stringify(statistics.data, null, 2)}\n`);
  fs.writeFileSync(path.join(output, 'top_contributors.svg'), statistics.contributorsSvg);
  fs.writeFileSync(path.join(output, 'preset_growth.svg'), statistics.growthSvg);
  return index;
}

async function main(args = process.argv.slice(2), fetcher = globalThis.fetch) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) values[args[i]] = args[i + 1];
  if (!values['--database'] || !values['--output']) throw new Error('Use --database and --output');
  return buildSite(values['--database'], values['--template'] || 'gh-pages-template', values['--output'], fetcher, {
    cacheFile: values['--protondb-cache'], mode: values['--protondb-mode'] || 'refresh'
  });
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { buildSite, protonDbRating, main };
