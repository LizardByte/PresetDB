'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseIssue, validateFields, validateGameDb, PresetError } = require('./presets');
const { mergePreset } = require('./database');

function requestKind(issue) {
  const labels = new Set((issue.labels || []).map(label => typeof label === 'string' ? label : label.name));
  const game = labels.has('request-game-preset');
  const app = labels.has('request-app-preset');
  if (game === app) throw new PresetError('Issue must have exactly one request type label');
  return game ? 'game' : 'app';
}

async function processIssue(event, database, { approve = false, actor = '', fetcher = globalThis.fetch, credentials = {} } = {}) {
  const issue = event.issue;
  if (!issue || !Number.isInteger(issue.number)) throw new PresetError('A GitHub issue event is required');
  const kind = requestKind(issue);
  const fields = parseIssue(issue.body || '');
  const preset = await validateGameDb(validateFields(fields, kind), fetcher, credentials);
  const merged = mergePreset(database, preset, {
    issueNumber: issue.number, approvedBy: actor,
    authorId: issue.user?.id ?? null, authorLogin: issue.user?.login ?? null
  }, { write: approve });
  return { ...merged, preset, kind };
}

function argsToObject(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i + 1]) throw new Error('Use --event, --database, --mode, and --report');
    options[args[i].slice(2)] = args[i + 1];
  }
  if (!options.event || !options.database || !['check', 'approve'].includes(options.mode) || !options.report) {
    throw new Error('Use --event, --database, --mode, and --report');
  }
  return options;
}

async function main(args = process.argv.slice(2)) {
  const options = argsToObject(args);
  let message;
  let success = false;
  try {
    const event = JSON.parse(fs.readFileSync(options.event, 'utf8'));
    const result = await processIssue(event, options.database, {
      approve: options.mode === 'approve', actor: process.env.GITHUB_ACTOR || 'local'
    });
    const item = result.kind === 'game' ? `GameDB game ${result.preset.gameId}` : `app ${result.preset.appName}`;
    const entry = result.record.presets.find(preset => preset.id === result.id);
    const methodLine = result.kind === 'game' ? `- Method: ${result.preset.method}\n` : '';
    message = `Preset ${result.action === 'replace' ? 'replacement' : 'request'} validated for ${item}.\n\n` +
      `- Host: ${result.preset.os}\n` + methodLine + `- Preset ID: \`${result.id}\`\n` +
      `- Status: ${options.mode === 'approve' ? 'approved and saved' : 'awaiting maintainer review'}\n\n` +
      `Sunshine application preview:\n\n\`\`\`json\n${JSON.stringify(entry.sunshine, null, 2)}\n\`\`\`\n`;
    success = true;
  } catch (error) {
    message = `Preset validation failed: ${String(error.message).replace(/[\r\n]+/g, ' ').slice(0, 500)}\n`;
  }
  fs.mkdirSync(path.dirname(options.report), { recursive: true });
  fs.writeFileSync(options.report, message);
  console.log(message);
  if (!success) process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { processIssue, requestKind };
