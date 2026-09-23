'use strict';

importScripts('catalog.js');

let catalog;
let current;
globalThis.addEventListener('message', async event => {
  // Dedicated worker messages use an empty origin; reject other foreign origins.
  if (event.origin !== '' && event.origin !== globalThis.location.origin) return;
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const { id, base, ...options } = event.data;
  if (!catalog || catalog.base !== base) catalog = new PresetCatalog.CatalogClient(base);
  try {
    const result = await catalog.page(options, controller.signal);
    if (!controller.signal.aborted) globalThis.postMessage({ id, result });
  } catch (error) {
    if (!controller.signal.aborted) globalThis.postMessage({ id, error: error.message });
  }
});
