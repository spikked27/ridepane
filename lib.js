export function youtubeUrl(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Enter a YouTube video URL.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Enter a YouTube video URL.');
  const host = url.hostname.toLowerCase();
  let id;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(shorts|live)\/[^/]+/.test(url.pathname)) id = url.pathname.split('/')[2];
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) throw new Error('Enter a valid YouTube video URL.');
  return `https://www.youtube.com/watch?v=${id}`;
}

export function numberId(input) {
  if (!/^\d+$/.test(String(input))) throw new Error('Invalid Plex item.');
  return String(input);
}

export function plexItem(item) {
  return {
    id: String(item.ratingKey), title: item.title || 'Untitled', type: item.type,
    subtitle: [item.grandparentTitle, item.parentTitle].filter(Boolean).join(' · '),
    year: item.year || null, duration: item.duration || null,
    playable: ['movie', 'episode', 'video'].includes(item.type)
  };
}

export function mediaPart(item) {
  const part = item.Media?.[0]?.Part?.[0];
  if (!part?.key || !/^\/library\/parts\/\d+\//.test(part.key)) throw new Error('Plex item has no playable media part.');
  return part.key;
}

export const QUALITY = Object.freeze({
  balanced: Object.freeze({ width: 960, height: 540, fps: 30, videoRate: '2500k', maxRate: '3500k', buffer: '5000k' }),
  high: Object.freeze({ width: 1280, height: 720, fps: 30, videoRate: '5000k', maxRate: '6500k', buffer: '10000k' }),
  maximum: Object.freeze({ width: 1920, height: 1080, fps: 30, videoRate: '10000k', maxRate: '13000k', buffer: '20000k' })
});

export function qualityConfig(name) {
  if (!name) return QUALITY.high;
  if (!Object.hasOwn(QUALITY, name)) throw new Error('Invalid quality setting.');
  return QUALITY[name];
}

export function audioMode(name) {
  if (name === undefined || name === 'separate') return 'separate';
  if (name === 'combined') return 'combined';
  throw new Error('Invalid sound mode.');
}

export function youtubeInputs(info) {
  const formats = info.requested_formats || [info];
  const video = formats.find(x => x.vcodec && x.vcodec !== 'none');
  const audio = formats.find(x => x.acodec && x.acodec !== 'none') || video;
  if (!video?.url || !audio?.url) throw new Error('YouTube did not provide playable streams.');
  for (const part of [video, audio]) {
    const url = new URL(part.url);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('YouTube returned an unsupported stream URL.');
  }
  return { video, audio: audio === video ? null : audio };
}
