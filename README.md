# Ridepane

Ridepane is a private passenger media page for a Tesla browser. It runs on your Unraid server, browses your Plex movie and TV libraries, and accepts a YouTube video link. The server converts video to MPEG-1 transport stream, sends it over a WebSocket, and the bundled JSMpeg decoder draws it on a canvas. Audio is sent separately as 192 kbps MP3. This avoids relying on Tesla's ordinary in-motion `<video>` playback.

The driver must not watch or operate the page while driving. Tesla officially supports in-motion passenger video on equipped rear touchscreens; front-screen canvas playback is an unofficial workaround and may stop working after a Tesla update.

## Unraid setup

The [install page](https://spikked27.github.io/ridepane/) has the quick-start steps. The prebuilt image is `ghcr.io/spikked27/ridepane:latest`.

### Docker tab template

On Unraid, save [unraid/ridepane.xml](unraid/ridepane.xml) to `/boot/config/plugins/dockerMan/templates-user/ridepane.xml`. Then open **Docker → Add Container → User Templates → Ridepane**. Fill in the app password, Plex LAN URL, Plex token, and optional public URL. The template includes Ridepane's original icon and opens the container web UI.

### Docker Compose

Download [compose.yaml](compose.yaml) and [.env.example](.env.example) into a folder on Unraid. Copy `.env.example` to `.env`. Set a unique `APP_PASSWORD` of at least 12 characters, your Plex server's local address in `PLEX_URL` (for example `http://192.168.1.100:32400`), and `PLEX_TOKEN`. [Plex explains how to find a token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). Set `PUBLIC_URL` to your external HTTPS address when available. Keep `.env` private. Run `docker compose up -d`.

For a local build from source, run `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.

On your LAN, open `http://<unraid-address>:8080`. Browse Plex and play a title to check the server connection. For use in the car away from home, put Ridepane behind your existing HTTPS reverse proxy or tunnel with WebSocket forwarding. Open that HTTPS address in Tesla's browser. Do not expose port 8080 directly to the internet.

The Ridepane container needs outbound access to Plex's local address and to YouTube. Plex itself does not need a separate public port for Ridepane. The car needs internet through Premium Connectivity, Wi-Fi, or a phone hotspot. A rear touchscreen, if equipped, can use Tesla's supported Theater video instead.

## Phone pairing

The car's sign-in screen shows a QR code. Scan it with your phone, enter the app password on your phone, and tap **Approve this screen**. The car signs in automatically. Its cookie lasts six months and survives container restarts as long as the app password stays the same. If your phone is already signed in, later pairings need only one approval tap. A direct password field remains available on the car as a fallback. Pairing codes expire after ten minutes.

## Controls and limits

- Open **Plex library** to browse sections, shows, seasons, movies, and episodes. Playback reads the selected Plex media part with your configured token. Ridepane does not store the token in the car's browser.
- Open **YouTube link** and paste a single video URL. This experimental path uses `yt-dlp` inside the container and selects separate high-quality video and audio streams when available. YouTube changes can break extraction, and restricted or paid videos often fail. YouTube's API policies do not permit replacing the standard player in API clients; this is not an official YouTube integration.
- **Start audio** may need a tap because browsers can block autoplay. Audio and picture use separate channels, so some sync drift is possible.
- **Picture quality** has Balanced (540p/30 fps at about 2.5 Mbps), High (720p/30 fps at about 5 Mbps, the default), and Maximum (1080p/30 fps at about 10 Mbps). These are encoding targets, not guaranteed delivered rates. Maximum needs a capable Unraid CPU and Tesla browser, and cannot add detail to a lower-resolution source. Start with High and compare on your car. MPEG-1 still uses more bandwidth than modern codecs at the same visual quality, so the original stream is not preserved bit for bit.
- One playback session runs at a time. Starting another title closes the previous one. Subtitles, playback position, and Plex watch status are not yet synchronized.

## Development

Requires Node.js 22 or newer. Run `npm test` for the app logic and local Plex API flow. To run the server outside Docker, install FFmpeg and `yt-dlp`, then set the environment variables from `.env.example` and run `npm start`.

The SVG artwork in `public/brand/` is the editable original source. The dark logo is used on the app, phone pairing, GitHub Pages, and sign-in screen; the light logo is provided for light surfaces. `icon.svg` is the browser icon, and PNG variants are provided for Unraid and other platform surfaces.

JSMpeg is bundled at `public/vendor/jsmpeg.min.js` from [phoboslab/jsmpeg](https://github.com/phoboslab/jsmpeg), commit `924acfbd96fdf15e6748d1368a36d79d8f4cecf6`. Its MIT license is included alongside the decoder.
