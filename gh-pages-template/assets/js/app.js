'use strict';

const METHOD_NAMES = {
  native: 'Native', steam: 'Steam', 'epic-games': 'Epic Games',
  gog: 'GOG', 'microsoft-store': 'Microsoft Store', emulator: 'Emulator'
};

function filterItems(index, query, kind, os) {
  const needle = query.trim().toLowerCase();
  return [
    ...(index.games || []).map(item => ({ ...item, kind: 'game' })),
    ...(index.apps || []).map(item => ({ ...item, kind: 'app' }))
  ].filter(item =>
    (kind === 'all' || item.kind === kind) &&
    (os === 'all' || item.operating_systems.includes(os)) &&
    item.name.toLowerCase().includes(needle)
  ).sort((a, b) => a.name.localeCompare(b.name));
}

function commandForOs(preset, os = 'Windows') {
  const command = preset.commands_by_os?.[os] || preset.command;
  if (!command) throw new Error('Choose an available host OS');
  return command;
}

function sunshineSnippet(preset, os = 'Windows') {
  const snippet = { name: preset.name, cmd: commandForOs(preset, os) };
  if (preset.working_directory) snippet['working-dir'] = preset.working_directory;
  return JSON.stringify(snippet, null, 2);
}

function normalizeBasePath(value) {
  const configured = String(value || '');
  if (configured.includes('{{')) return '/PresetDB';
  return ('/' + configured).replace(/\/+/g, '/').replace(/\/$/, '') || '/PresetDB';
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function safeLink(url, text) {
  const link = element('a', '', text);
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      link.href = parsed.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  } catch { /* The link stays plain text if the record has a bad URL. */ }
  return link;
}

function safeImage(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    const img = element('img', 'd-block mx-auto mb-3');
    img.src = parsed.href;
    img.alt = '';
    img.width = 100;
    img.height = 130;
    img.style.objectFit = 'contain';
    img.loading = 'lazy';
    return img;
  } catch { return null; }
}

function protonRatingLabel(preset) {
  const tier = preset.protondb?.tier;
  if (!tier) return 'Check Linux compatibility on ProtonDB';
  let label = 'ProtonDB: ' + tier[0].toUpperCase() + tier.slice(1);
  if (Number.isInteger(preset.protondb.reports)) label += ' (' + preset.protondb.reports + ' reports)';
  return label;
}

function appendProtonRating(body, preset) {
  if (!preset.protondb_url) return;
  const proton = element('p', 'card-text');
  proton.append(safeLink(preset.protondb_url, protonRatingLabel(preset)));
  body.append(proton);
}

function appendPresetBadges(body, preset, kind) {
  const badges = [];
  if (kind === 'game' && METHOD_NAMES[preset.method]) {
    badges.push(element('span', 'badge rounded-pill bg-warning text-dark me-2', METHOD_NAMES[preset.method]));
  }
  if (preset.os) badges.push(element('span', 'badge rounded-pill bg-secondary me-2', preset.os));
  if (preset.variant_name) {
    badges.push(element('span', 'badge rounded-pill bg-info text-dark me-2', preset.variant_name));
  }
  if (badges.length) {
    const row = element('div', 'mb-3');
    row.append(...badges);
    body.append(row);
  }
}

function browseMethodBadges(methods) {
  const labels = [...new Set(methods || [])].map(method => METHOD_NAMES[method]).filter(Boolean);
  if (!labels.length) return null;
  const row = element('span', 'd-block mt-3');
  for (const label of labels) {
    row.append(element('span', 'badge rounded-pill bg-warning text-dark me-2', label));
  }
  return row;
}

function hostSelection(body, preset) {
  if (!preset.commands_by_os) return null;
  const label = element('label', 'form-label', 'Host OS');
  const select = element('select', 'form-select rounded-0 mb-3');
  for (const host of Object.keys(preset.commands_by_os)) {
    const option = element('option', '', host);
    option.value = host;
    select.append(option);
  }
  label.append(select);
  body.append(label);
  return select;
}

function appendIssueLinks(body, preset) {
  if (preset.origin_issue) {
    body.append(element('span', 'ms-3'), safeLink(
      'https://github.com/LizardByte/PresetDB/issues/' + preset.origin_issue,
      'Preset issue #' + preset.origin_issue + ' ↗'
    ));
  }
  if (preset.source_issue && preset.source_issue !== preset.origin_issue) {
    body.append(element('span', 'ms-3'), safeLink(
      'https://github.com/LizardByte/PresetDB/issues/' + preset.source_issue,
      'Latest update ↗'
    ));
  }
}

function renderPresetCard(preset, kind = 'game') {
  const column = element('div', 'col');
  const card = element('article', 'card h-100 rounded-0 shadow-sm');
  const body = element('div', 'card-body');
  body.append(element('h3', 'h5 card-title fw-bold', preset.name));
  appendPresetBadges(body, preset, kind);
  if (preset.notes) body.append(element('p', 'card-text', preset.notes));
  appendProtonRating(body, preset);
  const hostSelect = hostSelection(body, preset);
  const commandText = () => commandForOs(preset, hostSelect?.value);
  const snippet = () => sunshineSnippet(preset, hostSelect?.value);
  const command = element('pre', 'p-3 rounded bg-dark text-light overflow-auto');
  const code = element('code', '', commandText());
  command.append(code);
  body.append(command);
  const copy = element('button', 'btn btn-warning rounded-0', 'Copy command');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(commandText());
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Select and copy the command above';
    }
  });
  body.append(copy);
  const details = element('details', 'mt-3');
  details.append(element('summary', 'mb-2', 'Sunshine JSON'));
  const sunshineCode = element('code', '', snippet());
  const sunshineJson = element('pre', 'p-3 rounded bg-dark text-light overflow-auto');
  sunshineJson.append(sunshineCode);
  details.append(sunshineJson);
  const copyJson = element('button', 'btn btn-outline-secondary rounded-0', 'Copy Sunshine JSON');
  copyJson.type = 'button';
  copyJson.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(snippet());
      copyJson.textContent = 'Copied';
    } catch {
      copyJson.textContent = 'Select and copy the JSON above';
    }
  });
  details.append(copyJson);
  body.append(details);
  if (hostSelect) hostSelect.addEventListener('change', () => {
    code.textContent = commandText();
    sunshineCode.textContent = snippet();
  });
  appendIssueLinks(body, preset);
  card.append(body);
  column.append(card);
  return column;
}

function boot() {
  const base = normalizeBasePath(globalThis.PRESET_BASE);
  const search = document.getElementById('preset-search');
  const kind = document.getElementById('preset-kind');
  const os = document.getElementById('preset-os');
  const list = document.getElementById('preset-list');
  const status = document.getElementById('preset-status');
  const detail = document.getElementById('preset-detail');
  let index;

  function renderList() {
    if (!index) return;
    const items = filterItems(index, search.value, kind.value, os.value);
    list.replaceChildren();
    status.textContent = items.length ? `${items.length} games and apps found` : 'No matching presets yet.';
    for (const item of items) {
      const column = element('div', 'col');
      const button = element('button', 'card h-100 w-100 text-start border-0 shadow-sm rounded-0 p-4');
      button.type = 'button';
      const image = safeImage(item.image_url);
      if (image) button.append(image);
      button.append(element('span', 'text-uppercase small text-warning fw-bold', item.kind));
      button.append(element('span', 'd-block h5 mt-2 mb-1 fw-bold', item.name));
      button.append(element('span', 'd-block text-muted', `${item.preset_count} preset${item.preset_count === 1 ? '' : 's'} · ${item.operating_systems.join(', ')}`));
      const methodBadges = browseMethodBadges(item.launch_methods);
      if (methodBadges) button.append(methodBadges);
      button.addEventListener('click', () => {
        const url = new URL(globalThis.location.href);
        url.searchParams.set('kind', item.kind);
        url.searchParams.set('id', String(item.id));
        globalThis.history.pushState(null, '', url);
        showRecord(item);
      });
      column.append(button);
      list.append(column);
    }
  }

  async function showRecord(item) {
    detail.hidden = false;
    detail.replaceChildren(element('p', '', 'Loading launch options…'));
    try {
      const folder = item.kind === 'game' ? 'games' : 'apps';
      const response = await fetch(`${base}/${folder}/${encodeURIComponent(item.id)}.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const record = await response.json();
      const heading = element('h2', 'fw-bold', record.name);
      detail.replaceChildren(heading, safeLink(record.source_url, item.kind === 'game' ? 'View on IGDB ↗' : 'Official app site ↗'));
      const image = safeImage(record.image_url);
      if (image) detail.prepend(image);
      if (record.game_db_url) detail.append(element('span', 'mx-2'), safeLink(record.game_db_url, 'View in GameDB ↗'));
      const presets = element('div', 'row row-cols-1 row-cols-lg-2 g-4 mt-2');
      for (const preset of record.presets) presets.append(renderPresetCard(preset, item.kind));
      detail.append(presets);
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      detail.replaceChildren(element('p', 'text-danger', `Could not load presets: ${error.message}`));
    }
  }

  async function load() {
    try {
      const response = await fetch(`${base}/index.json`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      index = await response.json();
      renderList();
      const params = new URLSearchParams(globalThis.location.search);
      const requestedKind = params.get('kind');
      const requestedId = params.get('id');
      if (requestedId && ['game', 'app'].includes(requestedKind)) {
        const item = filterItems(index, '', requestedKind, 'all').find(entry => String(entry.id) === requestedId);
        if (item) showRecord(item);
      }
    } catch (error) {
      status.textContent = `Could not load the preset index: ${error.message}`;
    }
  }

  for (const control of [search, kind, os]) control.addEventListener('input', renderList);
  globalThis.addEventListener('popstate', () => {
    const params = new URLSearchParams(globalThis.location.search);
    const item = index && filterItems(index, '', params.get('kind'), 'all').find(entry => String(entry.id) === params.get('id'));
    if (item) showRecord(item);
    else detail.hidden = true;
  });
  load();
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', boot);
if (typeof module !== 'undefined') module.exports = { filterItems, commandForOs, sunshineSnippet, renderPresetCard, browseMethodBadges, normalizeBasePath };
