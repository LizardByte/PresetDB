'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { applyMigrations, migrationHistory, pendingMigrations } = require('../src/migrate-database');

test('migration records its backup and does not rerun', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-migrate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const games = path.join(root, 'games');
  fs.mkdirSync(games);
  const file = path.join(games, '123.json');
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 1, kind: 'game', id: 123, name: 'Example',
    presets: [{ id: 'issue-4', name: 'Example (Native)', method: 'native', os: 'Windows',
      sunshine: { name: 'Example (Native)', cmd: 'example.exe', 'working-dir': 'C:\\Games' } }]
  }));
  const sourceCommit = 'a'.repeat(40);
  const backupBranch = 'database-backup-' + sourceCommit;
  assert.deepEqual(pendingMigrations(root).map(item => item.id), ['001-generic-launch-presets']);
  assert.deepEqual(applyMigrations(root, {
    backupBranch, sourceCommit, appliedAt: '2026-09-23T00:00:00.000Z'
  }), ['001-generic-launch-presets']);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(record.schema_version, 2);
  assert.equal(record.presets[0].id, '4');
  assert.equal(record.presets[0].command, 'example.exe');
  assert.equal(record.presets[0].working_directory, 'C:\\Games');
  assert.ok(!Object.hasOwn(record.presets[0], 'sunshine'));
  assert.deepEqual(migrationHistory(root), { applied: [{
    id: '001-generic-launch-presets',
    backup_branch: backupBranch,
    source_commit: sourceCommit,
    applied_at: '2026-09-23T00:00:00.000Z'
  }] });
  const content = fs.readFileSync(file, 'utf8');
  assert.deepEqual(pendingMigrations(root), []);
  assert.deepEqual(applyMigrations(root, { backupBranch: 'database-backup-other' }), []);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
});

test('migration requires a backup reference before changing the database', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-migrate-backup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => applyMigrations(root, {}), /backup branch/);
  assert.deepEqual(pendingMigrations(root).map(item => item.id), ['001-generic-launch-presets']);
  assert.ok(!fs.existsSync(path.join(root, 'migrations.json')));
});

test('migration history rejects duplicate IDs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-migrate-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'migrations.json'), JSON.stringify({
    applied: [{ id: '001-generic-launch-presets' }, { id: '001-generic-launch-presets' }]
  }));
  assert.throws(() => pendingMigrations(root), /Invalid database migration history/);
});

test('first migration rewrites a legacy Steam preset ID, commands, and storage key', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-migrate-steam-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const games = path.join(root, 'games');
  fs.mkdirSync(games);
  const file = path.join(games, '141114.json');
  fs.writeFileSync(file, JSON.stringify({
    schema_version: 1, kind: 'game', id: 141114, name: '007 First Light',
    presets: [{
      id: 'issue-4', name: '007 First Light (Steam)', os: null, method: 'steam',
      launch_id: '3768760', sunshine_by_os: {
        Windows: { cmd: 'cmd /c start "" "steam://rungameid/3768760"' },
        Linux: { cmd: 'steam "steam://rungameid/3768760"' },
        macOS: { cmd: 'open "steam://rungameid/3768760"' }
      }
    }]
  }));
  const sourceCommit = 'c'.repeat(40);
  applyMigrations(root, {
    backupBranch: 'database-backup-' + sourceCommit,
    sourceCommit,
    appliedAt: '2026-09-23T00:00:00.000Z'
  });
  const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(migrated.schema_version, 2);
  assert.equal(migrated.presets[0].id, '4');
  assert.equal(migrated.presets[0].name, '007 First Light');
  assert.deepEqual(migrated.presets[0].commands_by_os, {
    Windows: 'steam://rungameid/3768760',
    Linux: 'setsid steam steam://rungameid/3768760',
    macOS: 'open steam://rungameid/3768760'
  });
  assert.ok(!Object.hasOwn(migrated.presets[0], 'sunshine_by_os'));
});
