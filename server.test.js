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
  const child = spawn(process.execPath, ['server.js'], {
    cwd: import.meta.dirname,
    env: { ...process.env, PORT: '0', APP_PASSWORD: 'testing-password', PLEX_URL: `http://127.0.0.1:${plex.address().port}`, PLEX_TOKEN: 'test-token' },
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
    response = await fetch(base + '/brand/icon.svg');
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Ridepane icon/);
    response = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'testing-password' }) });
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const headers = { Cookie: cookie };
    response = await fetch(base + '/api/plex/sections', { headers });
    assert.deepEqual((await response.json()).items.map(x => x.title), ['Movies']);
    response = await fetch(base + '/api/plex/items?section=1', { headers });
    assert.deepEqual((await response.json()).items.map(x => x.title), ['Test Movie']);
    response = await fetch(base + '/api/play', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'plex', id: '9' }) });
    assert.equal(response.status, 200);
    assert.match((await response.json()).id, /^[a-f0-9-]+$/);
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
  }
});
