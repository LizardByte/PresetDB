'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pcGameIds, steamCandidate, mergeGame, publishBatch, run, main } = require('../src/gamedb-sync');
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

function syncFixture(t, ids, { withGit = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-gamedb-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  const checkout = path.join(root, 'checkout');
  const gameDbDir = path.join(root, 'gamedb');
  fs.mkdirSync(path.join(checkout, 'database', 'games'), { recursive: true });
  fs.mkdirSync(path.join(gameDbDir, 'platforms'), { recursive: true });
  fs.mkdirSync(path.join(gameDbDir, 'games'));
  if (withGit) {
    command(root, 'init', '--bare', remote);
    command(checkout, 'init', '-b', 'database');
    command(checkout, 'remote', 'add', 'origin', remote);
    command(checkout, 'config', 'user.name', 'LizardByte-bot');
    command(checkout, 'config', 'user.email', 'bot@example.com');
    fs.writeFileSync(path.join(checkout, 'database', 'games', '.gitkeep'), '');
    command(checkout, 'add', 'database/games/.gitkeep');
    command(checkout, 'commit', '-m', 'seed database');
    command(checkout, 'push', '-u', 'origin', 'database');
  }
  fs.writeFileSync(path.join(gameDbDir, 'platforms', '6.json'),
    JSON.stringify({ id: 6, games: ids.map(id => ({ id })) }));
  for (const id of ids) {
    fs.writeFileSync(path.join(gameDbDir, 'games', `${id}.json`), JSON.stringify(sourceGame(id)));
  }
  return { root, remote, checkout, gameDbDir };
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
  const { root, checkout, gameDbDir } = syncFixture(t, [1, 2]);
  const calls = [];
  const gitCommand = (directory, gitArgs) => {
    calls.push(gitArgs);
    return command(directory, ...gitArgs);
  };
  const args = { gameDbDir, checkout, gitCommand };
  const outputFile = path.join(root, 'github-output');
  assert.throws(() => main([], {}, () => {}), /Missing --gamedb/);
  assert.equal(main(['--gamedb', gameDbDir, '--database', checkout],
    { GITHUB_OUTPUT: outputFile }, gitCommand).published, 2);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'changed=true\n');
  assert.equal(calls.filter(args => args[0] === 'fetch').length, 1);
  assert.equal(calls.filter(args => args[0] === 'reset').length, 1);
  assert.equal(calls.filter(args => args[0] === 'push').length, 1);
  assert.equal(command(checkout, 'rev-list', '--count', 'HEAD'), '3');
  assert.equal(command(checkout, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'),
    'database/games/2.json');
  assert.equal(command(checkout, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD^'),
    'database/games/1.json');
  calls.length = 0;
  assert.deepEqual(run(args), { scanned: 2, eligible: 2, published: 0, current: 2 });
  assert.deepEqual(calls, []);
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

test('default batches push 500 commits and flush the remainder, excluding current and ineligible games', t => {
  const ids = Array.from({ length: 1004 }, (_, index) => index + 1);
  const { checkout, gameDbDir } = syncFixture(t, ids, { withGit: false });
  for (const id of [2, 501]) {
    fs.writeFileSync(path.join(checkout, 'database', 'games', `${id}.json`),
      JSON.stringify(mergeGame(steamCandidate(sourceGame(id)), null)));
  }
  fs.writeFileSync(path.join(gameDbDir, 'games', '1004.json'),
    JSON.stringify({ ...sourceGame(1004), platforms: [3] }));
  let commits = 0;
  let fetches = 0;
  let resets = 0;
  let notifications = 0;
  const pushes = [];
  const counts = run({
    gameDbDir, checkout,
    onPublished: () => notifications++,
    gitCommand: (directory, args) => {
      assert.equal(directory, checkout);
      if (args[0] === 'fetch') fetches++;
      if (args[0] === 'reset') resets++;
      if (args[0] === 'commit') commits++;
      if (args[0] === 'push') { pushes.push(commits); commits = 0; }
    }
  });
  assert.deepEqual(counts, { scanned: 1004, eligible: 1003, published: 1001, current: 2 });
  assert.deepEqual(pushes, [500, 500, 1]);
  assert.equal(fetches, 3);
  assert.equal(resets, 3);
  assert.equal(notifications, 3);
});

test('CLI batch size controls pushes and publishes all commits to a real remote', t => {
  const { root, remote, checkout, gameDbDir } = syncFixture(t, [1, 2, 3, 4, 5, 6, 7]);
  const outputFile = path.join(root, 'github-output');
  const remoteCounts = [];
  const gitCommand = (directory, args) => {
    const result = command(directory, ...args);
    if (args[0] === 'push') {
      remoteCounts.push(Number(command(root, '--git-dir', remote, 'rev-list', '--count', 'database')));
    }
    return result;
  };
  const args = ['--gamedb', gameDbDir, '--database', checkout];
  assert.throws(() => main([...args, '--batch-size'], {}, gitCommand), /Missing --batch-size/);
  for (const batchSize of ['0', '-1', '1.5', 'invalid', 'Infinity', '9007199254740992']) {
    assert.throws(() => main([...args, '--batch-size', batchSize], {}, gitCommand),
      /Batch size must be a positive safe integer/);
  }
  assert.equal(main([...args, '--batch-size', '3'], { GITHUB_OUTPUT: outputFile }, gitCommand).published, 7);
  assert.deepEqual(remoteCounts, [4, 7, 8]);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'changed=true\n');
  assert.equal(command(checkout, 'rev-parse', 'HEAD'),
    command(root, '--git-dir', remote, 'rev-parse', 'database'));
});

test('rejected batch is rebuilt from concurrent approvals and skips games already imported remotely', t => {
  const { root, remote, checkout, gameDbDir } = syncFixture(t, [1, 2, 3]);
  const peer = path.join(root, 'peer');
  command(root, 'clone', '--branch', 'database', remote, peer);
  command(peer, 'config', 'user.name', 'Contributor');
  command(peer, 'config', 'user.email', 'contributor@example.com');
  const approved = mergeGame(steamCandidate(sourceGame(2)), null);
  approved.name = 'Contributor title';
  approved.presets[0] = {
    id: '42', name: approved.name, os: null, method: 'steam', launch_id: '9999',
    commands_by_os: { Windows: 'custom command' }, origin_issue: 42, source_issue: 42,
    history: [{ issue: 42, action: 'add' }]
  };
  const unrelated = { contributor: 'retained' };
  const outputFile = path.join(root, 'github-output');
  let pushes = 0;
  let fetches = 0;
  const gitCommand = (directory, args) => {
    if (args[0] === 'fetch') fetches++;
    if (args[0] === 'push' && ++pushes === 1) {
      fs.writeFileSync(path.join(peer, 'database', 'games', '1.json'),
        JSON.stringify(mergeGame(steamCandidate(sourceGame(1)), null), null, 2) + '\n');
      fs.writeFileSync(path.join(peer, 'database', 'games', '2.json'), JSON.stringify(approved));
      fs.writeFileSync(path.join(peer, 'database', 'contributor.json'), JSON.stringify(unrelated));
      command(peer, 'add', 'database');
      command(peer, 'commit', '-m', 'concurrent approval');
      command(peer, 'push', 'origin', 'database');
    }
    return command(directory, ...args);
  };
  assert.deepEqual(main(['--gamedb', gameDbDir, '--database', checkout],
    { GITHUB_OUTPUT: outputFile }, gitCommand),
  { scanned: 3, eligible: 3, published: 2, current: 1 });
  assert.equal(fetches, 2);
  assert.equal(pushes, 2);
  assert.equal(command(checkout, 'rev-list', '--count', 'HEAD'), '4');
  assert.equal(command(checkout, 'log', '-2', '--format=%s'),
    'chore: sync GameDB game 3\nchore: sync GameDB game 2');
  const record = JSON.parse(fs.readFileSync(path.join(checkout, 'database', 'games', '2.json')));
  assert.deepEqual(record, {
    ...approved, name: 'Game 2', presets: [{ ...approved.presets[0], name: 'Game 2' }]
  });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(checkout, 'database', 'contributor.json'))),
    unrelated);
  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'changed=true\n');
});

test('a retry that finds the entire batch current avoids another push and changed output', t => {
  const { root, checkout, gameDbDir } = syncFixture(t, [1], { withGit: false });
  const file = path.join(checkout, 'database', 'games', '1.json');
  const outputFile = path.join(root, 'github-output');
  let pushes = 0;
  let resets = 0;
  const counts = main(['--gamedb', gameDbDir, '--database', checkout],
    { GITHUB_OUTPUT: outputFile }, (directory, args) => {
      if (args[0] === 'reset' && ++resets === 2) {
        fs.writeFileSync(file, JSON.stringify(mergeGame(steamCandidate(sourceGame(1)), null)));
      }
      if (args[0] === 'push') { pushes++; throw new Error('rejected push'); }
    });
  assert.deepEqual(counts, { scanned: 1, eligible: 1, published: 0, current: 1 });
  assert.equal(pushes, 1);
  assert.equal(resets, 2);
  assert.equal(fs.existsSync(outputFile), false);
});

test('failed pushes stop after five attempts without reporting unpublished changes', t => {
  const { checkout } = syncFixture(t, [], { withGit: false });
  const file = path.join(checkout, 'database', 'games', '1.json');
  const error = new Error('push failed');
  let pushes = 0;
  let commits = 0;
  let notifications = 0;
  assert.throws(() => publishBatch({
    checkout, games: [steamCandidate(sourceGame(1))],
    onPublished: () => notifications++,
    gitCommand: (directory, args) => {
      if (args[0] === 'reset' && fs.existsSync(file)) fs.unlinkSync(file);
      if (args[0] === 'commit') commits++;
      if (args[0] === 'push') { pushes++; throw error; }
    }
  }), error);
  assert.equal(pushes, 5);
  assert.equal(commits, 5);
  assert.equal(notifications, 0);
});

test('preset ordering keeps numeric issue IDs before named imports', () => {
  assert.equal(comparePresetIds('2', '10'), -1);
  assert.equal(comparePresetIds('10', '2'), 1);
  assert.equal(comparePresetIds('2', '2'), 0);
  assert.equal(comparePresetIds('2', 'steam'), -1);
  assert.equal(comparePresetIds('steam', '2'), 1);
  assert.ok(comparePresetIds('gog', 'steam') < 0);
});
