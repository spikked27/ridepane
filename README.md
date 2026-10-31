# Ridepane

Ridepane is a private passenger media page for a Tesla browser. One Docker container runs the Ridepane app and a Chromium session for the real signed-in YouTube website. It also browses your Plex libraries and accepts a YouTube video link. Plex and YouTube link playback convert video to MPEG-1 and draw it on a canvas, with separate 320 kbps stereo MP3 audio.

The driver must not watch or operate the page while driving. Tesla officially supports in-motion passenger video on equipped rear touchscreens; front-screen canvas playback is an unofficial workaround and may stop working after a Tesla update.

## Unraid setup

The [install page](https://spikked27.github.io/ridepane/) has the quick-start steps. The prebuilt image is `ghcr.io/spikked27/ridepane:latest`.

### Docker tab template

Create a private Docker network once with `docker network create ridepane-desktop`. Save [unraid/ridepane.xml](unraid/ridepane.xml) to `/boot/config/plugins/dockerMan/templates-user/ridepane.xml`. Then open **Docker → Add Container → User Templates → Ridepane**. Fill in the app password, Plex LAN URL, Plex token, and optional public URL. The template includes Ridepane's original icon, a persistent browser profile, and 1 GB of shared memory. On an Intel or AMD Unraid server, add `/dev/dri` as a device mapping for GPU video encoding. Only port 8080 is published; the browser service stays inside this container.

### Docker Compose

Download [compose.yaml](compose.yaml) and [.env.example](.env.example) into a folder on Unraid. Copy `.env.example` to `.env`. Set a unique `APP_PASSWORD` of at least 12 characters, your Plex server's local address in `PLEX_URL` (for example `http://192.168.1.100:32400`), and `PLEX_TOKEN`. [Plex explains how to find a token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). Set `PUBLIC_URL` to your external HTTPS address when available. Keep `.env` private. Run `docker compose up -d`.

For a local build from source, run `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.

### Full YouTube (experimental)

This option displays the real YouTube site, including your playlists, Likes, Watch Later and subscriptions, inside a remote Chromium browser. Your Google sign-in stays in Chromium's persistent profile on Unraid. After pairing the car, use the **Open full YouTube on this phone to sign in** link on the phone. Sign in there once; the Tesla then sees the same browser session. Tapping **Full YouTube** in Ridepane opens the remote browser directly in the current tab, using the whole available browser viewport. Selkies has a fullscreen button in its side menu if the client browser allows fullscreen. Tesla's own browser chrome may remain visible. Google sign-in and playback on a moving Tesla front screen must be verified in the car.

With Compose, run `docker compose up -d`. The browser profile is kept in the `ridepane-browser-config` Docker volume. For Intel or AMD GPU encoding, add `devices: ["/dev/dri:/dev/dri"]` to the Ridepane service in `compose.yaml`. Without a GPU, the desktop stream uses more CPU. The internal browser has no published port; Ridepane authenticates and proxies its `/desktop/` path over your existing HTTPS address and WebSocket reverse proxy. The stream defaults to H.264 at 30 fps, adaptive bitrate up to 8 Mbps, and 320 kbps stereo Opus; resolution follows the browser viewport. These are stream settings, not a guarantee of delivered quality over cellular.

If you used the earlier two-container installation, keep the same `/config` path when moving to this image. The Unraid template defaults to `/mnt/cache/appdata/ridepane-browser`; this preserves your Google sign-in. Remove the old `ridepane-browser` container after verifying the new one. The browser's kiosk contains a signed-in Google session, so keep Ridepane's password private.

On your LAN, open `http://<unraid-address>:8080`. Browse Plex and play a title to check the server connection. For use in the car away from home, put Ridepane behind your existing HTTPS reverse proxy or tunnel with WebSocket forwarding. Open that HTTPS address in Tesla's browser. Do not expose port 8080 directly to the internet.

The Ridepane container needs outbound access to Plex's local address and to YouTube. Plex itself does not need a separate public port for Ridepane. The car needs internet through Premium Connectivity, Wi-Fi, or a phone hotspot. A rear touchscreen, if equipped, can use Tesla's supported Theater video instead.

The Compose file and Unraid template cap Ridepane at 6 GiB of RAM, four CPU cores, and 1024 processes or threads. Docker rotates its logs at three 50 MB files. The image health check covers both the app and the internal browser; `unless-stopped` restarts the container if it exits. An unhealthy status alone does not trigger a Docker restart. The persistent Chromium profile under `/config` is separate from these limits and should be included in normal appdata monitoring.

## In-car checks

Open **Car checks** in Ridepane to measure the actual browser-to-Unraid route and inspect Tesla browser features. The connection check transfers 8 MiB of random test data and reports its speed and median round-trip time. The browser check reports audio codec hints and the Web Audio output channel limit. An optional low-volume channel test sends separate tones over 2, 6, or 8 channels so a passenger can listen for actual speaker routing; it cannot identify the speakers automatically. Ridepane's video playback still sends stereo. The cache check stores 64 MiB of generated test bytes in the car browser's IndexedDB; it does not download Plex media. Close and reopen the car browser, then use **Verify saved cache** to see whether those bytes survived. **Clear test cache** removes them. A passed 64 MiB check is only an initial feasibility result, not proof that the browser can retain a whole movie. See [TESTING.md](TESTING.md) for the short car test sequence and what results to record.

## Phone pairing

The car's sign-in screen shows a QR code. Scan it with your phone, enter the app password on your phone, and tap **Approve this screen**. The car signs in automatically. Its cookie lasts six months and survives container restarts as long as the app password stays the same. If your phone is already signed in, later pairings need only one approval tap. A direct password field remains available on the car as a fallback. Pairing codes expire after ten minutes.

## Controls and limits

- Open **Plex library** to browse sections, shows, seasons, movies, and episodes. Playback reads the selected Plex media part with your configured token. Ridepane does not store the token in the car's browser.
- Open **YouTube link** and paste a single video URL. This experimental path uses `yt-dlp` inside the container and selects separate high-quality video and audio streams when available. YouTube changes can break extraction, and restricted or paid videos often fail. YouTube's API policies do not permit replacing the standard player in API clients; this is not an official YouTube integration.
- Open **Full YouTube** to browse the normal signed-in YouTube website in the full available browser viewport on the car screen. This uses a remote browser and Selkies' canvas streaming, so it does not use Ridepane's `yt-dlp` converter. Selkies tries H.264 via WebCodecs and can fall back to JPEG; audio uses Opus and Web Audio. Tesla browser support, frame rate, latency, and audio need an in-car check. A remote browser can consume more Unraid resources and mobile data than YouTube's native player.
- If **Full YouTube** shows a black picture on a browser, go back to Ridepane and tap **YouTube fallback**. That stores Selkies' `jpeg` encoder choice in that browser and opens the same remote session. JPEG works without WebCodecs but may use more data or have lower motion quality. The regular **Full YouTube** entry clears that per-browser choice and starts with the H.264 default. The fallback does not affect other browsers or the Plex player.
- **Start audio** may need a tap because browsers can block autoplay. Audio and picture use separate channels, so some sync drift is possible.
- **Audio output** is currently stereo, including when Plex provides a 5.1 or 7.1 source. The app's **Check browser channels** button reports the browser's maximum output channel count. A Tesla's speaker count does not guarantee that its browser exposes discrete surround channels; that must be checked in the car before a surround stream can be offered. Re-encoding lower-bitrate source audio at 320 kbps does not restore lost detail.
- **Picture quality** has Balanced (540p/30 fps at about 2.5 Mbps), High (720p/30 fps at about 5 Mbps, the default), and Maximum (1080p/30 fps at about 10 Mbps). These are encoding targets, not guaranteed delivered rates. Maximum needs a capable Unraid CPU and Tesla browser, and cannot add detail to a lower-resolution source. Start with High and compare on your car. MPEG-1 still uses more bandwidth than modern codecs at the same visual quality, so the original stream is not preserved bit for bit.
- One playback session runs at a time. Starting another title closes the previous one. Subtitles, playback position, and Plex watch status are not yet synchronized.

## Development

Requires Node.js 22 or newer. Run `npm test` for the app logic and local Plex API flow. To run the server outside Docker, install FFmpeg and `yt-dlp`, then set the environment variables from `.env.example` and run `npm start`.

The SVG artwork in `public/brand/` is the editable original source. The dark logo is used on the app, phone pairing, GitHub Pages, and sign-in screen; the light logo is provided for light surfaces. `icon.svg` is the browser icon, and PNG variants are provided for Unraid and other platform surfaces.

JSMpeg is bundled at `public/vendor/jsmpeg.min.js` from [phoboslab/jsmpeg](https://github.com/phoboslab/jsmpeg), commit `924acfbd96fdf15e6748d1368a36d79d8f4cecf6`. Its MIT license is included alongside the decoder.
