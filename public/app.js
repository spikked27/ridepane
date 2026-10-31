const $ = id => document.getElementById(id);
const state = { mode: 'plex', history: [], page: 0, section: null, player: null, session: null, stopped: false, pair: null, pairTimer: null, phoneAuthed: false };

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  let value;
  try { value = await response.json(); } catch { value = {}; }
  if (!response.ok) throw new Error(value.error || `Server returned ${response.status}.`);
  return value;
}
function show(element, visible) { element.classList.toggle('hidden', !visible); }
function setError(message) { $('browse-error').textContent = message || ''; }
function openApp() {
  clearTimeout(state.pairTimer);
  state.pair = null;
  show($('login'), false); show($('pair-phone'), false); show($('app'), true);
  api('/api/me').then(me => show($('desktop-tab'), !!me.desktop)).catch(() => {});
  loadSections();
}
async function startPairing() {
  clearTimeout(state.pairTimer);
  $('pair-help').textContent = 'Preparing a pairing code…';
  try {
    const pair = await api('/api/pair/start', { method: 'POST', body: '{}' });
    state.pair = pair;
    $('pair-code').textContent = pair.code;
    $('pair-qr').src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pair.qrSvg);
    $('pair-help').textContent = 'Open the link on your phone, sign in there, and approve this screen.';
    pollPairing(pair);
  } catch (err) { $('pair-help').textContent = err.message; }
}
async function pollPairing(pair) {
  if (state.pair !== pair) return;
  try {
    const status = await api('/api/pair/status', { method: 'POST', body: JSON.stringify({ code: pair.code, claim: pair.claim }) });
    if (status.approved) return openApp();
  } catch (err) {
    if (state.pair === pair) { $('pair-help').textContent = err.message; state.pairTimer = setTimeout(startPairing, 2000); }
    return;
  }
  state.pairTimer = setTimeout(() => pollPairing(pair), 2000);
}
async function openPhonePair(code) {
  show($('pair-phone'), true);
  $('phone-code').textContent = code;
  state.phoneAuthed = await api('/api/me').then(() => true).catch(() => false);
  show($('phone-password-wrap'), !state.phoneAuthed);
  if (state.phoneAuthed) api('/api/me').then(me => show($('desktop-phone-link'), !!me.desktop)).catch(() => {});
}
function setTab(mode) {
  state.mode = mode;
  show($('plex-panel'), mode === 'plex');
  show($('youtube-panel'), mode === 'youtube');
  show($('diagnostics-panel'), mode === 'diagnostics');
  for (const name of ['plex', 'youtube', 'diagnostics']) {
    $(`${name}-tab`).classList.toggle('active', mode === name);
    $(`${name}-tab`).setAttribute('aria-current', mode === name ? 'page' : 'false');
  }
  setError('');
}

function renderList(items, append = false) {
  const list = $('plex-list');
  if (!append) list.replaceChildren();
  if (!items.length && !append) {
    const empty = document.createElement('p');
    empty.className = 'muted empty';
    empty.textContent = 'No titles found here.';
    list.append(empty);
  }
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'media-card';
    const art = document.createElement('span');
    art.className = 'card-art';
    art.textContent = item.playable ? '▶' : item.type === 'show' ? '▣' : '▤';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const detail = document.createElement('small');
    detail.textContent = [item.subtitle, item.year].filter(Boolean).join(' · ') || (item.playable ? 'Play video' : 'Browse titles');
    button.append(art, title, detail);
    button.addEventListener('click', () => item.playable ? play({ source: 'plex', id: item.id }, item.title) : browseChildren(item));
    list.append(button);
  }
}
async function loadSections() {
  $('list-title').textContent = 'Libraries';
  show($('back'), false);
  show($('more'), false);
  state.history = [];
  state.section = null;
  setError('');
  try {
    const data = await api('/api/plex/sections');
    $('plex-list').replaceChildren();
    for (const item of data.items) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'media-card library-card';
      const art = document.createElement('span'); art.className = 'card-art'; art.textContent = item.type === 'show' ? '▣' : '▶';
      const title = document.createElement('strong'); title.textContent = item.title;
      const detail = document.createElement('small'); detail.textContent = item.type === 'show' ? 'TV library' : 'Movie library';
      button.append(art, title, detail);
      button.addEventListener('click', () => loadSection(item));
      $('plex-list').append(button);
    }
  } catch (err) { setError(err.message); }
}
async function loadSection(section, page = 0) {
  setError('');
  $('list-title').textContent = section.title;
  show($('back'), true);
  state.section = section;
  state.page = page;
  try {
    const data = await api(`/api/plex/items?section=${encodeURIComponent(section.id)}&page=${page}`);
    renderList(data.items, page > 0);
    show($('more'), data.hasMore);
  } catch (err) { setError(err.message); }
}
async function browseChildren(item) {
  setError('');
  state.history.push({ id: item.id, title: item.title });
  $('list-title').textContent = item.title;
  show($('back'), true); show($('more'), false);
  try { renderList((await api(`/api/plex/children?id=${encodeURIComponent(item.id)}`)).items); }
  catch (err) { setError(err.message); }
}
async function goBack() {
  state.history.pop();
  if (state.history.length) {
    const last = state.history.at(-1);
    $('list-title').textContent = last.title;
    try { renderList((await api(`/api/plex/children?id=${encodeURIComponent(last.id)}`)).items); }
    catch (err) { setError(err.message); }
  } else if (state.section) await loadSection(state.section);
  else await loadSections();
}

function stopLocal() {
  state.stopped = true;
  state.player?.destroy(); state.player = null;
  $('audio').pause(); $('audio').removeAttribute('src'); $('audio').load();
  state.session = null;
  show($('player'), false); show($('browse'), true);
}
async function play(payload, title) {
  setError('');
  try {
    payload.quality = $('quality').value;
    $('browse-status').textContent = 'Preparing video…';
    const data = await api('/api/play', { method: 'POST', body: JSON.stringify(payload) });
    $('browse-status').textContent = '';
    state.session = data.id; state.stopped = false;
    $('player-title').textContent = title;
    $('screen-status').textContent = 'Connecting to server…';
    show($('screen-status'), true); show($('browse'), false); show($('player'), true);
    const canvas = $('screen');
    canvas.width = canvas.width;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let useWebGL = false;
    try { useWebGL = !!document.createElement('canvas').getContext('webgl'); } catch { /* Canvas2D fallback */ }
    const player = new JSMpeg.Player(`${protocol}//${location.host}/ws/${data.id}`, {
      canvas, audio: false, autoplay: true, loop: false, reconnectInterval: 0,
      disableWebAssembly: true, disableGl: !useWebGL, videoBufferSize: 4 * 1024 * 1024,
      onVideoDecode: () => { if (state.player === player) { show($('screen-status'), false); $('player-message').textContent = 'Playing'; } },
      onStalled: () => { if (state.player === player && !state.stopped) $('player-message').textContent = 'Buffering…'; }
    });
    state.player = player;
    player.source.socket.addEventListener('close', async () => {
      if (state.stopped || state.player !== player) return;
      show($('screen-status'), true);
      try {
        const status = await api(`/api/session/${data.id}/status`);
        $('screen-status').textContent = status.error || 'Playback ended';
      } catch { $('screen-status').textContent = 'Playback ended'; }
    });
    const audio = $('audio');
    audio.src = `/api/session/${data.id}/audio`;
    $('player-message').textContent = 'Starting audio…';
    await audio.play().then(() => { $('audio-button').textContent = 'Pause audio'; }).catch(() => {
      $('player-message').textContent = 'Tap Start audio to begin playback.';
      $('audio-button').textContent = 'Start audio';
    });
  } catch (err) { $('browse-status').textContent = ''; stopLocal(); setError(err.message); }
}

$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('password').value }) });
    $('password').value = ''; openApp();
  } catch (err) { $('login-error').textContent = err.message; }
});
$('refresh-pair').addEventListener('click', startPairing);
$('pair-form').addEventListener('submit', async event => {
  event.preventDefault(); $('phone-error').textContent = ''; $('phone-message').textContent = 'Approving…';
  try {
    if (!state.phoneAuthed) {
      await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('phone-password').value }) });
      state.phoneAuthed = true;
    }
    await api('/api/pair/approve', { method: 'POST', body: JSON.stringify({ code: $('phone-code').textContent }) });
    $('phone-password').value = '';
    show($('phone-password-wrap'), false);
    $('phone-message').textContent = 'Approved. The car screen will sign in automatically.';
    $('pair-form').querySelector('button').disabled = true;
    api('/api/me').then(me => show($('desktop-phone-link'), !!me.desktop)).catch(() => {});
  } catch (err) { $('phone-message').textContent = ''; $('phone-error').textContent = err.message; }
});
$('plex-tab').addEventListener('click', () => setTab('plex'));
$('youtube-tab').addEventListener('click', () => setTab('youtube'));
$('diagnostics-tab').addEventListener('click', () => setTab('diagnostics'));
$('sound-check').addEventListener('click', async () => {
  const result = $('sound-capability');
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) { result.textContent = 'This browser does not expose Web Audio output information.'; return; }
  let context;
  try {
    context = new AudioContextClass();
    const channels = context.destination.maxChannelCount;
    result.textContent = Number.isInteger(channels) && channels > 0
      ? `Browser reports up to ${channels} output channel${channels === 1 ? '' : 's'}. Ridepane currently sends stereo.`
      : 'This browser did not report its output channel count.';
  } catch { result.textContent = 'Could not check this browser’s audio output.'; }
  finally { await context?.close().catch(() => {}); }
});
$('back').addEventListener('click', goBack);
$('more').addEventListener('click', () => loadSection(state.section, state.page + 1));
$('youtube-form').addEventListener('submit', event => { event.preventDefault(); play({ source: 'youtube', url: $('youtube-url').value }, 'YouTube video'); });
$('stop').addEventListener('click', async () => { try { await api('/api/stop', { method: 'POST', body: '{}' }); } catch { /* local close still works */ } stopLocal(); });
$('audio-button').addEventListener('click', async () => {
  const audio = $('audio');
  if (audio.paused) {
    try { await audio.play(); $('audio-button').textContent = 'Pause audio'; } catch (err) { $('player-message').textContent = err.message; }
  } else { audio.pause(); $('audio-button').textContent = 'Start audio'; }
});

const pairCode = new URLSearchParams(location.search).get('pair');
if (pairCode) openPhonePair(pairCode);
else api('/api/me').then(openApp).catch(() => { show($('login'), true); startPairing(); });
