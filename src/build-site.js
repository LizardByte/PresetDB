'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { buildStatistics } = require('./statistics');

function buildSite(database, template, output) {
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
      const item = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
      if (item.kind !== kind || !Array.isArray(item.presets) || item.presets.length === 0 ||
          String(item.id) !== path.basename(file, '.json')) {
        throw new Error(`Invalid database record: ${folder}/${file}`);
      }
      fs.copyFileSync(path.join(directory, file), path.join(target, file));
      records.push(item);
      index[folder].push({
        id: item.id, name: item.name, preset_count: item.presets.length,
        image_url: item.image_url || null,
        operating_systems: [...new Set(item.presets.map(preset => preset.os))].sort()
      });
    }
    index[folder].sort((a, b) => a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
  }
  fs.writeFileSync(path.join(output, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const statistics = buildStatistics(index, records);
  fs.writeFileSync(path.join(output, 'stats.json'), `${JSON.stringify(statistics.data, null, 2)}\n`);
  fs.writeFileSync(path.join(output, 'top_contributors.svg'), statistics.contributorsSvg);
  fs.writeFileSync(path.join(output, 'preset_growth.svg'), statistics.growthSvg);
  return index;
}

function main(args = process.argv.slice(2)) {
  const values = {};
  for (let i = 0; i < args.length; i += 2) values[args[i]] = args[i + 1];
  if (!values['--database'] || !values['--output']) throw new Error('Use --database and --output');
  buildSite(values['--database'], values['--template'] || 'gh-pages-template', values['--output']);
}

if (require.main === module) main();

module.exports = { buildSite };
