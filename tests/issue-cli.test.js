'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../src/issue');

test('issue command writes a contributor review with the short preset ID and command preview', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-issue-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const eventFile = path.join(root, 'event.json');
  const reportFile = path.join(root, 'report.md');
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
    '--mode', 'check', '--report', reportFile]);
  const report = fs.readFileSync(reportFile, 'utf8');
  assert.ok(report.includes('Preset ID: ' + String.fromCharCode(96) + '51' + String.fromCharCode(96)));
  assert.match(report, /Launch command preview:/);
  assert.match(report, /"command": "app.exe"/);
  assert.match(report, /awaiting maintainer review/);
  assert.doesNotMatch(report, /sunshine/);
});
