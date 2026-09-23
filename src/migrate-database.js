'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeRecord } = require('./record');

const MIGRATIONS = [{
  id: '001-generic-launch-presets',
  apply(database) {
    for (const folder of ['games', 'apps']) {
      const directory = path.join(database, folder);
      if (!fs.existsSync(directory)) continue;
      for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
        const recordPath = path.join(directory, file);
        const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
        const migrated = normalizeRecord(record);
        if (migrated !== record) fs.writeFileSync(recordPath, JSON.stringify(migrated, null, 2) + '\n');
      }
    }
  }
}];

function migrationHistory(database) {
  const file = path.join(database, 'migrations.json');
  if (!fs.existsSync(file)) return { applied: [] };
  const history = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!history || !Array.isArray(history.applied) ||
      history.applied.some(entry => typeof entry.id !== 'string') ||
      new Set(history.applied.map(entry => entry.id)).size !== history.applied.length) {
    throw new Error('Invalid database migration history');
  }
  return history;
}

function pendingMigrations(database) {
  const applied = new Set(migrationHistory(database).applied.map(entry => entry.id));
  return MIGRATIONS.filter(migration => !applied.has(migration.id));
}

function applyMigrations(database, { backupBranch, sourceCommit, appliedAt = new Date().toISOString() } = {}) {
  const pending = pendingMigrations(database);
  if (pending.length === 0) return [];
  if (!/^database-backup-[a-z0-9-]+$/.test(backupBranch || '') ||
      !/^[0-9a-f]{40}$/.test(sourceCommit || '')) {
    throw new Error('A database backup branch and its source commit are required');
  }
  const history = migrationHistory(database);
  for (const migration of pending) {
    migration.apply(database);
    history.applied.push({
      id: migration.id,
      backup_branch: backupBranch,
      source_commit: sourceCommit,
      applied_at: appliedAt
    });
  }
  fs.writeFileSync(path.join(database, 'migrations.json'), JSON.stringify(history, null, 2) + '\n');
  return pending.map(migration => migration.id);
}

function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--pending') options.pending = true;
    else if (args[i].startsWith('--') && args[i + 1]) options[args[i++].slice(2)] = args[i];
    else throw new Error('Use --database with --pending or --backup-branch and --source-commit');
  }
  if (!options.database) throw new Error('--database is required');
  if (options.pending) {
    console.log(pendingMigrations(options.database).map(migration => migration.id).join('\n'));
    return;
  }
  const applied = applyMigrations(options.database, {
    backupBranch: options['backup-branch'], sourceCommit: options['source-commit']
  });
  console.log(applied.length ? 'Applied migrations: ' + applied.join(', ') : 'No pending migrations');
}

if (require.main === module) main();

module.exports = { MIGRATIONS, migrationHistory, pendingMigrations, applyMigrations };
