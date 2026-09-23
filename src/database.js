'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { PresetError } = require('./presets');

function recordPath(root, preset) {
  const folder = preset.kind === 'game' ? 'games' : 'apps';
  const id = preset.kind === 'game' ? String(preset.gameId) : preset.appId;
  return path.join(root, folder, `${id}.json`);
}

function readRecord(file) {
  if (!fs.existsSync(file)) return null;
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!record || !Array.isArray(record.presets)) throw new PresetError(`Invalid database record: ${file}`);
  return record;
}

function mergePreset(root, preset, {
  issueNumber, approvedBy, authorId = null, authorLogin = null, approvedAt = new Date().toISOString()
}, { write = false } = {}) {
  const file = recordPath(root, preset);
  let record = readRecord(file);
  const name = preset.kind === 'game' ? preset.gameName : preset.appName;
  const sourceUrl = preset.kind === 'game'
    ? `https://www.igdb.com/games/${preset.gameSlug}` : preset.appUrl;
  if (!record) {
    record = {
      schema_version: 1, kind: preset.kind, id: preset.kind === 'game' ? preset.gameId : preset.appId,
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
  const previous = preset.replacementIssue == null ? -1 : record.presets.findIndex(item =>
    item.origin_issue === preset.replacementIssue || item.source_issue === preset.replacementIssue
  );
  if (preset.replacementIssue != null && previous < 0) {
    throw new PresetError(`No preset for issue #${preset.replacementIssue} exists under this ${preset.kind}`);
  }
  const normalizedName = preset.presetName.normalize('NFKC').toLocaleLowerCase();
  if (record.presets.some((item, index) => index !== previous && item.os === preset.os &&
      item.method === preset.method && item.name.normalize('NFKC').toLocaleLowerCase() === normalizedName)) {
    throw new PresetError('A preset with this name, OS, and method already exists');
  }
  const originIssue = previous >= 0 ? record.presets[previous].origin_issue : issueNumber;
  const presetId = `issue-${originIssue}`;
  const history = previous >= 0 ? [...(record.presets[previous].history || [])] : [];
  if (history.some(item => item.issue === issueNumber)) {
    throw new PresetError(`Issue #${issueNumber} has already been approved for this preset`);
  }
  history.push({
    issue: issueNumber, action: previous >= 0 ? 'replace' : 'add',
    author_id: authorId, author_login: authorLogin, approved_at: approvedAt
  });
  const entry = {
    id: presetId, name: preset.presetName, os: preset.os, method: preset.method,
    sunshine: {
      name: `${name} (${preset.presetName})`,
      ...(preset.commandMode === 'detached' ? { detached: [preset.command] } : { cmd: preset.command }),
      ...(preset.workingDir ? { 'working-dir': preset.workingDir } : {})
    },
    notes: preset.notes,
    origin_issue: originIssue,
    source_issue: issueNumber,
    replacement_reason: preset.replacementReason || null,
    approved_by: approvedBy,
    history
  };
  if (previous >= 0) record.presets[previous] = entry;
  else record.presets.push(entry);
  record.presets.sort((a, b) => a.id.localeCompare(b.id));
  if (write) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  }
  return { file, record, id: presetId, action: previous >= 0 ? 'replace' : 'add' };
}

module.exports = { mergePreset, readRecord, recordPath };
