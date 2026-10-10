'use strict';

const PAGE_SIZE = 24;
const CATALOG_CHUNK_SIZE = 96;
const BROWSE_CHUNK_SIZE = 240;
const MIN_QUERY_LENGTH = 3;
const OS_FLAGS = { Windows: 2, Linux: 4, macOS: 8 };

function normalizedName(value) {
  return String(value).trim().toLowerCase();
}

function gramKey(gram) {
  return Array.from(gram, character => character.codePointAt(0).toString(16).padStart(6, '0')).join('');
}

function itemFlags(item) {
  return (item.kind === 'game' ? 1 : 0) |
    item.operating_systems.reduce((flags, os) => flags | (OS_FLAGS[os] || 0), 0);
}

function matchesFlags(code, kind, os) {
  const flags = code % 16;
  return (kind === 'all' || Boolean(flags & 1) === (kind === 'game')) &&
    (os === 'all' || Boolean(flags & OS_FLAGS[os]));
}

// Non-overlapping grams plus the final gram cover every query character. The
// stored positions make their intersection an exact substring search.
function queryGrams(query) {
  const characters = Array.from(query);
  const grams = [];
  for (let offset = 0; offset <= characters.length - 3; offset += 3) {
    grams.push({ key: gramKey(characters.slice(offset, offset + 3).join('')), offset });
  }
  const lastOffset = characters.length - 3;
  if (grams.length && grams.at(-1).offset !== lastOffset) {
    grams.push({ key: gramKey(characters.slice(lastOffset).join('')), offset: lastOffset });
  }
  return grams;
}

function containsPosition(postings, code, position) {
  let low = 0;
  let high = postings.length / 2;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const item = postings[middle * 2];
    const offset = postings[middle * 2 + 1];
    if (item < code || (item === code && offset < position)) low = middle + 1;
    else high = middle;
  }
  return postings[low * 2] === code && postings[low * 2 + 1] === position;
}

function searchPositions(grams, postings, kind, os) {
  const ordered = [...grams].sort((a, b) => postings.get(a.key).length - postings.get(b.key).length);
  const anchor = ordered[0];
  const candidates = postings.get(anchor.key);
  const results = [];
  for (let i = 0; i < candidates.length; i += 2) {
    const code = candidates[i];
    const ordinal = Math.floor(code / 16);
    const start = candidates[i + 1] - anchor.offset;
    if (start < 0 || results.at(-1) === ordinal || !matchesFlags(code, kind, os)) continue;
    if (ordered.every(gram => containsPosition(postings.get(gram.key), code, start + gram.offset))) {
      results.push(ordinal);
    }
  }
  return results;
}

class CatalogClient {
  constructor(base, fetcher = globalThis.fetch.bind(globalThis)) {
    this.base = base;
    this.fetcher = fetcher;
    this.cache = new Map();
  }

  async manifest(signal) {
    if (this.metadata) return this.metadata;
    const response = await this.fetcher(`${this.base}/catalog/manifest.json`, { signal, cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    if (manifest.schema_version !== 1 || !/^[a-f0-9]{16}$/.test(manifest.revision)) {
      throw new Error('Unsupported catalog version');
    }
    signal?.throwIfAborted();
    this.metadata = manifest;
    return manifest;
  }

  async json(file, signal, missingIsEmpty = false) {
    if (this.cache.has(file)) {
      const value = this.cache.get(file);
      this.cache.delete(file);
      this.cache.set(file, value);
      return value;
    }
    const response = await this.fetcher(`${this.base}/catalog/${this.metadata.revision}/${file}`, { signal });
    let value;
    if (missingIsEmpty && response.status === 404) value = [];
    else {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      value = await response.json();
    }
    signal?.throwIfAborted();
    this.cache.set(file, value);
    // Bound retained data even when someone searches or browses many pages.
    if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
    return value;
  }

  async search(query, kind, os, signal) {
    const grams = queryGrams(query);
    const keys = [...new Set(grams.map(gram => gram.key))];
    const postings = new Map();
    let next = 0;
    let empty = false;
    const loadNext = async () => {
      while (next < keys.length && !empty) {
        signal?.throwIfAborted();
        const key = keys[next++];
        const values = await this.json(`search/${key}.json`, signal, true);
        postings.set(key, values);
        if (!values.length) empty = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, keys.length) }, loadNext));
    return empty ? [] : searchPositions(grams, postings, kind, os);
  }

  async items(ordinals, signal) {
    const size = this.metadata.catalog_chunk_size;
    const chunks = [...new Set(ordinals.map(ordinal => Math.floor(ordinal / size)))];
    const loaded = new Map();
    let next = 0;
    const loadNext = async () => {
      while (next < chunks.length) {
        signal?.throwIfAborted();
        const chunk = chunks[next++];
        loaded.set(chunk, await this.json(`items/${chunk}.json`, signal));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, chunks.length) }, loadNext));
    return ordinals.map(ordinal => loaded.get(Math.floor(ordinal / size))[ordinal % size]);
  }

  async page({ query = '', kind = 'all', os = 'all', page = 0 } = {}, signal) {
    const manifest = await this.manifest(signal);
    if (!['all', 'game', 'app'].includes(kind) || !['all', ...Object.keys(OS_FLAGS)].includes(os)) {
      throw new Error('Invalid catalog filter');
    }
    const needle = normalizedName(query);
    if (needle && Array.from(needle).length < manifest.min_query_length) {
      return { items: [], total: 0, page: 0, page_count: 0, min_query_length: manifest.min_query_length };
    }
    let matches = null;
    if (needle) {
      const key = JSON.stringify([needle, kind, os]);
      if (this.lastSearch?.key === key) matches = this.lastSearch.matches;
      else {
        matches = await this.search(needle, kind, os, signal);
        signal?.throwIfAborted();
        this.lastSearch = { key, matches };
      }
    }
    const total = matches ? matches.length : manifest.counts[kind][os];
    const pageCount = Math.ceil(total / manifest.page_size);
    const selectedPage = Math.min(Math.max(Number.isSafeInteger(page) ? page : 0, 0), Math.max(pageCount - 1, 0));
    const start = selectedPage * manifest.page_size;
    const length = Math.min(manifest.page_size, total - start);
    let ordinals;
    if (matches) ordinals = matches.slice(start, start + length);
    else if (kind === 'all' && os === 'all') {
      ordinals = Array.from({ length }, (_, i) => start + i);
    } else if (length) {
      const chunk = Math.floor(start / manifest.browse_chunk_size);
      const values = await this.json(`browse/${kind}/${os}/${chunk}.json`, signal);
      const offset = start % manifest.browse_chunk_size;
      ordinals = values.slice(offset, offset + length);
    } else ordinals = [];
    return { items: await this.items(ordinals, signal), total, start, page: selectedPage, page_count: pageCount };
  }
}

const catalogApi = {
  PAGE_SIZE, CATALOG_CHUNK_SIZE, BROWSE_CHUNK_SIZE, MIN_QUERY_LENGTH,
  normalizedName, gramKey, itemFlags, CatalogClient
};
if (typeof module !== 'undefined') module.exports = catalogApi;
else globalThis.PresetCatalog = catalogApi;
