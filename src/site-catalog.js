'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  PAGE_SIZE, CATALOG_CHUNK_SIZE, BROWSE_CHUNK_SIZE, MIN_QUERY_LENGTH,
  normalizedName, gramKey, itemFlags
} = require('../gh-pages-template/assets/js/catalog');

function writeJson(root, file, value) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value) + '\n');
}

function writeChunks(root, folder, values, size) {
  for (let start = 0; start < values.length; start += size) {
    writeJson(root, `${folder}/${start / size}.json`, values.slice(start, start + size));
  }
}

function browseOrdinals(items, kind, os) {
  const ordinals = [];
  for (let ordinal = 0; ordinal < items.length; ordinal++) {
    const item = items[ordinal];
    if ((kind === 'all' || item.kind === kind) &&
        (os === 'all' || item.operating_systems.includes(os))) ordinals.push(ordinal);
  }
  return ordinals;
}

function writeBrowseChunks(root, items, counts) {
  for (const kind of ['all', 'game', 'app']) {
    counts[kind] = {};
    for (const os of ['all', 'Windows', 'Linux', 'macOS']) {
      const ordinals = browseOrdinals(items, kind, os);
      counts[kind][os] = ordinals.length;
      if (kind !== 'all' || os !== 'all') {
        writeChunks(root, `browse/${kind}/${os}`, ordinals, BROWSE_CHUNK_SIZE);
      }
    }
  }
}

function writeSearchIndex(root, items) {
  const postings = new Map();
  for (let ordinal = 0; ordinal < items.length; ordinal++) {
    const item = items[ordinal];
    const characters = Array.from(normalizedName(item.name));
    const code = ordinal * 16 + itemFlags(item);
    for (let offset = 0; offset <= characters.length - MIN_QUERY_LENGTH; offset++) {
      const key = gramKey(characters.slice(offset, offset + MIN_QUERY_LENGTH).join(''));
      if (!postings.has(key)) postings.set(key, []);
      postings.get(key).push(code, offset);
    }
  }
  for (const [key, values] of postings) writeJson(root, `search/${key}.json`, values);
}

function buildCatalog(index, output) {
  const items = [
    ...index.games.map(item => ({ ...item, kind: 'game' })),
    ...index.apps.map(item => ({ ...item, kind: 'app' }))
  ].sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind) ||
    String(a.id).localeCompare(String(b.id)));
  const manifest = {
    schema_version: 1, page_size: PAGE_SIZE, catalog_chunk_size: CATALOG_CHUNK_SIZE,
    browse_chunk_size: BROWSE_CHUNK_SIZE, min_query_length: MIN_QUERY_LENGTH, counts: {}
  };
  manifest.revision = createHash('sha256').update(JSON.stringify({ manifest, items })).digest('hex').slice(0, 16);
  const root = path.join(output, 'catalog', manifest.revision);
  writeChunks(root, 'items', items, CATALOG_CHUNK_SIZE);
  writeBrowseChunks(root, items, manifest.counts);
  writeSearchIndex(root, items);
  writeJson(output, 'catalog/manifest.json', manifest);
  return manifest;
}

module.exports = { buildCatalog };
