'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pcGameIds, steamCandidate, mergeGame, run, main } = require('../src/gamedb-sync');
const { mergePreset } = require('../src/database');
const { buildSite } = require('../src/build-site');
const { comparePresetIds } = require('../src/record');

function sourceGame(id, launchId = String(id + 1000)) {
  return {
    id, name: `Game ${id}`, slug: `game-${id}`, platforms: [6],
    cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/cover.jpg' },
    external_games: [{ uid: launchId, external_game_source: { id: 1, name: 'Steam' } }]
  };
}

function command(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
}

test('PC index and Steam source select one unambiguous launch ID', () => {
  assert.deepEqual(pcGameIds({ id: 6, games: [{ id: 2 }, { id: 1 }, { id: 2 }] }), [1, 2]);
  assert.throws(() => pcGameIds({ id: 5, games: [] }), /PC platform index/);
  assert.equal(steamCandidate(sourceGame(1)).launchId, '1001');
  assert.equal(steamCandidate({ ...sourceGame(1), platforms: [3] }), null);
  assert.equal(steamCandidate({ ...sourceGame(1), external_games: [
    ...sourceGame(1).external_games, { uid: 'invalid', external_game_source: { id: 1 } }
  ] }), null);
  assert.equal(steamCandidate({ ...sourceGame(1), external_games: [
    ...sourceGame(1).external_games, { uid: '9999', external_game_source: { id: 1 } }
  ] }), null);
});

test('direct import has no issue identity and refreshes only imported Steam launch data', () => {
  const game = steamCandidate(sourceGame(1));
  assert.throws(() => mergeGame(game, { kind: 'app', id: 1, presets: [] }), /invalid PresetDB record/);
  const imported = mergeGame(game, null);
  assert.equal(imported.presets[0].id, 'steam');
  assert.equal(imported.presets[0].source, 'gamedb');
  assert.equal(imported.presets[0].origin_issue, undefined);
  assert.equal(imported.presets[0].history, undefined);
  assert.equal(mergeGame(game, imported), null);

  const updatedGame = steamCandidate({ ...sourceGame(1, '2001'), name: 'Renamed game' });
  const updated = mergeGame(updatedGame, imported);
  assert.equal(updated.name, 'Renamed game');
  assert.equal(updated.presets[0].launch_id, '2001');
  assert.equal(updated.presets[0].commands_by_os.Linux, 'setsid steam steam://rungameid/2001');
  assert.equal(updated.presets[0].commands_by_os.Windows, 'steam://rungameid/2001');

  const manual = {
    ...imported, presets: [{
      id: '6', name: game.name, os: null, method: 'steam', launch_id: '9999',
      commands_by_os: { Windows: 'custom command' }, origin_issue: 6, source_issue: 6,
      history: [{ issue: 6, action: 'add' }]
    }]
  };
  const preserved = mergeGame(updatedGame, manual);
  assert.equal(preserved.name, 'Renamed game');
  assert.equal(preserved.presets[0].name, 'Renamed game');
  assert.equal(preserved.presets[0].launch_id, '9999');
  assert.deepEqual(preserved.presets[0].history, manual.presets[0].history);
  assert.equal(preserved.presets[0].id, '6');
  assert.equal(mergeGame(updatedGame, preserved), null);
});

test('sync publishes each changed game file in its own commit and skips unchanged files', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-gamedb-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  const checkout = path.join(root, 'checkout');
  const gameDbDir = path.join(root, 'gamedb');
  fs.mkdirSync(checkout);
  fs.mkdirSync(path.join(gameDbDir, 'platforms'), { recursive: true });
  fs.mkdirSync(path.join(gameDbDir, 'games'));
  command(root, 'init', '--bare', remote);
  command(checkout, 'init', '-b', 'database');
  command(checkout, 'remote', 'add', 'origin', remote);
  command(checkout, 'config', 'user.name', 'LizardByte-bot');
  command(checkout, 'config', 'user.email', 'bot@example.com');
  fs.mkdirSync(path.join(checkout, 'database', 'games'), { recursive: true });
  fs.writeFileSync(path.join(checkout, 'database', 'games', '.gitkeep'), '');
  command(checkout, 'add', 'database/games/.gitkeep');
  command(checkout, 'commit', '-m', 'seed database');
  command(checkout, 'push', '-u', 'origin', 'database');

  fs.writeFileSync(path.join(gameDbDir, 'platforms', '6.json'),
    JSON.stringify({ id: 6, games: [{ id: 1 }, { id: 2 }] }));
  for (const id of [1, 2]) {
    fs.writeFileSync(path.join(gameDbDir, 'games', `${id}.json`), JSON.stringify(sourceGame(id)));
  }

  const args = { gameDbDir, checkout };
  const outputFile = path.join(root, 'github-output');
  assert.throws(() => main([], {}, () => {}), /Missing --gamedb/);
  assert.equal(main(['--gamedb', gameDbDir, '--database', checkout],
    { GITHUB_OUTPUT: outputFile }, (directory, gitArgs) => command(directory, ...gitArgs)).published, 2);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'changed=true\n');
  assert.equal(command(checkout, 'rev-list', '--count', 'HEAD'), '3');
  assert.equal(command(checkout, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'),
    'database/games/2.json');
  assert.equal(command(checkout, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD^'),
    'database/games/1.json');
  assert.equal(run(args).published, 0);
  assert.equal(command(checkout, 'rev-list', '--count', 'HEAD'), '3');
  const imported = JSON.parse(fs.readFileSync(path.join(checkout, 'database/games/1.json')));
  assert.throws(() => mergePreset(path.join(checkout, 'database'), {
    kind: 'game', gameId: 1, gameName: 'Game 1', gameSlug: 'game-1',
    gameImageUrl: imported.image_url, method: 'steam', os: null,
    commandsByOs: imported.presets[0].commands_by_os, launchId: '1001',
    replacementIssue: 1, replacementReason: 'Change', notes: null
  }, { issueNumber: 10, approvedBy: 'reviewer' }), /No preset for issue #1/);

  const output = path.join(root, 'site');
  await buildSite(path.join(checkout, 'database'),
    path.join(__dirname, '..', 'gh-pages-template'), output,
    async () => ({ ok: false, status: 404 }));
  const siteRecord = JSON.parse(fs.readFileSync(path.join(output, 'games/1.json')));
  assert.equal(siteRecord.presets[0].id, 'steam');
  assert.equal(siteRecord.presets[0].origin_issue, undefined);
  assert.equal(siteRecord.presets[0].protondb_url, 'https://www.protondb.com/app/1001');
});

test('preset ordering keeps numeric issue IDs before named imports', () => {
  assert.equal(comparePresetIds('2', '10'), -1);
  assert.equal(comparePresetIds('10', '2'), 1);
  assert.equal(comparePresetIds('2', '2'), 0);
  assert.equal(comparePresetIds('2', 'steam'), -1);
  assert.equal(comparePresetIds('steam', '2'), 1);
  assert.ok(comparePresetIds('gog', 'steam') < 0);
});
