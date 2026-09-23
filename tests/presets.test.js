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
const { filterItems, commandForOs, sunshineSnippet, normalizeBasePath } = require('../gh-pages-template/assets/js/app');

const credentials = { clientId: 'client-id', clientSecret: 'client-secret' };
const gameValues = {
  gameUrl: 'https://www.igdb.com/games/one-tap-hero', method: 'Emulator',
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

test('emulator needs no OS and validates portable path placeholders', () => {
  const preset = validateFields(gameValues, 'game');
  assert.equal(preset.gameId, null);
  assert.equal(preset.gameSlug, 'one-tap-hero');
  assert.equal(preset.os, null);
  assert.equal(preset.variantName, 'RetroArch Snes9x');
  assert.throws(() => validateFields({ ...gameValues, os: 'Windows' }, 'game'), /does not accept a host OS/);
  assert.throws(() => validateFields({ ...gameValues, command: '{{PROGRAM_FILES}}/game' }, 'game'), /Windows only/);
  assert.throws(() => validateFields({ ...gameValues, command: '{{EMULATOR_PATH}} -L core' }, 'game'), /unsupported placeholder/);
  assert.throws(() => validateFields({ ...gameValues, command: '{{rom_path}}' }, 'game'), /malformed path placeholder/);
  for (const command of ['C:\\Users\\Alice\\Game\\game.exe', '%USERPROFILE%\\Game\\game.exe']) {
    assert.throws(() => validateFields({ ...gameValues, command }, 'game'), /literal home directory/);
  }
  for (const workingDir of ['C:\\Games\\CON.txt', 'C:\\Games\\COM1\\Game']) {
    assert.throws(() => validateFields({ ...gameValues, workingDir }, 'game'), /reserved Windows device name/);
  }
  assert.throws(() => validateFields({ ...gameValues, workingDir: '/home/alice/Games' }, 'game'),
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

test('store IDs generate commands for each launcher OS without asking for OS', () => {
  const base = { ...gameValues, variantName: '', command: '', workingDir: '' };
  const steam = validateFields({ ...base, method: 'Steam', launchId: '464920' }, 'game');
  assert.equal(steam.os, null);
  assert.deepEqual(steam.commandsByOs, {
    Windows: 'steam://rungameid/464920',
    Linux: 'setsid steam steam://rungameid/464920',
    macOS: 'open steam://rungameid/464920'
  });
  const epic = validateFields({ ...base, method: 'Epic Games',
    launchId: 'fn:4fe75bbc5a674f4f9b356b5c90567da5:Fortnite' }, 'game');
  assert.equal(epic.launchId, 'fn%3A4fe75bbc5a674f4f9b356b5c90567da5%3AFortnite');
  assert.deepEqual(epic.commandsByOs, {
    Windows: 'com.epicgames.launcher://apps/fn%3A4fe75bbc5a674f4f9b356b5c90567da5%3AFortnite?action=launch&silent=true',
    macOS: 'open com.epicgames.launcher://apps/fn%3A4fe75bbc5a674f4f9b356b5c90567da5%3AFortnite?action=launch&silent=true'
  });
  const aumid = 'Microsoft.WindowsCalculator_8wekyb3d8bbwe!App';
  const store = validateFields({ ...base, method: 'Microsoft Store', launchId: aumid }, 'game');
  assert.deepEqual(store.commandsByOs, { Windows: 'explorer.exe shell:AppsFolder\\' + aumid });
  assert.equal(parseIssue(formBody({ ...base, method: 'Steam', launchId: '464920' })).launchId, '464920');
});

test('store IDs validate syntax and reject host OS or manual commands', () => {
  const base = { ...gameValues, variantName: '', command: '', workingDir: '' };
  assert.throws(() => validateFields({ ...base, method: 'Steam' }, 'game'), /Steam app ID/);
  assert.throws(() => validateFields({ ...base, method: 'Steam', launchId: '1&whoami' }, 'game'), /Steam app ID/);
  assert.throws(() => validateFields({ ...base, method: 'Steam', launchId: '4294967296' }, 'game'), /Steam app ID/);
  assert.throws(() => validateFields({ ...base, method: 'Steam', launchId: '464920',
    command: 'other.exe' }, 'game'), /Do not provide a command/);
  assert.throws(() => validateFields({ ...base, method: 'Steam', launchId: '464920',
    workingDir: '{{HOME}}' }, 'game'), /Working directory is not used/);
  assert.throws(() => validateFields({ ...base, method: 'Native', os: 'Windows', launchId: '464920',
    command: 'game.exe' }, 'game'), /Launch ID requires/);
  assert.throws(() => validateFields({ ...base, method: 'Epic Games', os: 'Linux',
    launchId: 'fn:catalog:Fortnite' }, 'game'), /does not accept a host OS/);
  assert.throws(() => validateFields({ ...base, method: 'Epic Games',
    launchId: 'fn:catalog:Game&calc' }, 'game'), /Epic launch ID/);
  assert.throws(() => validateFields({ ...base, method: 'Microsoft Store',
    launchId: '9WZDNCRFHVJL' }, 'game'), /Microsoft Store AUMID/);
});

test('Native and GOG require OS; Emulator accepts a portable command', () => {
  const base = { ...gameValues, variantName: '', command: '', workingDir: '' };
  for (const method of ['Native', 'GOG']) {
    assert.throws(() => validateFields({ ...base, method }, 'game'), /os is required/);
    assert.throws(() => validateFields({ ...base, method, os: 'Windows' }, 'game'), /command is required/);
  }
  assert.throws(() => validateFields({ ...base, method: 'Emulator' }, 'game'), /command is required/);
  assert.equal(validateFields({ ...base, method: 'GOG', os: 'Windows', command: 'game.exe' }, 'game').command,
    'game.exe');
  assert.throws(() => validateFields({ ...base, method: 'Other', command: 'game.exe' }, 'game'),
    /supported game launch method/);
  assert.throws(() => validateFields({ ...base, method: 'Native', os: 'Windows',
    command: 'steam://rungameid/464920' }, 'game'), /Launcher URIs require/);
  assert.throws(() => validateFields({ ...base, method: 'Native', os: 'Windows',
    command: '{{ROM_PATH}}' }, 'game'), /ROM_PATH.*Emulator/);
  assert.throws(() => validateFields({ ...base, method: 'Native', os: 'Windows',
    command: 'game.exe', variantName: 'Alternate' }, 'game'), /Emulator/);
});

test('approved presets get issue IDs and replacements preserve identity', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-db-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = await validateGameDb(validateFields(gameValues, 'game'), mockApis, credentials);
  assert.equal(mergePreset(root, first, { issueNumber: 10, approvedBy: 'maintainer' }, { write: true }).id, '10');
  assert.throws(() => mergePreset(root, first, { issueNumber: 11, approvedBy: 'maintainer' }), /already exists/);
  assert.throws(() => mergePreset(root, { ...first, variantName: 'retroarch snes9x' },
    { issueNumber: 11, approvedBy: 'maintainer' }), /already exists/);
  const second = await validateGameDb(validateFields({ ...gameValues, variantName: 'RetroArch Bsnes' }, 'game'), mockApis, credentials);
  mergePreset(root, second, { issueNumber: 12, approvedBy: 'maintainer' }, { write: true });
  const replacement = await validateGameDb(validateFields({ ...gameValues, command: 'new-command',
    replacementIssue: '10', replacementReason: 'Old command failed' }, 'game'), mockApis, credentials);
  assert.equal(mergePreset(root, replacement, { issueNumber: 13, approvedBy: 'maintainer' }, { write: true }).id, '10');
  const record = JSON.parse(fs.readFileSync(path.join(root, 'games/100245.json')));
  assert.equal(record.schema_version, 2);
  assert.equal(record.presets.length, 2);
  assert.deepEqual(record.presets.map(item => item.id), ['10', '12']);
  assert.equal(record.presets.find(item => item.id === '10').command, 'new-command');
  assert.equal(record.presets.find(item => item.id === '10').name, 'One Tap Hero');
  assert.equal(record.presets.find(item => item.id === '10').origin_issue, 10);
  assert.equal(record.presets.find(item => item.id === '10').source_issue, 13);
  assert.throws(() => validateFields({ ...gameValues, replacementIssue: '10' }, 'game'), /replacement needs both/);
  assert.throws(() => mergePreset(root, { ...first, replacementIssue: 99, replacementReason: 'Fix' },
    { issueNumber: 14, approvedBy: 'maintainer' }), /No preset/);
});

test('Steam app ID publishes one logical preset with host-specific commands', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-steam-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const steam = await validateGameDb(validateFields({ ...gameValues, method: 'Steam',
    variantName: '', command: '', workingDir: '', launchId: '464920' }, 'game'), mockApis, credentials);
  const { record } = mergePreset(root, steam, { issueNumber: 30, approvedBy: 'reviewer' }, { write: true });
  assert.equal(record.presets[0].launch_id, '464920');
  assert.equal(record.presets[0].commands_by_os.Windows, 'steam://rungameid/464920');
  assert.equal(record.presets[0].commands_by_os.Linux, 'setsid steam steam://rungameid/464920');
  assert.equal(record.presets[0].name, 'One Tap Hero');
  assert.ok(!Object.hasOwn(record.presets[0], 'detached'));
  assert.ok(!Object.hasOwn(record.presets[0], 'image-path'));
});

test('issue processing and site build publish both game and app JSON', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-site-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = path.join(root, 'database');
  const output = path.join(root, 'site');
  await processIssue({ issue: { number: 21, labels: [{ name: 'request-game-preset' }, { name: 'method-emulator' }], body: formBody(gameValues) } },
    database, { approve: true, actor: 'reviewer', fetcher: mockApis, credentials });
  await processIssue({ issue: { number: 22, labels: [{ name: 'request-app-preset' }], body: formBody({
    appName: 'App One', appUrl: 'https://example.org', appImageUrl: 'https://example.org/icon.png',
    os: 'Linux', command: '{{HOME}}/app-one'
  }) } }, database, { approve: true, actor: 'reviewer' });
  const index = await buildSite(database, path.join(__dirname, '..', 'gh-pages-template'), output);
  assert.equal(index.games[0].preset_count, 1);
  assert.deepEqual(index.games[0].operating_systems, ['Linux', 'macOS', 'Windows']);
  assert.equal(index.apps[0].id, 'app-one');
  assert.equal(index.apps[0].image_url, 'https://example.org/icon.png');
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'apps/app-one.json'))).presets[0].name, 'App One');
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
  assert.equal(commandForOs({ command: 'game.exe' }), 'game.exe');
  assert.deepEqual(JSON.parse(sunshineSnippet({ name: 'Halo', command: 'game.exe', working_directory: 'C:\\Games' })),
    { name: 'Halo', cmd: 'game.exe', 'working-dir': 'C:\\Games' });
  assert.throws(() => commandForOs({ commands_by_os: { Windows: 'game.exe' } }, 'Linux'), /available host OS/);
  assert.equal(normalizeBasePath('/PresetDB'), '/PresetDB');
  assert.equal(normalizeBasePath('en/pr-123'), '/en/pr-123');
});

test('Pages build adds a ProtonDB tier to Steam presets and keeps the source link', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-proton-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = path.join(root, 'database');
  const output = path.join(root, 'site');
  const steam = await validateGameDb(validateFields({ ...gameValues, method: 'Steam',
    variantName: '', command: '', workingDir: '', launchId: '464920' }, 'game'), mockApis, credentials);
  mergePreset(database, steam, { issueNumber: 31, approvedBy: 'reviewer' }, { write: true });
  const fetcher = async url => {
    assert.equal(url, 'https://www.protondb.com/api/v1/reports/summaries/464920.json');
    return { ok: true, json: async () => ({ tier: 'gold', total: 73 }) };
  };
  const index = await buildSite(database, path.join(__dirname, '..', 'gh-pages-template'), output, fetcher);
  assert.deepEqual(index.games[0].operating_systems, ['Linux', 'macOS', 'Windows']);
  const published = JSON.parse(fs.readFileSync(path.join(output, 'games/100245.json')));
  assert.deepEqual(published.presets[0].protondb, { tier: 'gold', reports: 73 });
  assert.equal(published.presets[0].protondb_url, 'https://www.protondb.com/app/464920');
  assert.equal(JSON.parse(sunshineSnippet(published.presets[0], 'Linux')).cmd,
    'setsid steam steam://rungameid/464920');
});

test('legacy approved records publish generic commands and short IDs', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-legacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = path.join(root, 'database');
  const output = path.join(root, 'site');
  fs.mkdirSync(path.join(database, 'games'), { recursive: true });
  const record = {
    schema_version: 1, kind: 'game', id: 100245, name: 'One Tap Hero',
    source_url: 'https://www.igdb.com/games/one-tap-hero',
    presets: [{ id: 'issue-4', name: 'One Tap Hero', os: null, method: 'steam',
      launch_id: '464920', origin_issue: 4, source_issue: 4,
      sunshine_by_os: { Windows: { cmd: 'cmd /c start "" "steam://rungameid/464920"' },
        Linux: { cmd: 'steam "steam://rungameid/464920"' },
        macOS: { cmd: 'open "steam://rungameid/464920"' } } }]
  };
  fs.writeFileSync(path.join(database, 'games/100245.json'), JSON.stringify(record));
  await buildSite(database, path.join(__dirname, '..', 'gh-pages-template'), output,
    async () => ({ ok: false, status: 404 }));
  const published = JSON.parse(fs.readFileSync(path.join(output, 'games/100245.json')));
  assert.equal(published.schema_version, 2);
  assert.equal(published.presets[0].id, '4');
  assert.deepEqual(published.presets[0].commands_by_os, {
    Windows: 'steam://rungameid/464920',
    Linux: 'setsid steam steam://rungameid/464920',
    macOS: 'open steam://rungameid/464920'
  });
  assert.ok(!Object.hasOwn(published.presets[0], 'sunshine_by_os'));
  const replacement = await validateGameDb(validateFields({ ...gameValues, method: 'Steam',
    variantName: '', command: '', workingDir: '', launchId: '464920',
    replacementIssue: '4', replacementReason: 'Refresh the launcher command' }, 'game'), mockApis, credentials);
  const merged = mergePreset(database, replacement, { issueNumber: 50, approvedBy: 'reviewer' }, { write: true });
  assert.equal(merged.id, '4');
  const stored = JSON.parse(fs.readFileSync(path.join(database, 'games/100245.json')));
  assert.equal(stored.schema_version, 2);
  assert.equal(stored.presets[0].id, '4');
  assert.equal(stored.presets[0].source_issue, 50);
  assert.equal(stored.presets[0].commands_by_os.Linux, 'setsid steam steam://rungameid/464920');
});

test('game method labels select the form and reject conflicting issue fields', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-method-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const issue = { number: 42, body: formBody({ gameUrl: gameValues.gameUrl,
    launchId: '464920' }), labels: ['request-game-preset', 'method-steam'] };
  const result = await processIssue({ issue }, root, { fetcher: mockApis, credentials });
  assert.equal(result.preset.method, 'steam');
  await assert.rejects(processIssue({ issue: { ...issue, labels: ['request-game-preset'] } },
    root, { fetcher: mockApis, credentials }), /exactly one launch method label/);
  await assert.rejects(processIssue({ issue: { ...issue,
    labels: ['request-game-preset', 'method-steam', 'method-native'] } },
  root, { fetcher: mockApis, credentials }), /exactly one launch method label/);
  await assert.rejects(processIssue({ issue: { ...issue,
    body: formBody({ gameUrl: gameValues.gameUrl, method: 'Native', launchId: '464920' }) } },
  root, { fetcher: mockApis, credentials }), /does not match its template/);
});

test('missing ProtonDB ratings remain unknown without failing the Pages build', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-proton-missing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const database = path.join(root, 'database');
  const output = path.join(root, 'site');
  const steam = await validateGameDb(validateFields({ ...gameValues, method: 'Steam',
    variantName: '', command: '', workingDir: '', launchId: '464920' }, 'game'), mockApis, credentials);
  mergePreset(database, steam, { issueNumber: 43, approvedBy: 'reviewer' }, { write: true });
  await buildSite(database, path.join(__dirname, '..', 'gh-pages-template'), output,
    async () => ({ ok: false, status: 404 }));
  const published = JSON.parse(fs.readFileSync(path.join(output, 'games/100245.json')));
  assert.equal(published.presets[0].protondb, null);
  assert.equal(published.presets[0].protondb_url, 'https://www.protondb.com/app/464920');
});
