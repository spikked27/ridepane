const $ = id => document.getElementById(id);
const state = { mode: 'home', history: [], page: 0, section: null, player: null, session: null, audioMode: 'separate', soundOn: false, delayContext: null, delayNode: null, combinedDelayNode: null, stopped: false, pair: null, pairTimer: null, phoneAuthed: false };

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
  api('/api/me').then(me => {
    show($('home-tab'), !!me.desktop);
    setTab(me.desktop ? 'home' : 'plex');
  }).catch(() => setTab('plex'));
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
  if (state.phoneAuthed) api('/api/me').then(me => show($('desktop-phone-actions'), !!me.desktop)).catch(() => {});
}
function setTab(mode) {
  state.mode = mode;
  show($('home-panel'), mode === 'home');
  show($('quick-settings'), mode === 'plex' || mode === 'youtube');
  show($('plex-panel'), mode === 'plex');
  show($('youtube-panel'), mode === 'youtube');
  show($('diagnostics-panel'), mode === 'diagnostics');
  for (const name of ['home', 'plex', 'youtube', 'diagnostics']) {
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
  if (!state.history.length) return loadSections();
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
  state.combinedDelayNode?.disconnect(); state.combinedDelayNode = null;
  state.player?.destroy(); state.player = null;
  $('audio').pause(); $('audio').removeAttribute('src'); $('audio').load();
  state.soundOn = false;
  state.session = null;
  show($('player'), false); show($('browse'), true);
}
async function setAudioDelay(milliseconds) {
  const seconds = milliseconds / 1000;
  if (state.audioMode === 'combined') {
    const output = state.player?.audioOut;
    if (!output) throw new Error('Web Audio is unavailable for this sound mode.');
    if (!state.combinedDelayNode) {
      const node = output.context.createDelay(1.5);
      output.gain.disconnect();
      output.gain.connect(node);
      node.connect(output.context.destination);
      state.combinedDelayNode = node;
    }
    state.combinedDelayNode.delayTime.setTargetAtTime(seconds, output.context.currentTime, 0.01);
    await output.context.resume();
    return;
  }
  if (!state.delayContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser cannot delay audio.');
    const context = new AudioContextClass();
    const node = context.createDelay(1.5);
    node.connect(context.destination);
    context.createMediaElementSource($('audio')).connect(node);
    state.delayContext = context;
    state.delayNode = node;
  }
  state.delayNode.delayTime.setTargetAtTime(seconds, state.delayContext.currentTime, 0.01);
  await state.delayContext.resume();
}
async function startCombinedSound() {
  const output = state.player?.audioOut;
  if (!output) throw new Error('Web Audio is unavailable. Choose the current sound mode for the next video.');
  await output.context.resume();
  if (output.context.state !== 'running') throw new Error('Tap Start sound again to allow audio.');
  if (!output.unlocked) output.unlock();
  output.volume = 1;
  state.soundOn = true;
  $('audio-button').textContent = 'Mute sound';
  $('player-message').textContent = 'Playing';
}
async function play(payload, title) {
  setError('');
  try {
    payload.quality = $('quality').value;
    payload.audioMode = $('sound-mode').value;
    $('browse-status').textContent = 'Preparing video…';
    const data = await api('/api/play', { method: 'POST', body: JSON.stringify(payload) });
    $('browse-status').textContent = '';
    state.session = data.id; state.audioMode = data.audioMode; state.soundOn = false; state.stopped = false;
    $('audio-delay').value = '0'; $('audio-delay-value').textContent = '0 ms';
    if (state.delayNode) state.delayNode.delayTime.value = 0;
    $('player-title').textContent = title;
    $('screen-status').textContent = 'Connecting to server…';
    show($('screen-status'), true); show($('browse'), false); show($('player'), true);
    const canvas = $('screen');
    canvas.width = canvas.width;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let useWebGL = false;
    try { useWebGL = !!document.createElement('canvas').getContext('webgl'); } catch { /* Canvas2D fallback */ }
    const player = new JSMpeg.Player(`${protocol}//${location.host}/ws/${data.id}`, {
      canvas, audio: data.audioMode === 'combined', autoplay: true, loop: false, reconnectInterval: 0,
      disableWebAssembly: true, disableGl: !useWebGL, videoBufferSize: 4 * 1024 * 1024,
      onVideoDecode: () => { if (state.player === player) { show($('screen-status'), false); $('player-message').textContent = data.audioMode === 'combined' && !state.soundOn ? 'Picture playing. Tap Start sound.' : 'Playing'; } },
      onStalled: () => { if (state.player === player && !state.stopped) $('player-message').textContent = 'Buffering…'; }
    });
    state.player = player;
    if (data.audioMode === 'combined' && player.audioOut) player.audioOut.volume = 0;
    player.source.socket.addEventListener('close', async () => {
      if (state.stopped || state.player !== player) return;
      show($('screen-status'), true);
      try {
        const status = await api(`/api/session/${data.id}/status`);
        $('screen-status').textContent = status.error || 'Playback ended';
      } catch { $('screen-status').textContent = 'Playback ended'; }
    });
    const audio = $('audio');
    show(audio, data.audioMode === 'separate');
    if (data.audioMode === 'combined') {
      $('audio-button').textContent = 'Start sound';
      $('player-message').textContent = 'Starting sound…';
      try { await startCombinedSound(); }
      catch { $('player-message').textContent = 'Tap Start sound to allow audio.'; }
      return;
    }
    audio.src = `/api/session/${data.id}/audio`;
    if (state.delayContext) await state.delayContext.resume();
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
    api('/api/me').then(me => show($('desktop-phone-actions'), !!me.desktop)).catch(() => {});
  } catch (err) { $('phone-message').textContent = ''; $('phone-error').textContent = err.message; }
});
$('home-tab').addEventListener('click', () => setTab('home'));
$('plex-tab').addEventListener('click', () => setTab('plex'));
$('youtube-tab').addEventListener('click', () => setTab('youtube'));
$('diagnostics-tab').addEventListener('click', () => setTab('diagnostics'));
function desktopEncoderKey() {
  const desktop = new URL('/desktop/', location.href);
  return `${(desktop.origin + desktop.pathname).replace(/[^a-zA-Z0-9._-]/g, '_')}_encoder`;
}
async function openFullApp(site, videoMode = 'jpeg', phone = false) {
  const message = phone ? $('phone-error') : $('browse-error');
  message.textContent = '';
  try {
    await api('/api/desktop/open', { method: 'POST', body: JSON.stringify({ site }) });
    if (videoMode === 'jpeg') localStorage.setItem(desktopEncoderKey(), 'jpeg');
    else localStorage.removeItem(desktopEncoderKey());
    location.assign('/desktop/');
  } catch (err) { message.textContent = err.message; }
}
$('full-plex').addEventListener('click', () => openFullApp('plex'));
$('plex-h264').addEventListener('click', () => openFullApp('plex', 'h264'));
$('full-youtube').addEventListener('click', () => openFullApp('youtube'));
$('youtube-h264').addEventListener('click', () => openFullApp('youtube', 'h264'));
$('phone-plex').addEventListener('click', () => openFullApp('plex', 'h264', true));
$('phone-youtube').addEventListener('click', () => openFullApp('youtube', 'h264', true));
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
  if (state.audioMode === 'combined') {
    if (state.soundOn) {
      state.player.audioOut.volume = 0;
      state.soundOn = false;
      $('audio-button').textContent = 'Start sound';
    } else {
      try { await startCombinedSound(); } catch (err) { $('player-message').textContent = err.message; }
    }
    return;
  }
  const audio = $('audio');
  if (audio.paused) {
    try { if (state.delayContext) await state.delayContext.resume(); await audio.play(); $('audio-button').textContent = 'Pause audio'; } catch (err) { $('player-message').textContent = err.message; }
  } else { audio.pause(); $('audio-button').textContent = 'Start audio'; }
});
$('audio-delay').addEventListener('input', async event => {
  const milliseconds = Number(event.target.value);
  $('audio-delay-value').textContent = `${milliseconds} ms`;
  try { await setAudioDelay(milliseconds); }
  catch (err) { $('player-message').textContent = err.message; }
});

const pairCode = new URLSearchParams(location.search).get('pair');
if (pairCode) openPhonePair(pairCode);
else api('/api/me').then(openApp).catch(() => { show($('login'), true); startPairing(); });
