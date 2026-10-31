import test from 'node:test';
import assert from 'node:assert/strict';
import { youtubeUrl, numberId, mediaPart, qualityConfig, audioMode, youtubeInputs } from './lib.js';

test('YouTube URLs are normalized to a single video and other hosts are rejected', () => {
  assert.equal(youtubeUrl('https://youtu.be/abcdefghijk?t=30'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(youtubeUrl('https://www.youtube.com/shorts/abcdefghijk'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.throws(() => youtubeUrl('https://youtube.com.evil.example/watch?v=abcdefghijk'));
  assert.throws(() => youtubeUrl('file:///etc/passwd'));
});

test('Plex identifiers and media paths are bounded', () => {
  assert.equal(numberId('123'), '123');
  assert.throws(() => numberId('../etc/passwd'));
  assert.equal(mediaPart({Media: [{Part: [{key: '/library/parts/4/123/file.mp4'}]}]}), '/library/parts/4/123/file.mp4');
  assert.throws(() => mediaPart({Media: [{Part: [{key: 'http://evil.example'}]}]}));
});

test('quality presets are bounded and default to 720p', () => {
  assert.equal(qualityConfig().height, 720);
  assert.equal(qualityConfig('maximum').height, 1080);
  assert.throws(() => qualityConfig('unlimited'));
  assert.equal(audioMode(), 'separate');
  assert.equal(audioMode('combined'), 'combined');
  assert.throws(() => audioMode('invalid'));
});

test('YouTube combined and split streams are selected', () => {
  assert.equal(youtubeInputs({ url: 'https://example.com/video', vcodec: 'avc1', acodec: 'aac' }).audio, null);
  const split = youtubeInputs({ requested_formats: [
    { url: 'https://example.com/video', vcodec: 'avc1', acodec: 'none' },
    { url: 'https://example.com/audio', vcodec: 'none', acodec: 'opus' }
  ] });
  assert.equal(split.audio.url, 'https://example.com/audio');
  assert.throws(() => youtubeInputs({ url: 'file:///secret', vcodec: 'avc1', acodec: 'aac' }));
});
