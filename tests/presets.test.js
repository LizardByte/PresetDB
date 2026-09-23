'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseIssue, validateFields, validateGameDb, resolveIgdbSlug } = require('../src/presets');
const { mergePreset } = require('../src/database');
const { processIssue } = require('../src/issue');
const { buildSite } = require('../src/build-site');
const { filterItems, sunshineSnippet, normalizeBasePath } = require('../gh-pages-template/assets/js/app');

const credentials = { clientId: 'client-id', clientSecret: 'client-secret' };
const gameValues = {
  gameUrl: 'https://www.igdb.com/games/one-tap-hero', os: 'Windows', method: 'Emulator',
  variantName: 'RetroArch Snes9x', command: 'retroarch -L snes9x "{{ROM_PATH}}"',
  workingDir: '{{HOME}}', notes: 'Install the core first.'
};

function mockApis(url, options) {
  if (url === 'https://id.twitch.tv/oauth2/token') {
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('client_id'), credentials.clientId);
    assert.equal(options.body.get('client_secret'), credentials.clientSecret);
    return Promise.resolve({ ok: true, json: async () => ({ access_token: 'test-token' }) });
  }
  if (url === 'https://api.igdb.com/v4/games') {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Client-ID'], credentials.clientId);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.match(options.body, /where slug = "one-tap-hero"/);
    return Promise.resolve({ ok: true, json: async () => [{ id: 100245, slug: 'one-tap-hero' }] });
  }
  assert.equal(url, 'https://app.lizardbyte.dev/GameDB/games/100245.json');
  return Promise.resolve({ ok: true, json: async () => ({
    id: 100245, name: 'One Tap Hero', slug: 'one-tap-hero',
    cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/cover.jpg' }
  }) });
}

function formBody(values) {
  const labels = {
    gameUrl: 'IGDB game URL', appName: 'App name', appUrl: 'Official app URL',
    appImageUrl: 'App image URL', os: 'Host operating system', method: 'Launch method',
    launchId: 'Launch ID',
    variantName: 'Emulator variant name', command: 'Command', workingDir: 'Working directory',
    notes: 'Notes', replacementIssue: 'Preset to replace (issue number)',
    replacementReason: 'Replacement reason'
  };
  return Object.entries(values).map(([key, value]) => `### ${labels[key]}\n\n${value}`).join('\n\n');
}

test('form parses the slug URL and rejects duplicate fields', () => {
  assert.equal(parseIssue(formBody(gameValues)).command, gameValues.command);
  assert.throws(() => parseIssue(`${formBody(gameValues)}\n\n### Command\n\nother`), /Duplicate issue field/);
});

test('game submission needs no ID and validates path placeholders', () => {
  const preset = validateFields(gameValues, 'game');
  assert.equal(preset.gameId, null);
  assert.equal(preset.gameSlug, 'one-tap-hero');
  assert.equal(preset.variantName, 'RetroArch Snes9x');
  assert.equal(validateFields({ ...gameValues, command: '{{PROGRAM_FILES}}\\Game\\game.exe' }, 'game').os, 'Windows');
  assert.throws(() => validateFields({ ...gameValues, os: 'Linux', command: '{{PROGRAM_FILES}}/game' }, 'game'), /Windows only/);
  assert.throws(() => validateFields({ ...gameValues, command: '{{EMULATOR_PATH}} -L core' }, 'game'), /unsupported placeholder/);
  assert.throws(() => validateFields({ ...gameValues, command: '{{rom_path}}' }, 'game'), /malformed path placeholder/);
  for (const command of ['C:\\Users\\Alice\\Game\\game.exe', '%USERPROFILE%\\Game\\game.exe']) {
    assert.throws(() => validateFields({ ...gameValues, command }, 'game'), /literal home directory/);
  }
  for (const workingDir of ['C:\\Games\\CON.txt', 'C:\\Games\\COM1\\Game', 'C:\\Games\\COM\u00B9']) {
    assert.throws(() => validateFields({ ...gameValues, workingDir }, 'game'), /reserved Windows device name/);
  }
  assert.throws(() => validateFields({ ...gameValues, os: 'Linux', workingDir: '/home/alice/Games' }, 'game'),
    /literal home directory/);
  assert.throws(() => validateFields({ ...gameValues, os: 'macOS', workingDir: '/Users/alice/Games' }, 'game'),
    /literal home directory/);
  assert.throws(() => validateFields({ ...gameValues, workingDir: '~/Games' }, 'game'), /literal home directory/);
});

test('IGDB slug resolves to ID and GameDB verifies it', async () => {
  const preset = await validateGameDb(validateFields(gameValues, 'game'), mockApis, credentials);
  assert.equal(preset.gameId, 100245);
  assert.equal(preset.gameName, 'One Tap Hero');
  assert.match(preset.gameImageUrl, /^https:\/\/images\.igdb\.com\//);
  await assert.rejects(validateGameDb(validateFields(gameValues, 'game'), async (url, options) =>
    url.includes('GameDB') ? { ok: true, json: async () => ({ id: 100245, name: 'Other', slug: 'other' }) } : mockApis(url, options),
  credentials), /does not match/);
  await assert.rejects(validateGameDb(validateFields(gameValues, 'game'), async (url, options) =>
    url.includes('GameDB') ? { ok: false, status: 404 } : mockApis(url, options),
  credentials), /HTTP 404/);
});

test('IGDB resolution rejects missing credentials and missing or ambiguous records', async () => {
  await assert.rejects(resolveIgdbSlug('one-tap-hero', { fetcher: mockApis, clientId: '', clientSecret: '' }), /credentials/);
  for (const games of [[], [{ id: 1, slug: 'one-tap-hero' }, { id: 2, slug: 'one-tap-hero' }]]) {
    await assert.rejects(resolveIgdbSlug('one-tap-hero', { ...credentials, fetcher: async (url, options) =>
      url.includes('/v4/games') ? { ok: true, json: async () => games } : mockApis(url, options)
    }), /exactly one game/);
  }
});

test('apps use an HTTPS image URL and have separate review identity', () => {
  const values = { appName: 'My App', appUrl: 'https://example.org/app', appImageUrl: 'https://example.org/icon.png',
    os: 'macOS', command: '{{HOME}}/Applications/my-app' };
  const app = validateFields(values, 'app');
  assert.equal(app.appId, 'my-app');
  assert.equal(app.appImageUrl, values.appImageUrl);
  assert.throws(() => validateFields({ ...values, appUrl: 'http://example.org' }, 'app'), /HTTPS/);
  assert.throws(() => validateFields({ ...values, appImageUrl: 'C:\\icon.png' }, 'app'), /image URL/);
  assert.throws(() => validateFields({ ...values, appName: 'CON' }, 'app'), /reserved Windows file name/);
  assert.throws(() => validateFields({ ...values, command: '{{APP_PATH}}' }, 'app'), /unsupported placeholder/);
  assert.equal(app.method, 'native');
  assert.throws(() => validateFields({ ...values, method: 'Steam' }, 'app'), /do not have a launch method/);
  assert.throws(() => validateFields({ ...values, launchId: '464920' }, 'app'), /Launch ID requires/);
  assert.throws(() => validateFields({ ...values, command: '{{ROM_PATH}}' }, 'app'), /ROM_PATH.*Emulator/);
});

test('store IDs generate OS-specific Sunshine commands', () => {
  const base = { ...gameValues, variantName: '', command: '', workingDir: '' };
  const steamCommands = {
    Windows: 'cmd /c start "" "steam://rungameid/464920"',
    Linux: 'steam "steam://rungameid/464920"',
    macOS: 'open "steam://rungameid/464920"'
  };
  for (const [os, command] of Object.entries(steamCommands)) {
    const preset = validateFields({ ...base, os, method: 'Steam', launchId: '464920' }, 'game');
    assert.equal(preset.command, command);
    assert.equal(preset.launchId, '464920');
  }
  const epic = 'fn%3A4fe75bbc5a674f4f9b356b5c90567da5%3AFortnite';
  const epicUri = 'com.epicgames.launcher://apps/' + epic + '?action=launch&silent=true';
  for (const [os, command] of [
    ['Windows', 'cmd /c start "" "' + epicUri + '"'],
    ['macOS', 'open "' + epicUri + '"']
  ]) {
    const preset = validateFields({ ...base, os, method: 'Epic Games',
      launchId: 'fn:4fe75bbc5a674f4f9b356b5c90567da5:Fortnite' }, 'game');
    assert.equal(preset.launchId, epic);
    assert.equal(preset.command, command);
  }
  const aumid = 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App';
  const store = validateFields({ ...base, method: 'Microsoft Store', launchId: aumid }, 'game');
  assert.equal(store.command, 'explorer.exe shell:AppsFolder\\' + aumid);
  assert.equal(store.launchId, aumid);
  assert.equal(parseIssue(formBody({ ...base, method: 'Steam', launchId: '464920' })).launchId, '464920');
});

test('store IDs validate syntax, method, and host OS', () => {
  const base = { ...gameValues, variantName: '', command: '', workingDir: '' };
  assert.throws(() => validateFields({ ...base, method: 'Steam' }, 'game'), /Steam app ID/);
  assert.throws(() => validateFields({ ...base, method: 'Steam', launchId: '1&whoami' }, 'game'), /Steam app ID/);
  assert.throws(() => validateFields({ ...base, method: 'Steam', launchId: '4294967296' }, 'game'), /Steam app ID/);
  assert.throws(() => validateFields({ ...base, method: 'Steam', launchId: '464920',
    command: 'other.exe' }, 'game'), /Do not provide a command/);
  assert.throws(() => validateFields({ ...base, method: 'Steam', launchId: '464920',
    workingDir: '{{HOME}}' }, 'game'), /Working directory is not used/);
  assert.throws(() => validateFields({ ...base, method: 'Native', launchId: '464920',
    command: 'game.exe' }, 'game'), /Launch ID requires/);
  assert.throws(() => validateFields({ ...base, method: 'Epic Games', os: 'Linux',
    launchId: 'fn:catalog:Fortnite' }, 'game'), /Windows and macOS only/);
  assert.throws(() => validateFields({ ...base, method: 'Epic Games',
    launchId: 'fn:catalog:Game&calc' }, 'game'), /Epic launch ID/);
  assert.throws(() => validateFields({ ...base, method: 'Microsoft Store',
    launchId: '9WZDNCRFHVJL' }, 'game'), /Microsoft Store AUMID/);
  assert.throws(() => validateFields({ ...base, method: 'Microsoft Store', os: 'Linux',
    launchId: 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App' }, 'game'), /Windows only/);
});

test('Native, GOG, and Emulator still require reviewed commands', () => {
  const base = { ...gameValues, variantName: '', command: '', workingDir: '' };
  for (const method of ['Native', 'GOG', 'Emulator']) {
    assert.throws(() => validateFields({ ...base, method }, 'game'), /command is required/);
  }
  assert.equal(validateFields({ ...base, method: 'GOG', command: 'game.exe' }, 'game').command, 'game.exe');
  assert.throws(() => validateFields({ ...base, method: 'Other', command: 'game.exe' }, 'game'),
    /supported game launch method/);
  assert.throws(() => validateFields({ ...base, method: 'Native', command: 'steam://rungameid/464920' }, 'game'),
    /Launcher URIs require/);
  assert.throws(() => validateFields({ ...base, method: 'Native', command: '{{ROM_PATH}}' }, 'game'),
    /ROM_PATH.*Emulator/);
  assert.throws(() => validateFields({ ...base, method: 'Native', command: 'game.exe',
    variantName: 'Alternate' }, 'game'), /Emulator/);
});

test('approved presets get issue IDs and replacements preserve identity', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-db-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = await validateGameDb(validateFields(gameValues, 'game'), mockApis, credentials);
  assert.equal(mergePreset(root, first, { issueNumber: 10, approvedBy: 'maintainer' }, { write: true }).id, 'issue-10');
  assert.throws(() => mergePreset(root, first, { issueNumber: 11, approvedBy: 'maintainer' }), /already exists/);
  assert.throws(() => mergePreset(root, { ...first, variantName: 'retroarch snes9x' },
    { issueNumber: 11, approvedBy: 'maintainer' }), /already exists/);
  const second = await validateGameDb(validateFields({ ...gameValues, variantName: 'RetroArch Bsnes' }, 'game'), mockApis, credentials);
  mergePreset(root, second, { issueNumber: 12, approvedBy: 'maintainer' }, { write: true });
  const replacement = await validateGameDb(validateFields({ ...gameValues, command: 'new-command',
    replacementIssue: '10', replacementReason: 'Old command failed' }, 'game'), mockApis, credentials);
  assert.equal(mergePreset(root, replacement, { issueNumber: 13, approvedBy: 'maintainer' }, { write: true }).id, 'issue-10');
  const record = JSON.parse(fs.readFileSync(path.join(root, 'games/100245.json')));
  assert.equal(record.presets.length, 2);
  assert.equal(record.presets.find(item => item.id === 'issue-10').sunshine.cmd, 'new-command');
  assert.equal(record.presets.find(item => item.id === 'issue-10').name, 'One Tap Hero (Windows, Emulator: RetroArch Snes9x)');
  assert.equal(record.presets.find(item => item.id === 'issue-10').origin_issue, 10);
  assert.equal(record.presets.find(item => item.id === 'issue-10').source_issue, 13);
  assert.throws(() => validateFields({ ...gameValues, replacementIssue: '10' }, 'game'), /replacement needs both/);
  assert.throws(() => mergePreset(root, { ...first, replacementIssue: 99, replacementReason: 'Fix' },
    { issueNumber: 14, approvedBy: 'maintainer' }), /No preset/);
});

test('Steam app ID publishes a generated Sunshine command without detached or image paths', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-steam-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const steam = await validateGameDb(validateFields({ ...gameValues, method: 'Steam',
    variantName: '', command: '', workingDir: '', launchId: '464920' }, 'game'), mockApis, credentials);
  const { record } = mergePreset(root, steam, { issueNumber: 30, approvedBy: 'reviewer' }, { write: true });
  assert.equal(record.presets[0].launch_id, '464920');
  assert.equal(record.presets[0].sunshine.cmd, 'cmd /c start "" "steam://rungameid/464920"');
  assert.equal(record.presets[0].sunshine.name, 'One Tap Hero (Windows, Steam)');
  assert.ok(!Object.hasOwn(record.presets[0].sunshine, 'detached'));
  assert.ok(!Object.hasOwn(record.presets[0].sunshine, 'image-path'));
});

test('issue processing and site build publish both game and app JSON', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-site-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = path.join(root, 'database');
  const output = path.join(root, 'site');
  await processIssue({ issue: { number: 21, labels: [{ name: 'request-game-preset' }], body: formBody(gameValues) } },
    database, { approve: true, actor: 'reviewer', fetcher: mockApis, credentials });
  await processIssue({ issue: { number: 22, labels: [{ name: 'request-app-preset' }], body: formBody({
    appName: 'App One', appUrl: 'https://example.org', appImageUrl: 'https://example.org/icon.png',
    os: 'Linux', command: '{{HOME}}/app-one'
  }) } }, database, { approve: true, actor: 'reviewer' });
  const index = buildSite(database, path.join(__dirname, '..', 'gh-pages-template'), output);
  assert.equal(index.games[0].preset_count, 1);
  assert.equal(index.apps[0].id, 'app-one');
  assert.equal(index.apps[0].image_url, 'https://example.org/icon.png');
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'apps/app-one.json'))).presets[0].name, 'App One (Linux)');
  assert.ok(fs.existsSync(path.join(output, 'games/100245.json')));
  assert.ok(fs.existsSync(path.join(output, 'apps/app-one.json')));
  assert.ok(fs.existsSync(path.join(output, 'top_contributors.svg')));
  assert.ok(fs.existsSync(path.join(output, 'preset_growth.svg')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'stats.json'))).preset_count, 2);
  assert.ok(!fs.readFileSync(path.join(output, 'index.json'), 'utf8').includes('{{ROM_PATH}}'));
});

test('site filters and serializes Sunshine application JSON', () => {
  const index = { games: [{ id: 1, name: 'Halo', operating_systems: ['Windows'], preset_count: 2 }],
    apps: [{ id: 'app', name: 'Media', operating_systems: ['Linux'], preset_count: 1 }] };
  assert.deepEqual(filterItems(index, 'hal', 'game', 'Windows').map(item => item.name), ['Halo']);
  assert.equal(filterItems(index, '', 'all', 'macOS').length, 0);
  assert.equal(JSON.parse(sunshineSnippet({ sunshine: { name: 'Halo', cmd: 'game.exe' } })).cmd, 'game.exe');
  assert.equal(normalizeBasePath('/PresetDB'), '/PresetDB');
  assert.equal(normalizeBasePath('en/pr-123'), '/en/pr-123');
});
