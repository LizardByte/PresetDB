'use strict';

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

function sunshineSnippet(preset) {
  return JSON.stringify(preset.sunshine, null, 2);
}

function normalizeBasePath(value) {
  const configured = String(value || '');
  return configured.includes('{{') ? '' : `/${configured}`.replace(/\/+/g, '/').replace(/\/$/, '');
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
      for (const preset of record.presets) {
        const column = element('div', 'col');
        const card = element('article', 'card h-100 rounded-0 shadow-sm');
        const body = element('div', 'card-body');
        body.append(element('h3', 'h5 card-title fw-bold', preset.name));
        if (preset.notes) body.append(element('p', 'card-text', preset.notes));
        const command = element('pre', 'p-3 rounded bg-dark text-light overflow-auto');
        command.append(element('code', '', sunshineSnippet(preset)));
        body.append(command);
        const copy = element('button', 'btn btn-warning rounded-0', 'Copy Sunshine JSON');
        copy.type = 'button';
        copy.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(sunshineSnippet(preset));
            copy.textContent = 'Copied';
          } catch {
            copy.textContent = 'Select and copy the JSON above';
          }
        });
        body.append(copy);
        if (preset.origin_issue) body.append(element('span', 'ms-3'), safeLink(`https://github.com/LizardByte/PresetDB/issues/${preset.origin_issue}`, `Preset issue #${preset.origin_issue} ↗`));
        if (preset.source_issue && preset.source_issue !== preset.origin_issue) {
          body.append(element('span', 'ms-3'), safeLink(`https://github.com/LizardByte/PresetDB/issues/${preset.source_issue}`, 'Latest update ↗'));
        }
        card.append(body);
        column.append(card);
        presets.append(column);
      }
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
if (typeof module !== 'undefined') module.exports = { filterItems, sunshineSnippet, normalizeBasePath };
