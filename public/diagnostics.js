// These checks run in the car browser. The server only supplies an 8 MiB test transfer.
(() => {
  const $ = id => document.getElementById(id);
  const cacheName = 'ridepane-car-check-v1';
  const chunkBytes = 1024 * 1024;
  const chunkCount = 64;
  const results = {};

  function render() {
    const lines = [`Ridepane car checks · ${new Date().toLocaleString()}`];
    if (results.browser) lines.push('', 'BROWSER', ...results.browser);
    if (results.connection) lines.push('', 'CONNECTION', ...results.connection);
    if (results.cache) lines.push('', 'TEST CACHE', ...results.cache);
    $('diagnostics-report').textContent = lines.join('\n');
  }
  function status(message) { $('diagnostics-status').textContent = message; }
  async function run(action) {
    const buttons = $('diagnostics-panel').querySelectorAll('button');
    buttons.forEach(item => { item.disabled = true; });
    status('Working…');
    try { await action(); status('Done. Take a photo of the results if you want to share them.'); }
    catch (error) { status(`Check failed: ${error.message || error}`); }
    finally { buttons.forEach(item => { item.disabled = false; }); render(); }
  }
  function mib(bytes) { return `${(bytes / (1024 * 1024)).toFixed(0)} MiB`; }
  async function timedFetch(url, seconds, consume) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), seconds * 1000);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await consume(response);
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`Timed out after ${seconds} seconds`);
      throw error;
    } finally { clearTimeout(timer); }
  }
  async function storageLines() {
    if (!navigator.storage) return ['Storage estimate: unavailable'];
    const lines = [];
    try {
      const estimate = await navigator.storage.estimate();
      lines.push(`Storage used / quota: ${mib(estimate.usage || 0)} / ${estimate.quota ? mib(estimate.quota) : 'unknown'}`);
    } catch { lines.push('Storage estimate: unavailable'); }
    try {
      lines.push(`Persistent storage: ${typeof navigator.storage.persisted === 'function' && await navigator.storage.persisted() ? 'yes' : 'no or unsupported'}`);
    } catch { lines.push('Persistent storage: unknown'); }
    return lines;
  }
  async function checkBrowser() {
    let channels = 'unavailable';
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      let context;
      try { context = new AudioContextClass(); channels = String(context.destination.maxChannelCount || 'unknown'); }
      catch { channels = 'blocked'; }
      finally { if (context) await context.close().catch(() => {}); }
    }
    let webgl = false;
    try { webgl = !!document.createElement('canvas').getContext('webgl'); } catch { /* unsupported */ }
    results.browser = [
      `Screen: ${window.innerWidth} × ${window.innerHeight} CSS px; pixel ratio ${window.devicePixelRatio || 1}`,
      `WebGL: ${webgl ? 'yes' : 'no'}; WebCodecs: ${'VideoDecoder' in window ? 'yes' : 'no'}`,
      `MediaSource: ${'MediaSource' in window ? 'yes' : 'no'}; IndexedDB: ${'indexedDB' in window ? 'yes' : 'no'}`,
      `Fullscreen API: ${document.fullscreenEnabled ? 'yes' : 'no'}; max audio channels: ${channels}`,
      ...(await storageLines()),
      `Browser: ${navigator.userAgent}`
    ];
  }
  async function checkConnection() {
    const pings = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      await timedFetch(`/api/diagnostics/ping?t=${Date.now()}-${i}`, 10, response => response.arrayBuffer());
      pings.push(Math.round(performance.now() - start));
    }
    const start = performance.now();
    const bytes = await timedFetch(`/api/diagnostics/transfer?t=${Date.now()}`, 60, async response => {
      if (!response.body?.getReader) return (await response.arrayBuffer()).byteLength;
      const reader = response.body.getReader();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
      }
      return received;
    });
    const seconds = (performance.now() - start) / 1000;
    const median = pings.sort((a, b) => a - b)[1];
    if (bytes !== 8 * 1024 * 1024) throw new Error(`Received only ${mib(bytes)} of 8 MiB`);
    results.connection = [
      `Server round trip: ${median} ms median (3 checks)`,
      `Download: ${(bytes * 8 / seconds / 1000000).toFixed(1)} Mbps (${mib(bytes)} in ${seconds.toFixed(1)} s)`,
      'Path: Tesla browser → reverse proxy → Unraid. Run again while on cellular.'
    ];
  }
  function openCache() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable in this browser'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(cacheName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('chunks');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the browser cache'));
      request.onblocked = () => reject(new Error('Another Ridepane tab is holding the test cache open'));
    });
  }
  function put(db, key, value) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('chunks', 'readwrite');
      transaction.objectStore('chunks').put(value, key);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('Cache write failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Cache write was aborted'));
    });
  }
  function get(db, key) {
    return new Promise((resolve, reject) => {
      const request = db.transaction('chunks', 'readonly').objectStore('chunks').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Cache read failed'));
    });
  }
  function clearCache() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB is unavailable in this browser'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(cacheName);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error || new Error('Could not clear the test cache'));
      request.onblocked = () => reject(new Error('Close other Ridepane tabs and try again'));
    });
  }
  async function writeCache() {
    await clearCache();
    const db = await openCache();
    const chunk = new Uint8Array(chunkBytes);
    let written = 0;
    try {
      for (let i = 0; i < chunkCount; i++) {
        chunk.fill(i);
        await put(db, i, chunk);
        written++;
        if (i % 8 === 7) status(`Saved ${written} of ${chunkCount} MiB…`);
      }
      await put(db, 'meta', { created: Date.now(), count: chunkCount, bytes: chunkCount * chunkBytes });
      results.cache = [`Saved ${chunkCount} MiB at ${new Date().toLocaleString()}`, 'Close and reopen the Tesla browser, then tap Verify saved cache.', ...(await storageLines())];
    } catch (error) {
      results.cache = [`Cache write stopped at ${written} MiB: ${error.message || error}`];
      throw error;
    } finally { db.close(); }
  }
  async function verifyCache() {
    const db = await openCache();
    try {
      const meta = await get(db, 'meta');
      if (!meta || meta.count !== chunkCount) {
        results.cache = ['No complete test cache found. The browser may have cleared it.'];
        return;
      }
      for (let i = 0; i < chunkCount; i++) {
        const chunk = await get(db, i);
        if (!chunk || chunk.byteLength !== chunkBytes || chunk[0] !== i || chunk[chunkBytes - 1] !== i) {
          results.cache = [`Test cache is incomplete at chunk ${i + 1} of ${chunkCount}.`];
          return;
        }
        if (i % 8 === 7) status(`Verified ${i + 1} of ${chunkCount} MiB…`);
      }
      results.cache = [`64 MiB verified; saved ${new Date(meta.created).toLocaleString()}`, 'Retention passed for this browser session. This does not guarantee full movie storage.', ...(await storageLines())];
    } finally { db.close(); }
  }

  $('diagnostics-browser').addEventListener('click', () => run(checkBrowser));
  $('diagnostics-speed').addEventListener('click', () => run(checkConnection));
  $('diagnostics-cache-write').addEventListener('click', () => run(writeCache));
  $('diagnostics-cache-verify').addEventListener('click', () => run(verifyCache));
  $('diagnostics-cache-clear').addEventListener('click', () => run(async () => {
    await clearCache();
    results.cache = ['Test cache cleared.'];
  }));
})();
