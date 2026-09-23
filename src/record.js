'use strict';

const { PresetError, generatedLaunch } = require('./presets');

function normalizeRecord(record) {
  if (!record || !Array.isArray(record.presets)) throw new PresetError('Invalid database record');
  if (record.schema_version === 2) return record;
  if (record.schema_version !== 1) throw new PresetError('Unsupported database schema version');

  return {
    ...record,
    schema_version: 2,
    presets: record.presets.map(preset => {
      const item = { ...preset };
      const legacyId = /^issue-([1-9]\d*)$/.exec(item.id);
      if (legacyId) item.id = legacyId[1];
      if (item.sunshine_by_os) {
        const method = { steam: 'Steam', 'epic-games': 'Epic Games', 'microsoft-store': 'Microsoft Store' }[item.method];
        item.commands_by_os = method && item.launch_id
          ? generatedLaunch({ launchId: item.launch_id }, method).commandsByOs
          : Object.fromEntries(Object.entries(item.sunshine_by_os).map(([os, launch]) => [os, launch.cmd]));
        delete item.sunshine_by_os;
      }
      if (item.sunshine) {
        item.command = item.sunshine.cmd;
        if (item.sunshine['working-dir']) item.working_directory = item.sunshine['working-dir'];
        delete item.sunshine;
      }
      return item;
    })
  };
}

module.exports = { normalizeRecord };
