'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../src/migrate-database');

test('migration command reports pending work, applies it once, and records its backup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-migration-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const games = path.join(root, 'games');
  fs.mkdirSync(games);
  const recordFile = path.join(games, '123.json');
  fs.writeFileSync(recordFile, JSON.stringify({
    schema_version: 1, kind: 'game', id: 123, name: 'Example',
    presets: [{
      id: 'issue-4', name: 'Example (Native)', method: 'native', os: 'Windows',
      sunshine: { name: 'Example (Native)', cmd: 'example.exe' }
    }]
  }));
  const sourceCommit = 'b'.repeat(40);
  const backupBranch = 'database-backup-' + sourceCommit;
  assert.deepEqual(main(['--database', root, '--pending']), ['001-generic-launch-presets']);
  assert.deepEqual(main(['--database', root, '--backup-branch', backupBranch,
    '--source-commit', sourceCommit]), ['001-generic-launch-presets']);
  assert.equal(JSON.parse(fs.readFileSync(recordFile, 'utf8')).presets[0].id, '4');
  assert.deepEqual(main(['--database', root, '--pending']), []);
  assert.deepEqual(main(['--database', root]), []);
  const history = JSON.parse(fs.readFileSync(path.join(root, 'migrations.json'), 'utf8'));
  assert.equal(history.applied[0].backup_branch, backupBranch);
  assert.equal(history.applied[0].source_commit, sourceCommit);
  assert.throws(() => main([]), /database is required/);
  assert.throws(() => main(['--database']), /Use --database/);
});
