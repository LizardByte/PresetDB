'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { readRecord } = require('./database');
const { generatedLaunch } = require('./presets');
const { comparePresetIds } = require('./record');

const PC_PLATFORM = 6;
const STEAM_SOURCE = 1;

function pcGameIds(index) {
  if (index?.id !== PC_PLATFORM || !Array.isArray(index.games)) {
    throw new Error('GameDB PC platform index is invalid');
  }
  return [...new Set(index.games.map(game => game.id)
    .filter(id => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
}

function steamCandidate(game) {
  if (!Number.isSafeInteger(game?.id) || !Array.isArray(game.platforms) ||
      !game.platforms.includes(PC_PLATFORM) || typeof game.slug !== 'string' ||
      !/^[a-z0-9-]+$/.test(game.slug) || typeof game.name !== 'string' ||
      !game.name.trim() || game.name.length > 180 || /[\r\n]/.test(game.name)) return null;
  const steamEntries = (Array.isArray(game.external_games) ? game.external_games : [])
    .filter(external => external.external_game_source?.id === STEAM_SOURCE);
  if (steamEntries.some(external => typeof external.uid !== 'string' ||
      !/^[1-9]\d{0,9}$/.test(external.uid) || Number(external.uid) > 4294967295)) return null;
  const ids = [...new Set(steamEntries.map(external => external.uid))];
  if (ids.length !== 1) return null;
  const cover = game.cover?.url;
  return {
    id: game.id, name: game.name, slug: game.slug, launchId: ids[0],
    imageUrl: typeof cover === 'string' && cover.startsWith('//images.igdb.com/')
      ? `https:${cover}` : null,
    commandsByOs: generatedLaunch({ launchId: ids[0] }, 'Steam').commandsByOs
  };
}

function mergeGame(game, existing) {
  if (existing && (existing.kind !== 'game' || existing.id !== game.id)) {
    throw new Error(`Game ${game.id} has an invalid PresetDB record`);
  }
  const record = existing ? {
    ...existing, presets: existing.presets.map(preset => ({ ...preset, name: game.name }))
  } : {
    schema_version: 2, kind: 'game', id: game.id, name: game.name,
    source_url: '', image_url: null, presets: []
  };
  record.name = game.name;
  record.source_url = `https://www.igdb.com/games/${game.slug}`;
  record.image_url = game.imageUrl;
  record.igdb_slug = game.slug;
  record.game_db_url = `https://app.lizardbyte.dev/GameDB/browse/games/?id=${game.id}`;

  const steam = record.presets.filter(preset => preset.method === 'steam');
  if (steam.length > 1) throw new Error(`Game ${game.id} has multiple Steam presets`);
  if (steam.length === 0) {
    record.presets.push({
      id: 'steam', name: game.name, os: null, method: 'steam',
      launch_id: game.launchId, commands_by_os: game.commandsByOs,
      notes: null, source: 'gamedb'
    });
  } else if (steam[0].id === 'steam' && steam[0].source === 'gamedb') {
    steam[0].os = null;
    steam[0].launch_id = game.launchId;
    steam[0].commands_by_os = game.commandsByOs;
  }
  // Issue-backed Steam presets are maintained by their contributors.
  record.presets.sort((a, b) => comparePresetIds(a.id, b.id));
  return isDeepStrictEqual(existing, record) ? null : record;
}

function git(checkout, args) {
  return execFileSync('git', args, { cwd: checkout, encoding: 'utf8', stdio: 'pipe' });
}

function publishGame({ checkout, game, file, onPublished, gitCommand = git }) {
  const relative = `database/games/${game.id}.json`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    gitCommand(checkout, ['fetch', 'origin', 'database']);
    gitCommand(checkout, ['reset', '--hard', 'origin/database']);
    const desired = mergeGame(game, readRecord(file));
    if (!desired) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(desired, null, 2)}\n`);
    gitCommand(checkout, ['add', '--', relative]);
    gitCommand(checkout, ['commit', '-m', `chore: sync GameDB game ${game.id}`, '--', relative]);
    try {
      gitCommand(checkout, ['push', 'origin', 'HEAD:database']);
      onPublished?.();
      return true;
    } catch (error) {
      if (attempt === 5) throw error;
      console.log(`Database branch moved while publishing game ${game.id}; retrying`);
    }
  }
  return false;
}

function run({ gameDbDir, checkout, onPublished }) {
  const database = path.join(checkout, 'database');
  const index = JSON.parse(fs.readFileSync(path.join(gameDbDir, 'platforms', '6.json'), 'utf8'));
  const counts = { scanned: 0, eligible: 0, published: 0, current: 0 };
  for (const id of pcGameIds(index)) {
    counts.scanned++;
    const source = JSON.parse(fs.readFileSync(path.join(gameDbDir, 'games', `${id}.json`), 'utf8'));
    if (source.id !== id) throw new Error(`GameDB game ${id} has a mismatched ID`);
    const game = steamCandidate(source);
    if (!game) continue;
    counts.eligible++;
    const file = path.join(database, 'games', `${id}.json`);
    if (!mergeGame(game, readRecord(file))) { counts.current++; continue; }
    if (publishGame({ checkout, game, file, onPublished })) {
      counts.published++;
      console.log(`Published game ${id}`);
    } else counts.current++;
  }
  console.log(`GameDB Steam sync: ${JSON.stringify(counts)}`);
  return counts;
}

module.exports = { pcGameIds, steamCandidate, mergeGame, publishGame, run };

if (require.main === module) {
  const args = process.argv.slice(2);
  function option(name) {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
    return args[index + 1];
  }
  let reported = false;
  run({
    gameDbDir: path.resolve(option('--gamedb')),
    checkout: path.resolve(option('--database')),
    onPublished: () => {
      if (!reported && process.env.GITHUB_OUTPUT) {
        fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=true\n');
        reported = true;
      }
    }
  });
}
