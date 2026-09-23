'use strict';

const GAME_DB = 'https://app.lizardbyte.dev/GameDB';
const PATH_PLACEHOLDERS = new Set(['ROM_PATH', 'HOME', 'SYSTEM_DRIVE', 'PROGRAM_FILES', 'PROGRAM_FILES_X86']);
const WINDOWS_PATH_PLACEHOLDERS = new Set(['SYSTEM_DRIVE', 'PROGRAM_FILES', 'PROGRAM_FILES_X86']);
const FIELD_NAMES = {
  'IGDB game URL': 'gameUrl',
  'App name': 'appName',
  'Official app URL': 'appUrl',
  'App image URL': 'appImageUrl',
  'Host operating system': 'os',
  'Launch method': 'method',
  'Preset name': 'presetName',
  Command: 'command',
  'Working directory': 'workingDir',
  Notes: 'notes',
  'Preset to replace (issue number)': 'replacementIssue',
  'Replacement reason': 'replacementReason'
};

class PresetError extends Error {}

function parseIssue(body) {
  const result = {};
  const sections = body.split(/^### (.+)\s*$/m);
  for (let i = 1; i < sections.length; i += 2) {
    const key = FIELD_NAMES[sections[i].trim()];
    if (key) {
      if (Object.hasOwn(result, key)) throw new PresetError(`Duplicate issue field: ${key}`);
      const value = sections[i + 1].trim();
      result[key] = value === '_No response_' ? '' : value;
    }
  }
  return result;
}

function field(values, name, { required = false, limit = 1024, singleLine = false } = {}) {
  const value = String(values[name] || '').trim();
  if (required && !value) throw new PresetError(`${name} is required`);
  if (value.length > limit || /[\x00-\x08\x0B-\x1F\x7F]/.test(value) || (singleLine && /[\r\n]/.test(value))) {
    throw new PresetError(`${name} is too long or contains invalid characters`);
  }
  return value;
}

function positiveId(value, label) {
  if (!/^[1-9][0-9]{0,14}$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new PresetError(`${label} must be a positive issue number`);
  }
  return Number(value);
}

function slug(value) {
  const result = value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!result) throw new PresetError('Name must contain letters or digits');
  return result;
}

function validatePlaceholders(value, os, label) {
  const tokens = [...value.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)];
  const remainder = value.replace(/\{\{[A-Z0-9_]+\}\}/g, '');
  if (remainder.includes('{{') || remainder.includes('}}')) {
    throw new PresetError(`${label} contains a malformed path placeholder`);
  }
  for (const [, token] of tokens) {
    if (!PATH_PLACEHOLDERS.has(token)) throw new PresetError(`${label} uses unsupported placeholder {{${token}}}`);
    if (os !== 'Windows' && WINDOWS_PATH_PLACEHOLDERS.has(token)) {
      throw new PresetError(`{{${token}}} is available on Windows only`);
    }
  }
}

function validateFields(values, kind) {
  if (kind !== 'game' && kind !== 'app') throw new PresetError('Exactly one request type is required');
  const os = field(values, 'os', { required: true, limit: 20, singleLine: true });
  const method = field(values, 'method', { required: true, limit: 30, singleLine: true });
  if (!['Windows', 'Linux', 'macOS'].includes(os) ||
      !['Native', 'Steam', 'Epic Games', 'GOG', 'Emulator', 'Other'].includes(method)) {
    throw new PresetError('Choose a supported host OS and launch method');
  }
  const presetName = field(values, 'presetName', { required: true, limit: 100, singleLine: true });

  let gameId = null;
  let gameSlug = null;
  let appName = null;
  let appUrl = null;
  let appId = null;
  let appImageUrl = null;
  if (kind === 'game') {
    const gameUrl = field(values, 'gameUrl', { required: true, limit: 300, singleLine: true });
    let url;
    try { url = new URL(gameUrl); } catch { throw new PresetError('IGDB game URL is invalid'); }
    const match = url.pathname.match(/^\/games\/([a-z0-9-]+)\/?$/);
    if (url.origin !== 'https://www.igdb.com' || url.search || url.hash || !match) {
      throw new PresetError('IGDB game URL must be https://www.igdb.com/games/<slug>');
    }
    gameSlug = match[1];
  } else {
    appName = field(values, 'appName', { required: true, limit: 100, singleLine: true });
    appId = slug(appName);
    appUrl = field(values, 'appUrl', { required: true, limit: 500, singleLine: true });
    let url;
    try { url = new URL(appUrl); } catch { throw new PresetError('Official app URL must be a valid HTTPS URL'); }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
      throw new PresetError('Official app URL must be a valid HTTPS URL');
    }
    appImageUrl = field(values, 'appImageUrl', { limit: 500, singleLine: true });
    if (appImageUrl) {
      try { url = new URL(appImageUrl); } catch { throw new PresetError('App image URL must be a valid HTTPS URL'); }
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
        throw new PresetError('App image URL must be a valid HTTPS URL');
      }
    }
  }

  const command = field(values, 'command', { required: true, singleLine: true });
  const workingDir = field(values, 'workingDir', { limit: 512, singleLine: true });
  validatePlaceholders(command, os, 'Launch command');
  validatePlaceholders(workingDir, os, 'Working directory');
  const steamUri = /steam:\/\//i.test(command);
  const epicUri = /com\.epicgames\.launcher:\/\//i.test(command);
  if (steamUri && method !== 'Steam') {
    throw new PresetError('Steam URI requires the Steam launch method');
  }
  if (epicUri && method !== 'Epic Games') {
    throw new PresetError('Epic Games URI requires the Epic Games launch method');
  }
  if (steamUri) {
    const uri = 'steam:\/\/(?:rungameid\/[0-9]+|open\/bigpicture)';
    const pattern = os === 'Windows' ? `^${uri}$` : os === 'Linux' ? `^setsid steam ${uri}$` : `^open ${uri}$`;
    if (!new RegExp(pattern, 'i').test(command)) {
      throw new PresetError(`Steam URI must use Sunshine's ${os} command form`);
    }
  }
  if (epicUri) {
    if (os !== 'Windows' || !/^com\.epicgames\.launcher:\/\/apps\/[^\s?]+(?:\?[^\s]+)?$/i.test(command)) {
      throw new PresetError('Epic Games launcher URI is supported for Windows only');
    }
  }

  const replacementText = field(values, 'replacementIssue', { limit: 15, singleLine: true });
  const replacementIssue = replacementText ? positiveId(replacementText, 'Preset to replace') : null;
  const replacementReason = field(values, 'replacementReason', { limit: 500 });
  if (Boolean(replacementIssue) !== Boolean(replacementReason)) {
    throw new PresetError('A replacement needs both the existing issue number and a reason');
  }
  return {
    kind, gameId, gameSlug, appId, appName, appUrl, appImageUrl, presetName, replacementIssue,
    os, method: slug(method), command, commandMode: steamUri ? 'detached' : 'cmd',
    workingDir: workingDir || null,
    notes: field(values, 'notes', { limit: 2000 }) || null,
    replacementReason
  };
}

async function fetchGameDb(id, fetcher = globalThis.fetch) {
  let response;
  try {
    response = await fetcher(`${GAME_DB}/games/${id}.json`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  } catch (error) {
    throw new PresetError(`GameDB game ${id} lookup failed: ${error.message}`);
  }
  if (!response.ok) throw new PresetError(`GameDB game ${id} lookup returned HTTP ${response.status}`);
  let record;
  try { record = await response.json(); } catch { throw new PresetError(`GameDB game ${id} returned invalid JSON`); }
  if (!record || record.id !== id || typeof record.name !== 'string' || !record.name.trim() ||
      typeof record.slug !== 'string') {
    throw new PresetError(`GameDB game ${id} returned an invalid record`);
  }
  return record;
}

async function resolveIgdbSlug(gameSlug, {
  fetcher = globalThis.fetch,
  clientId = process.env.TWITCH_CLIENT_ID,
  clientSecret = process.env.TWITCH_CLIENT_SECRET
} = {}) {
  if (!clientId || !clientSecret) throw new PresetError('IGDB credentials are not configured');
  let tokenResponse;
  try {
    tokenResponse = await fetcher('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    throw new PresetError(`IGDB authentication failed: ${error.message}`);
  }
  if (!tokenResponse.ok) throw new PresetError(`IGDB authentication returned HTTP ${tokenResponse.status}`);
  let accessToken;
  try { accessToken = (await tokenResponse.json()).access_token; } catch { /* checked below */ }
  if (typeof accessToken !== 'string' || !accessToken) throw new PresetError('IGDB authentication returned no access token');

  let gameResponse;
  try {
    gameResponse = await fetcher('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Client-ID': clientId, Authorization: `Bearer ${accessToken}` },
      body: `fields id,slug; where slug = "${gameSlug}"; limit 2;`,
      signal: AbortSignal.timeout(15000)
    });
  } catch (error) {
    throw new PresetError(`IGDB slug lookup failed: ${error.message}`);
  }
  if (!gameResponse.ok) throw new PresetError(`IGDB slug lookup returned HTTP ${gameResponse.status}`);
  let games;
  try { games = await gameResponse.json(); } catch { throw new PresetError('IGDB slug lookup returned invalid JSON'); }
  if (!Array.isArray(games) || games.length !== 1 || games[0]?.slug !== gameSlug ||
      !Number.isSafeInteger(games[0]?.id) || games[0].id <= 0) {
    throw new PresetError(`IGDB did not return exactly one game for slug ${gameSlug}`);
  }
  return games[0].id;
}

async function validateGameDb(preset, fetcher = globalThis.fetch, credentials = {}) {
  if (preset.kind === 'app') return preset;
  preset.gameId = await resolveIgdbSlug(preset.gameSlug, { fetcher, ...credentials });
  const game = await fetchGameDb(preset.gameId, fetcher);
  if (game.slug !== preset.gameSlug) {
    throw new PresetError(`IGDB slug ${preset.gameSlug} does not match GameDB game ${preset.gameId} (${game.slug})`);
  }
  preset.gameName = game.name;
  const cover = game.cover?.url;
  preset.gameImageUrl = typeof cover === 'string' && /^\/\/images\.igdb\.com\//.test(cover)
    ? `https:${cover}` : null;
  return preset;
}

module.exports = { PresetError, parseIssue, validateFields, validateGameDb, fetchGameDb, resolveIgdbSlug, validatePlaceholders, slug };
