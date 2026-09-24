'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildStatistics } = require('./statistics');
const { normalizeRecord } = require('./record');

function supportedOs(preset) {
  if (preset.os) return [preset.os];
  return preset.commands_by_os ? Object.keys(preset.commands_by_os) : ['Windows', 'Linux', 'macOS'];
}

const PROTON_TIERS = new Set(['borked', 'bronze', 'silver', 'gold', 'platinum', 'native']);

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

async function addProtonDb(records, fetcher) {
  const ids = [...new Set(records.flatMap(item => item.presets
    .filter(preset => preset.method === 'steam' && /^[1-9]\d{0,9}$/.test(preset.launch_id || ''))
    .map(preset => preset.launch_id)))];
  const cache = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(32, ids.length) }, async () => {
    while (next < ids.length) {
      const appId = ids[next++];
      cache.set(appId, await protonDbRating(appId, fetcher));
    }
  }));
  for (const item of records) {
    for (const preset of item.presets) {
      if (!cache.has(preset.launch_id)) continue;
      preset.protondb_url = 'https://www.protondb.com/app/' + preset.launch_id;
      preset.protondb = cache.get(preset.launch_id);
    }
  }
}

async function buildSite(database, template, output, fetcher = globalThis.fetch) {
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
  await addProtonDb(records, fetcher);
  for (const item of records) {
    const folder = item.kind === 'game' ? 'games' : 'apps';
    fs.writeFileSync(path.join(output, folder, `${item.id}.json`), JSON.stringify(item, null, 2) + '\n');
  }
  fs.writeFileSync(path.join(output, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const statistics = buildStatistics(index, records);
  fs.writeFileSync(path.join(output, 'stats.json'), `${JSON.stringify(statistics.data, null, 2)}\n`);
  fs.writeFileSync(path.join(output, 'top_contributors.svg'), statistics.contributorsSvg);
  fs.writeFileSync(path.join(output, 'preset_growth.svg'), statistics.growthSvg);
  return index;
}

async function main(args = process.argv.slice(2)) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) values[args[i]] = args[i + 1];
  if (!values['--database'] || !values['--output']) throw new Error('Use --database and --output');
  await buildSite(values['--database'], values['--template'] || 'gh-pages-template', values['--output']);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { buildSite, protonDbRating };
