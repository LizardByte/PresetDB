'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main, issueTitle } = require('../src/issue');

test('issue command writes a contributor review with the short preset ID and command preview', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-issue-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const eventFile = path.join(root, 'event.json');
  const reportFile = path.join(root, 'report.md');
  const titleFile = path.join(root, 'issue-title.txt');
  fs.writeFileSync(eventFile, JSON.stringify({ issue: {
    number: 51,
    labels: ['request-app-preset'],
    body: [
      '### App name', 'App One',
      '### Official app URL', 'https://example.org/app',
      '### Host operating system', 'Windows',
      '### Command', 'app.exe'
    ].join('\n\n')
  } }));
  await main(['--event', eventFile, '--database', path.join(root, 'database'),
    '--mode', 'check', '--report', reportFile, '--title-output', titleFile]);
  const report = fs.readFileSync(reportFile, 'utf8');
  assert.equal(fs.readFileSync(titleFile, 'utf8').trim(), '[APP PRESET]: App One (Windows)');
  assert.ok(report.includes('Preset ID: ' + String.fromCharCode(96) + '51' + String.fromCharCode(96)));
  assert.match(report, /Launch command preview:/);
  assert.match(report, /"command": "app.exe"/);
  assert.match(report, /awaiting maintainer review/);
  assert.doesNotMatch(report, /sunshine/);
});

test('validated issue titles identify launch method and keep it out of the preset name', () => {
  assert.equal(issueTitle({ kind: 'game', gameName: '007 First Light', method: 'steam' }),
    '[STEAM GAME PRESET]: 007 First Light');
  assert.equal(issueTitle({ kind: 'game', gameName: 'Example', method: 'native', os: 'Linux' }),
    '[NATIVE GAME PRESET]: Example (Linux)');
  assert.equal(issueTitle({ kind: 'game', gameName: 'Example', method: 'emulator',
    variantName: 'RetroArch Snes9x' }),
  '[EMULATOR GAME PRESET]: Example (RetroArch Snes9x)');
});
