import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

test('HTTP flow authenticates, browses Plex, and creates bounded playback sessions', async () => {
  const plex = http.createServer((req, res) => {
    assert.equal(req.headers['x-plex-token'], 'test-token');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/library/sections/all') res.end(JSON.stringify({ MediaContainer: { Directory: [{ key: '1', title: 'Movies', type: 'movie' }] } }));
    else if (req.url.startsWith('/library/sections/1/all')) res.end(JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: '9', title: 'Test Movie', type: 'movie' }] } }));
    else if (req.url === '/library/metadata/9') res.end(JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: '9', type: 'movie', Media: [{ Part: [{ key: '/library/parts/3/1/test.mp4' }] }] }] } }));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => plex.listen(0, '127.0.0.1', resolve));
  const desktop = http.createServer((req, res) => {
    assert.equal(req.url, '/desktop/');
    assert.equal(req.headers.cookie || '', '');
    assert.equal(req.headers['accept-encoding'], 'identity');
    res.setHeader('Content-Type', 'text/html');
    res.end('<html><head><script type="module" src="./app.js"></script></head><body>Remote browser</body></html>');
  });
  desktop.on('upgrade', (req, socket) => {
    assert.equal(req.url, '/desktop/');
    assert.equal(req.headers.cookie || '', '');
    socket.end('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello');
  });
  await new Promise(resolve => desktop.listen(0, '127.0.0.1', resolve));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: import.meta.dirname,
    env: { ...process.env, PORT: '0', APP_PASSWORD: 'testing-password', PLEX_URL: `http://127.0.0.1:${plex.address().port}`, PLEX_TOKEN: 'test-token', DESKTOP_URL: `http://127.0.0.1:${desktop.address().port}` },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  let port;
  try {
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server did not start: ' + output)), 5000);
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        const match = output.match(/Ridepane listening on (\d+)/);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
      child.stderr.on('data', chunk => { output += chunk.toString(); });
      child.on('exit', code => { clearTimeout(timer); reject(new Error('Server exited: ' + code + ' ' + output)); });
    });
    const base = `http://127.0.0.1:${port}`;
    let response = await fetch(base + '/api/plex/sections');
    assert.equal(response.status, 401);
    response = await fetch(base + '/api/diagnostics/transfer');
    assert.equal(response.status, 401);
    response = await fetch(base + '/brand/icon.svg');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Ridepane icon/);
    response = await fetch(base + '/');
    assert.equal(response.status, 200);
    const home = await response.text();
    assert.match(home, /id="audio-delay"/);
    assert.match(home, /id="full-plex"/);
    assert.match(home, /brand\/ridepane-dark\.svg/);
    response = await fetch(base + '/desktop/');
    assert.equal(response.status, 401);
    response = await fetch(base + '/api/desktop/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site: 'plex' }) });
    assert.equal(response.status, 401);
    response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testing-password' }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie };
    response = await fetch(base + '/desktop/', { headers });
    assert.equal(response.status, 200);
    const desktopPage = await response.text();
    assert.match(desktopPage, /<script data-ridepane-touch="0\.7\.6">/);
    assert.match(desktopPage, /mouseGesture/);
    assert.match(desktopPage, /<\/script><script type="module"/);
    assert.match(desktopPage, /Remote browser/);
    response = await fetch(base + '/desktop/ridepane-touch.js');
    assert.equal(response.status, 401);
    response = await fetch(base + '/desktop/ridepane-touch.js', { headers });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /touchmove/);
    response = await fetch(base + '/api/me', { headers });
    assert.equal((await response.json()).desktop, true);
    response = await fetch(base + '/api/desktop/open', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ site: 'unapproved' }) });
    assert.equal(response.status, 400);
    response = await fetch(base + '/diagnostics.js');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /ridepane-car-check-v1/);
    response = await fetch(base + '/api/diagnostics/ping', { headers });
    assert.deepEqual(await response.json(), { ok: true });
    response = await fetch(base + '/api/diagnostics/transfer', { headers });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal((await response.arrayBuffer()).byteLength, 8 * 1024 * 1024);
    const desktopUpgrade = await new Promise((resolve, reject) => {
      const request = http.request(base + '/desktop/', { headers: { ...headers, Connection: 'Upgrade', Upgrade: 'websocket', Origin: base, 'Sec-WebSocket-Key': 'dGVzdA==', 'Sec-WebSocket-Version': '13' } });
      request.on('upgrade', (upgraded, socket, head) => {
        if (head.length) { socket.destroy(); resolve({ status: upgraded.statusCode, head: head.toString() }); }
        else socket.once('data', chunk => { socket.destroy(); resolve({ status: upgraded.statusCode, head: chunk.toString() }); });
      });
      request.on('error', reject);
      request.end();
    });
    assert.equal(desktopUpgrade.status, 101);
    assert.equal(desktopUpgrade.head, 'hello');
    response = await fetch(base + '/api/plex/sections', { headers });
    assert.deepEqual((await response.json()).items.map(x => x.title), ['Movies']);
    response = await fetch(base + '/api/plex/items?section=1', { headers });
    assert.deepEqual((await response.json()).items.map(x => x.title), ['Test Movie']);
    response = await fetch(base + '/api/play', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'plex', id: '9' }) });
    assert.equal(response.status, 200);
    assert.match((await response.json()).id, /^[a-f0-9-]+$/);
    response = await fetch(base + '/api/play', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'plex', id: '9', audioMode: 'combined' }) });
    assert.equal(response.status, 200);
    const combined = await response.json();
    assert.equal(combined.audioMode, 'combined');
    response = await fetch(base + `/api/session/${combined.id}/audio`, { headers });
    assert.equal(response.status, 404);
    response = await fetch(base + '/api/play', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'plex', id: '9', audioMode: 'unsupported' }) });
    assert.equal(response.status, 400);
    response = await fetch(base + '/api/play', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'youtube', url: 'https://evil.example/watch?v=abcdefghijk' }) });
    assert.equal(response.status, 400);
    response = await fetch(base + '/api/pair/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 200);
    const pair = await response.json();
    assert.match(pair.qrSvg, /<svg/);
    const pairBody = JSON.stringify({ code: pair.code, claim: pair.claim });
    response = await fetch(base + '/api/pair/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pairBody });
    assert.equal((await response.json()).approved, false);
    response = await fetch(base + '/api/pair/approve', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pair.code }) });
    assert.equal(response.status, 200);
    response = await fetch(base + '/api/pair/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: pair.code, claim: 'wrong' }) });
    assert.equal(response.status, 404);
    response = await fetch(base + '/api/pair/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: pairBody });
    assert.equal((await response.json()).approved, true);
    const carCookie = response.headers.get('set-cookie').split(';')[0];
    assert.notEqual(carCookie, cookie);
    response = await fetch(base + '/api/me', { headers: { Cookie: carCookie } });
    assert.equal(response.status, 200);
  } finally {
    child.kill();
    plex.close();
    desktop.close();
  }
});
