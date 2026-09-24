'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PresetError } = require('./presets');
const { normalizeRecord, comparePresetIds } = require('./record');

function recordPath(root, preset) {
  const folder = preset.kind === 'game' ? 'games' : 'apps';
  const id = preset.kind === 'game' ? String(preset.gameId) : preset.appId;
  return path.join(root, folder, `${id}.json`);
}

function readRecord(file) {
  if (!fs.existsSync(file)) return null;
  const record = normalizeRecord(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!record || !Array.isArray(record.presets)) throw new PresetError(`Invalid database record: ${file}`);
  return record;
}

function prepareRecord(root, preset) {
  const file = recordPath(root, preset);
  const name = preset.kind === 'game' ? preset.gameName : preset.appName;
  const sourceUrl = preset.kind === 'game'
    ? `https://www.igdb.com/games/${preset.gameSlug}` : preset.appUrl;
  let record = readRecord(file);
  if (!record) {
    record = {
      schema_version: 2, kind: preset.kind, id: preset.kind === 'game' ? preset.gameId : preset.appId,
      name, source_url: sourceUrl, image_url: null, presets: []
    };
  }
  if (record.kind !== preset.kind || record.name !== name) {
    if (preset.kind === 'app') throw new PresetError('An app with the same slug but a different name already exists');
    record.name = name;
  }
  record.source_url = sourceUrl;
  if (preset.kind === 'game') {
    record.igdb_slug = preset.gameSlug;
    record.game_db_url = `https://app.lizardbyte.dev/GameDB/browse/games/?id=${preset.gameId}`;
    record.image_url = preset.gameImageUrl;
  }
  else if (preset.appImageUrl) record.image_url = preset.appImageUrl;
  return { file, record, name };
}

function replacementIndex(record, preset) {
  const previous = preset.replacementIssue == null ? -1 : record.presets.findIndex(item =>
    item.origin_issue === preset.replacementIssue || item.source_issue === preset.replacementIssue
  );
  if (preset.replacementIssue != null && previous < 0) {
    throw new PresetError(`No preset for issue #${preset.replacementIssue} exists under this ${preset.kind}`);
  }
  const normalizedVariant = (preset.variantName || '').normalize('NFKC').toLocaleLowerCase();
  if (record.presets.some((item, index) => index !== previous && item.os === preset.os &&
      item.method === preset.method &&
      (item.variant_name || '').normalize('NFKC').toLocaleLowerCase() === normalizedVariant)) {
    throw new PresetError('A preset with this OS, method, and variant already exists');
  }
  return previous;
}

function mergePreset(root, preset, {
  issueNumber, approvedBy, authorId = null, authorLogin = null, approvedAt = new Date().toISOString()
}, { write = false } = {}) {
  const { file, record, name } = prepareRecord(root, preset);
  const previous = replacementIndex(record, preset);
  const originIssue = previous >= 0 ? record.presets[previous].origin_issue : issueNumber;
  const presetId = String(originIssue);
  const history = previous >= 0 ? [...(record.presets[previous].history || [])] : [];
  if (history.some(item => item.issue === issueNumber)) {
    throw new PresetError(`Issue #${issueNumber} has already been approved for this preset`);
  }
  history.push({
    issue: issueNumber, action: previous >= 0 ? 'replace' : 'add',
    author_id: authorId, author_login: authorLogin, approved_at: approvedAt
  });
  const entry = {
    id: presetId, name, os: preset.os, method: preset.method,
    ...(preset.variantName ? { variant_name: preset.variantName } : {}),
    ...(preset.launchId ? { launch_id: preset.launchId } : {}),
    ...(preset.commandsByOs
      ? { commands_by_os: preset.commandsByOs }
      : {
        command: preset.command,
        ...(preset.workingDir ? { working_directory: preset.workingDir } : {})
      }),
    notes: preset.notes,
    origin_issue: originIssue,
    source_issue: issueNumber,
    replacement_reason: preset.replacementReason || null,
    approved_by: approvedBy,
    history
  };
  if (previous >= 0) record.presets[previous] = entry;
  else record.presets.push(entry);
  record.presets.sort((a, b) => comparePresetIds(a.id, b.id));
  if (write) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  }
  return { file, record, id: presetId, action: previous >= 0 ? 'replace' : 'add' };
}

module.exports = { mergePreset, readRecord, recordPath };
