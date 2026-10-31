import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import { youtubeUrl, numberId, plexItem, mediaPart, qualityConfig, audioMode, youtubeInputs } from './lib.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8080);
const password = process.env.APP_PASSWORD;
const plexUrl = process.env.PLEX_URL;
const plexToken = process.env.PLEX_TOKEN;
const desktopBase = process.env.DESKTOP_URL ? new URL(process.env.DESKTOP_URL) : null;
const loginAttempts = new Map();
const pairs = new Map();
const diagnosticBytes = 8 * 1024 * 1024;
const diagnosticPayload = crypto.randomBytes(diagnosticBytes);
let activeDiagnosticTransfers = 0;
let active = null;
let lastSession = null;

if (!password || password.length < 12 || !plexUrl || !plexToken) {
  console.error('Set APP_PASSWORD (at least 12 characters), PLEX_URL and PLEX_TOKEN.');
  process.exit(1);
}
const sessionKey = crypto.scryptSync(password, 'ridepane-session-v1', 32);
const plexBase = new URL(plexUrl);
if (!['http:', 'https:'].includes(plexBase.protocol)) throw new Error('PLEX_URL must use HTTP or HTTPS.');
if (desktopBase && desktopBase.protocol !== 'http:') throw new Error('DESKTOP_URL must use HTTP on a private Docker network.');

function cookie(req) {
  return (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('ridepane='))?.slice(9);
}
function sessionToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 180 * 86400000, id: crypto.randomUUID() })).toString('base64url');
  const signature = crypto.createHmac('sha256', sessionKey).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}
function authed(req) {
  const value = cookie(req);
  if (!value || value.length > 500) return false;
  const [payload, signature, extra] = value.split('.');
  if (!payload || !signature || extra) return false;
  const expected = crypto.createHmac('sha256', sessionKey).update(payload).digest('base64url');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); }
  catch { return false; }
}
function setSessionCookie(req, res) {
  const secure = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `ridepane=${sessionToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=15552000${secure ? '; Secure' : ''}`);
}
function prunePairs() {
  const now = Date.now();
  for (const [code, pair] of pairs) if (pair.expires < now) pairs.delete(code);
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function error(res, status, message) { json(res, status, { error: message }); }
async function body(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 8192) throw new Error('Request is too large.');
  }
  try { return JSON.parse(data); } catch { throw new Error('Invalid JSON.'); }
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  const origin = new URL(req.headers.origin);
  return origin.host === req.headers.host && ['http:', 'https:'].includes(origin.protocol);
}
function desktopHeaders(req) {
  const headers = { ...req.headers, host: desktopBase.host };
  if (headers.cookie) headers.cookie = headers.cookie.split(';').map(value => value.trim()).filter(value => !value.startsWith('ridepane=')).join('; ');
  delete headers.authorization;
  delete headers['proxy-authorization'];
  return headers;
}
function desktopTarget(req) {
  const url = new URL(req.url, 'http://localhost');
  return new URL(url.pathname + url.search, desktopBase);
}
function proxyDesktop(req, res) {
  const upstream = http.request(desktopTarget(req), { method: req.method, headers: desktopHeaders(req) }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) error(res, 502, 'YouTube desktop is unavailable.'); else res.destroy(); });
  req.pipe(upstream);
}
function proxyDesktopSocket(req, socket, head) {
  const upstream = http.request(desktopTarget(req), { headers: desktopHeaders(req) });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    const headers = Object.entries(response.headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headers}\r\n`);
    if (head.length) remote.write(head);
    if (remoteHead.length) socket.write(remoteHead);
    remote.pipe(socket).pipe(remote);
    socket.on('error', () => remote.destroy());
    remote.on('error', () => socket.destroy());
  });
  upstream.on('response', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
  upstream.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
  upstream.end();
}
async function plexGet(endpoint) {
  const url = new URL(endpoint, plexBase);
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Plex-Token': plexToken, 'X-Plex-Product': 'Ridepane' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error(`Plex returned ${response.status}.`);
  return (await response.json()).MediaContainer;
}
function normalize(items) { return (items || []).map(plexItem); }

function wsFrame(socket, payload) {
  if (!socket.writable || socket.destroyed) return false;
  const length = payload.length;
  const header = length < 126 ? Buffer.from([0x82, length])
    : length < 65536 ? Buffer.from([0x82, 126, length >> 8, length & 255])
      : Buffer.from([0x82, 127, 0, 0, 0, 0, (length / 0x1000000) & 255, (length >> 16) & 255, (length >> 8) & 255, length & 255]);
  return socket.write(Buffer.concat([header, payload]));
}

function ffHeaders(format) {
  const headers = format?.http_headers || {};
  return Object.entries(headers).filter(([name, value]) => /^[A-Za-z0-9-]+$/.test(name) && typeof value === 'string' && !/[\r\n]/.test(value))
    .map(([name, value]) => `${name}: ${value}\r\n`).join('');
}

async function resolveYouTube(url, height) {
  const format = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;
  const child = spawn(process.env.YTDLP_BIN || 'yt-dlp',
    ['--no-playlist', '--no-warnings', '--js-runtimes', 'node', '--dump-single-json', '-f', format, url],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  return await new Promise((resolve, reject) => {
    let output = '', problem = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('YouTube lookup timed out.')); }, 30000);
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.length > 8 * 1024 * 1024) { child.kill('SIGKILL'); finish(new Error('YouTube response was too large.')); }
    });
    child.stderr.on('data', chunk => { problem = (problem + chunk.toString()).slice(-500); });
    child.on('error', err => finish(new Error(`YouTube extractor failed: ${err.message}`)));
    child.on('exit', code => {
      if (code !== 0) return finish(new Error(`YouTube lookup failed: ${problem.trim() || `exit ${code}`}`));
      try { finish(null, youtubeInputs(JSON.parse(output))); }
      catch (err) { finish(err); }
    });
  });
}

function stopSession(session, message) {
  if (!session || session.stopped) return;
  session.stopped = true;
  lastSession = { id: session.id, error: message || null };
  session.ffmpeg?.kill('SIGKILL');
  session.audio?.end();
  session.socket?.end();
  if (active === session) active = null;
}
function startSession(session) {
  if (session.started || session.stopped || !session.socket || (session.audioMode === 'separate' && !session.audio)) return;
  session.started = true;
  const input = session.source === 'plex'
    ? ['-headers', `X-Plex-Token: ${plexToken}\r\n`, '-re', '-i', new URL(session.part, plexBase).toString()]
    : [
      ...(ffHeaders(session.inputs.video) ? ['-headers', ffHeaders(session.inputs.video)] : []),
      '-re', '-i', session.inputs.video.url,
      ...(session.inputs.audio ? [
        ...(ffHeaders(session.inputs.audio) ? ['-headers', ffHeaders(session.inputs.audio)] : []),
        '-re', '-i', session.inputs.audio.url
      ] : [])
    ];
  const quality = session.quality;
  const audioMap = session.source === 'youtube' && session.inputs.audio ? '1:a:0?' : '0:a:0?';
  const videoArgs = [
    '-map', '0:v:0', '-vf', `scale=${quality.width}:${quality.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${quality.width}:${quality.height}:(ow-iw)/2:(oh-ih)/2,fps=${quality.fps}`,
    '-pix_fmt', 'yuv420p', '-c:v', 'mpeg1video', '-b:v', quality.videoRate, '-maxrate', quality.maxRate,
    '-bufsize', quality.buffer, '-g', String(quality.fps), '-bf', '0'];
  const args = session.audioMode === 'combined'
    ? ['-hide_banner', '-loglevel', 'error', '-nostdin', ...input, ...videoArgs,
      '-map', audioMap, '-ac', '2', '-ar', '48000', '-c:a', 'mp2', '-b:a', '384k',
      '-f', 'mpegts', '-muxdelay', '0.001', 'pipe:1']
    : ['-hide_banner', '-loglevel', 'error', '-nostdin', ...input,
      ...videoArgs, '-an', '-f', 'mpegts', '-muxdelay', '0.1', 'pipe:1',
      '-map', audioMap, '-vn', '-ac', '2', '-ar', '48000', '-b:a', '320k', '-c:a', 'libmp3lame', '-compression_level', '0', '-f', 'mp3', 'pipe:3'];
  const ffmpeg = spawn(process.env.FFMPEG_BIN || 'ffmpeg', args, { stdio: session.audioMode === 'combined' ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe', 'pipe'] });
  session.ffmpeg = ffmpeg;
  let stderr = '';
  ffmpeg.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-1000); });
  ffmpeg.stdout.on('data', chunk => {
    if (!wsFrame(session.socket, chunk)) {
      ffmpeg.stdout.pause();
      session.socket.once('drain', () => ffmpeg.stdout.resume());
    }
  });
  if (session.audioMode === 'separate') ffmpeg.stdio[3].pipe(session.audio);
  ffmpeg.on('error', err => stopSession(session, `Video converter failed: ${err.message}`));
  ffmpeg.on('exit', code => {
    if (!session.stopped) stopSession(session, code === 0 ? undefined : `Playback ended: ${(stderr.trim() || `ffmpeg exit ${code}`).replaceAll(plexToken, '[redacted]')}`);
  });
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/diagnostics.js', ['diagnostics.js', 'text/javascript; charset=utf-8']],
  ['/vendor/jsmpeg.min.js', ['vendor/jsmpeg.min.js', 'text/javascript; charset=utf-8']],
  ['/vendor/LICENSE-jsmpeg.txt', ['vendor/LICENSE-jsmpeg.txt', 'text/plain; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/brand/ridepane-light.svg', ['brand/ridepane-light.svg', 'image/svg+xml']],
  ['/brand/ridepane-dark.svg', ['brand/ridepane-dark.svg', 'image/svg+xml']],
  ['/brand/icon.svg', ['brand/icon.svg', 'image/svg+xml']]
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (url.pathname === '/desktop' || url.pathname.startsWith('/desktop/')) {
      if (!authed(req)) return error(res, 401, 'Sign in to Ridepane.');
      if (!desktopBase) return error(res, 404, 'YouTube desktop is not installed.');
      if (url.pathname === '/desktop') { res.writeHead(302, { Location: '/desktop/' }); return res.end(); }
      if (req.method === 'GET' && ['/desktop/icon.png', '/desktop/icon-512.png'].includes(url.pathname)) {
        const file = url.pathname.endsWith('512.png') ? 'icon-512.png' : 'icon-256.png';
        const bytes = await fs.readFile(path.join(root, 'public', 'brand', file));
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
        return res.end(bytes);
      }
      if (req.method === 'GET' && url.pathname === '/desktop/manifest.json') {
        return json(res, 200, { name: 'Ridepane Full YouTube', short_name: 'Ridepane', start_url: '/desktop/', display: 'standalone', icons: [{ src: '/desktop/icon.png', sizes: '256x256', type: 'image/png' }, { src: '/desktop/icon-512.png', sizes: '512x512', type: 'image/png' }] });
      }
      return proxyDesktop(req, res);
    }
    if (req.method === 'GET' && staticFiles.has(url.pathname)) {
      const [file, type] = staticFiles.get(url.pathname);
      const bytes = await fs.readFile(path.join(root, 'public', file));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'", 'X-Content-Type-Options': 'nosniff' });
      return res.end(bytes);
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      if (!sameOrigin(req)) return error(res, 403, 'Invalid origin.');
      const client = req.socket.remoteAddress || 'unknown';
      const attempt = loginAttempts.get(client);
      if (attempt && attempt.until > Date.now() && attempt.count >= 10) return error(res, 429, 'Too many attempts. Try again in five minutes.');
      const input = await body(req);
      const guess = Buffer.from(String(input.password || ''));
      const correct = Buffer.from(password);
      if (guess.length !== correct.length || !crypto.timingSafeEqual(guess, correct)) {
        loginAttempts.set(client, { count: (attempt?.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 300000 });
        return error(res, 401, 'Incorrect password.');
      }
      loginAttempts.delete(client);
      setSessionCookie(req, res);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/pair/start') {
      if (!sameOrigin(req)) return error(res, 403, 'Invalid origin.');
      prunePairs();
      if (pairs.size >= 100) return error(res, 429, 'Too many pending pairings. Try again shortly.');
      let code;
      do { code = crypto.randomBytes(5).toString('hex').slice(0, 8).toUpperCase(); } while (pairs.has(code));
      const claim = crypto.randomBytes(32).toString('base64url');
      pairs.set(code, { claim, expires: Date.now() + 600000, approved: false });
      const scheme = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const base = process.env.PUBLIC_URL || `${scheme}://${req.headers.host}`;
      const pairUrl = new URL(`/?pair=${code}`, base).toString();
      const qrSvg = await QRCode.toString(pairUrl, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, width: 220 });
      return json(res, 200, { code, claim, qrSvg, expiresIn: 600 });
    }
    if (req.method === 'POST' && url.pathname === '/api/pair/status') {
      if (!sameOrigin(req)) return error(res, 403, 'Invalid origin.');
      const input = await body(req);
      const pair = pairs.get(String(input.code || ''));
      if (!pair || pair.expires < Date.now() || input.claim !== pair.claim) return error(res, 404, 'Pairing expired.');
      if (!pair.approved) return json(res, 200, { approved: false });
      pairs.delete(input.code);
      setSessionCookie(req, res);
      return json(res, 200, { approved: true });
    }
    if (!authed(req)) return error(res, 401, 'Sign in to Ridepane.');
    if (req.method === 'POST' && url.pathname === '/api/pair/approve') {
      if (!sameOrigin(req)) return error(res, 403, 'Invalid origin.');
      const input = await body(req);
      const pair = pairs.get(String(input.code || ''));
      if (!pair || pair.expires < Date.now()) return error(res, 404, 'Pairing expired.');
      pair.approved = true;
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/me') return json(res, 200, { ok: true, plex: true, desktop: !!desktopBase });
    if (req.method === 'GET' && url.pathname === '/api/diagnostics/ping') return json(res, 200, { ok: true });
    if (req.method === 'GET' && url.pathname === '/api/diagnostics/transfer') {
      if (activeDiagnosticTransfers >= 2) return error(res, 429, 'Another connection test is running.');
      activeDiagnosticTransfers++;
      let sent = 0;
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': diagnosticBytes,
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff'
      });
      res.on('close', () => { activeDiagnosticTransfers--; });
      const write = () => {
        while (!res.destroyed && sent < diagnosticBytes) {
          const chunk = diagnosticPayload.subarray(sent, sent + 65536);
          sent += chunk.length;
          if (!res.write(chunk)) return;
        }
        if (!res.destroyed) res.end();
      };
      res.on('drain', write);
      write();
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/plex/sections') {
      const data = await plexGet('/library/sections/all');
      return json(res, 200, { items: (data.Directory || []).filter(x => ['movie', 'show', 'other'].includes(x.type)).map(x => ({ id: String(x.key), title: x.title, type: x.type })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/plex/items') {
      const id = numberId(url.searchParams.get('section'));
      const rawPage = url.searchParams.get('page') || '0';
      if (!/^\d+$/.test(rawPage)) return error(res, 400, 'Invalid page.');
      const page = Math.min(100, Number(rawPage));
      const endpoint = `/library/sections/${id}/all?X-Plex-Container-Start=${page * 50}&X-Plex-Container-Size=50`;
      const data = await plexGet(endpoint);
      return json(res, 200, { items: normalize(data.Metadata), page, hasMore: (data.Metadata || []).length === 50 });
    }
    if (req.method === 'GET' && url.pathname === '/api/plex/children') {
      const id = numberId(url.searchParams.get('id'));
      const data = await plexGet(`/library/metadata/${id}/children`);
      return json(res, 200, { items: normalize(data.Metadata) });
    }
    if (req.method === 'POST' && url.pathname === '/api/play') {
      if (!sameOrigin(req)) return error(res, 403, 'Invalid origin.');
      const input = await body(req);
      const session = { id: crypto.randomUUID(), source: input.source, quality: qualityConfig(input.quality), audioMode: audioMode(input.audioMode), stopped: false, started: false };
      if (input.source === 'youtube') session.inputs = await resolveYouTube(youtubeUrl(input.url), session.quality.height);
      else if (input.source === 'plex') {
        const id = numberId(input.id);
        const data = await plexGet(`/library/metadata/${id}`);
        session.part = mediaPart(data.Metadata?.[0]);
      } else return error(res, 400, 'Choose Plex or YouTube.');
      stopSession(active);
      active = session;
      return json(res, 200, { id: session.id, audioMode: session.audioMode });
    }
    const statusMatch = url.pathname.match(/^\/api\/session\/([a-f0-9-]+)\/status$/);
    if (req.method === 'GET' && statusMatch) {
      if (active?.id === statusMatch[1]) return json(res, 200, { active: true });
      if (lastSession?.id === statusMatch[1]) return json(res, 200, { active: false, error: lastSession.error });
      return error(res, 404, 'Session unavailable.');
    }
    if (req.method === 'POST' && url.pathname === '/api/stop') {
      if (!sameOrigin(req)) return error(res, 403, 'Invalid origin.');
      stopSession(active);
      return json(res, 200, { ok: true });
    }
    const audioMatch = url.pathname.match(/^\/api\/session\/([a-f0-9-]+)\/audio$/);
    if (req.method === 'GET' && audioMatch) {
      if (!active || active.id !== audioMatch[1] || active.audio || active.audioMode !== 'separate') return error(res, 404, 'Session unavailable.');
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      active.audio = res;
      const session = active;
      res.on('close', () => stopSession(session));
      startSession(session);
      return;
    }
    error(res, 404, 'Not found.');
  } catch (err) {
    error(res, ['Invalid Plex item.', 'Invalid quality setting.', 'Invalid sound mode.'].includes(err.message) || err.message.startsWith('Enter a ') ? 400 : 500, err.message || 'Server error.');
  }
});

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/desktop/')) {
      if (!desktopBase || !authed(req) || !sameOrigin(req) || req.headers.upgrade?.toLowerCase() !== 'websocket') throw new Error('Unauthorized');
      return proxyDesktopSocket(req, socket, head);
    }
    const id = url.pathname.match(/^\/ws\/([a-f0-9-]+)$/)?.[1];
    const key = req.headers['sec-websocket-key'];
    if (!authed(req) || !active || active.id !== id || active.socket || !key || req.headers.upgrade?.toLowerCase() !== 'websocket') throw new Error('Unauthorized');
    const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    const session = active;
    session.socket = socket;
    socket.on('close', () => stopSession(session));
    socket.on('error', () => stopSession(session));
    startSession(session);
  } catch {
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
  }
});

server.listen(port, '0.0.0.0', () => console.log(`Ridepane listening on ${server.address().port}`));
process.on('SIGTERM', () => { stopSession(active); server.close(); });
