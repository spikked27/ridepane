const sites = Object.freeze({
  plex: 'https://app.plex.tv/desktop/',
  youtube: 'https://www.youtube.com/'
});

let selectedTargetId;

export function desktopSiteUrl(site) {
  if (!Object.hasOwn(sites, site)) throw new Error('Invalid full app.');
  return sites[site];
}

function sendPageCommands(socketUrl, url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl);
    let settled = false;
    const timer = setTimeout(() => finish(new Error('The full browser did not respond.')), 7000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error); else resolve();
    }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Page.navigate', params: { url } }));
    });
    socket.addEventListener('message', event => {
      let response;
      try { response = JSON.parse(event.data); } catch { return; }
      if (response.id === 1) {
        if (response.error || response.result?.errorText) return finish(new Error('The full browser could not open this app.'));
        socket.send(JSON.stringify({ id: 2, method: 'Page.bringToFront' }));
      } else if (response.id === 2) {
        finish(response.error ? new Error('The full browser could not show this app.') : null);
      }
    });
    socket.addEventListener('error', () => finish(new Error('The full browser is unavailable.')));
    socket.addEventListener('close', () => finish(new Error('The full browser connection closed.')));
  });
}

export async function openDesktopSite(site, debugAddress = 'http://127.0.0.1:9222') {
  const url = desktopSiteUrl(site);
  const debugBase = new URL(debugAddress);
  if (debugBase.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(debugBase.hostname)) throw new Error('Invalid browser control address.');
  const response = await fetch(new URL('/json/list', debugBase), { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('The full browser is unavailable.');
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new Error('The full browser returned an invalid response.');
  const pages = targets.filter(target => target.type === 'page' && target.webSocketDebuggerUrl);
  const target = pages.find(page => page.id === selectedTargetId)
    || pages.find(page => /^https:\/\/(app\.plex\.tv|www\.youtube\.com)\//.test(page.url || ''))
    || pages[0];
  if (!target) throw new Error('The full browser has no open page.');
  const socketUrl = new URL(target.webSocketDebuggerUrl);
  if (socketUrl.protocol !== 'ws:') throw new Error('The full browser returned an invalid connection.');
  socketUrl.hostname = debugBase.hostname;
  socketUrl.port = debugBase.port;
  await sendPageCommands(socketUrl, url);
  selectedTargetId = target.id;
  return url;
}
