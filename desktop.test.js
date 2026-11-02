import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { desktopSiteUrl, openDesktopSite } from './desktop.js';

test('full apps navigate only to approved sites in the existing browser page', async () => {
  assert.equal(desktopSiteUrl('plex'), 'https://app.plex.tv/desktop/');
  assert.equal(desktopSiteUrl('youtube'), 'https://www.youtube.com/');
  assert.throws(() => desktopSiteUrl('https://example.com'), /Invalid full app/);

  const commands = [];
  const cdp = http.createServer((req, res) => {
    if (req.url !== '/json/list') { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify([{ id: 'page-1', type: 'page', url: 'https://www.youtube.com/', webSocketDebuggerUrl: `ws://127.0.0.1:${cdp.address().port}/devtools/page/page-1` }]));
  });
  cdp.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 6) {
        const opcode = pending[0] & 15;
        let length = pending[1] & 127;
        let offset = 2;
        if (length === 126) { if (pending.length < 8) return; length = pending.readUInt16BE(2); offset = 4; }
        if (pending.length < offset + 4 + length) return;
        const mask = pending.subarray(offset, offset + 4);
        const payload = pending.subarray(offset + 4, offset + 4 + length);
        const decoded = Buffer.from(payload);
        for (let i = 0; i < decoded.length; i++) decoded[i] ^= mask[i % 4];
        pending = pending.subarray(offset + 4 + length);
        if (opcode === 8) { socket.end(); return; }
        if (opcode !== 1) continue;
        const command = JSON.parse(decoded.toString());
        commands.push(command);
        const reply = Buffer.from(JSON.stringify({ id: command.id, result: {} }));
        socket.write(Buffer.concat([Buffer.from([0x81, reply.length]), reply]));
      }
    });
  });
  await new Promise(resolve => cdp.listen(0, '127.0.0.1', resolve));
  try {
    await openDesktopSite('plex', `http://127.0.0.1:${cdp.address().port}`);
    assert.deepEqual(commands.map(command => command.method), ['Page.navigate', 'Page.bringToFront']);
    assert.equal(commands[0].params.url, 'https://app.plex.tv/desktop/');
  } finally {
    cdp.closeAllConnections();
    await new Promise(resolve => cdp.close(resolve));
  }
});
