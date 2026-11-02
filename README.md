# Ridepane

Ridepane is a private passenger media page for a Tesla browser. One Docker container runs the Ridepane app and a remote Chromium browser for the real Plex and YouTube websites. **Full Plex** opens the familiar Plex Web interface, including Home, Continue Watching, search, collections, and its player. The original Plex quick-play library and YouTube link player remain available as fallback options. Quick play converts video to MPEG-1 on a canvas, with 320 kbps stereo MP3 by default and an optional 384 kbps stereo MP2 sync test.

The driver must not watch or operate the page while driving. Tesla officially supports in-motion passenger video on equipped rear touchscreens; front-screen canvas playback is an unofficial workaround and may stop working after a Tesla update.

## Unraid setup

The [install page](https://spikked27.github.io/ridepane/) has the quick-start steps. The prebuilt image is `ghcr.io/spikked27/ridepane:latest`.

### Docker tab template

Create a private Docker network once with `docker network create ridepane-desktop`. Save [unraid/ridepane.xml](unraid/ridepane.xml) to `/boot/config/plugins/dockerMan/templates-user/ridepane.xml`. Then open **Docker → Add Container → User Templates → Ridepane**. Fill in the app password, Plex LAN URL, Plex token, and optional public URL. The template includes Ridepane's original icon, a persistent browser profile, and 1 GB of shared memory. On an Intel or AMD Unraid server, add `/dev/dri` as a device mapping for GPU video encoding. Only port 8080 is published; the browser service stays inside this container.

### Docker Compose

Download [compose.yaml](compose.yaml) and [.env.example](.env.example) into a folder on Unraid. Copy `.env.example` to `.env`. Set a unique `APP_PASSWORD` of at least 12 characters, your Plex server's local address in `PLEX_URL` (for example `http://192.168.1.100:32400`), and `PLEX_TOKEN`. [Plex explains how to find a token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/). Set `PUBLIC_URL` to your external HTTPS address when available. Keep `.env` private. Run `docker compose up -d`.

For a local build from source, run `docker compose -f compose.yaml -f compose.build.yaml up -d --build`.

### Full Plex and YouTube (experimental)

The Ridepane home page has **Open Full Plex** and **Open Full YouTube**. Both display the actual signed-in websites inside a remote Chromium browser on Unraid. Full Plex opens Plex's hosted web app at `https://app.plex.tv/desktop/`, which [Plex recommends](https://support.plex.tv/articles/200288666-opening-plex-web-app/) for the latest interface. The remote browser sits on your LAN and can reach your Plex server directly. Full YouTube shows your subscriptions, playlists, Likes, Watch Later, and recommendations. The two buttons navigate the same remote browser; each site's sign-in persists in its profile.

After pairing the car, use **Open Full Plex on this phone to sign in** or **Open Full YouTube on this phone to sign in** on your phone. Sign in there once; the car then sees the same browser profile without typing account credentials on its screen. The phone and car share one live browser session, so do initial sign-in while parked. The full app uses the available Tesla browser viewport; Selkies offers a fullscreen control where the client browser permits it. Tesla's browser chrome may remain visible.

With Compose, run `docker compose up -d`. The browser profile is kept in the `ridepane-browser-config` Docker volume. For Intel or AMD GPU encoding, add `devices: ["/dev/dri:/dev/dri"]` to the Ridepane service in `compose.yaml`. Without a GPU, the desktop stream uses more CPU. The internal browser and its local control port are not published; Ridepane authenticates and proxies `/desktop/` over your existing HTTPS address and WebSocket reverse proxy. The stream defaults to H.264 at 30 fps, adaptive bitrate up to 8 Mbps, and 320 kbps stereo Opus; resolution follows the browser viewport. These are stream settings, not a guarantee of delivered quality over cellular.

If you used the earlier two-container installation, keep the same `/config` path when moving to this image. The Unraid template defaults to `/mnt/cache/appdata/ridepane-browser`; this preserves website sign-ins. Remove the old `ridepane-browser` container after verifying the new one. The remote browser can contain signed-in Plex and Google sessions, so keep Ridepane's password private.

On your LAN, open `http://<unraid-address>:8080`. Browse Plex and play a title to check the server connection. For use in the car away from home, put Ridepane behind your existing HTTPS reverse proxy or tunnel with WebSocket forwarding. Open that HTTPS address in Tesla's browser. Do not expose port 8080 directly to the internet.

The Ridepane container needs outbound access to Plex's local address and to YouTube. Plex itself does not need a separate public port for Ridepane. The car needs internet through Premium Connectivity, Wi-Fi, or a phone hotspot. A rear touchscreen, if equipped, can use Tesla's supported Theater video instead.

The Compose file and Unraid template cap Ridepane at 6 GiB of RAM, four CPU cores, and 1024 processes or threads. Docker rotates its logs at three 50 MB files. The image health check covers both the app and the internal browser; `unless-stopped` restarts the container if it exits. An unhealthy status alone does not trigger a Docker restart. The persistent Chromium profile under `/config` is separate from these limits and should be included in normal appdata monitoring.

## In-car checks

Open **Car checks** in Ridepane to measure the actual browser-to-Unraid route and inspect Tesla browser features. The connection check transfers 8 MiB of random test data and reports its speed and median round-trip time. The browser check reports audio codec hints and the Web Audio output channel limit. An optional low-volume channel test sends separate tones over 2, 6, or 8 channels so a passenger can listen for actual speaker routing; it cannot identify the speakers automatically. Ridepane's video playback still sends stereo. The cache check stores 64 MiB of generated test bytes in the car browser's IndexedDB; it does not download Plex media. Close and reopen the car browser, then use **Verify saved cache** to see whether those bytes survived. **Clear test cache** removes them. A passed 64 MiB check is only an initial feasibility result, not proof that the browser can retain a whole movie. See [TESTING.md](TESTING.md) for the short car test sequence and what results to record.

## Phone pairing

The car's sign-in screen shows a QR code. Scan it with your phone, enter the app password on your phone, and tap **Approve this screen**. The car signs in automatically. Its cookie lasts six months and survives container restarts as long as the app password stays the same. If your phone is already signed in, later pairings need only one approval tap. A direct password field remains available on the car as a fallback. Pairing codes expire after ten minutes.

## Controls and limits

- Open **Full Plex** on the home page for the familiar Plex Web interface. It runs in remote Chromium, and Ridepane sends the resulting screen and sound to the car. The car does not receive the Plex token used by quick play. Use **Compatibility view** if the normal stream appears black on the Tesla.
- Open **Plex quick play** to browse sections, shows, seasons, movies, and episodes in Ridepane's simpler interface. Playback reads the selected Plex media part with your configured token. The library Back button returns to the library list. Quick play remains useful if the remote browser stream is unavailable.
- Open **YouTube link** and paste a single video URL. This experimental path uses `yt-dlp` inside the container and selects separate high-quality video and audio streams when available. YouTube changes can break extraction, and restricted or paid videos often fail. YouTube's API policies do not permit replacing the standard player in API clients; this is not an official YouTube integration.
- Open **Full YouTube** for the normal signed-in YouTube website. Selkies streams both full websites as a canvas; it tries H.264 via WebCodecs and can fall back to JPEG, with Opus audio over Web Audio. Tesla browser support, frame rate, latency, and audio need an in-car check. A remote browser can consume more Unraid resources and mobile data than the quick player.
- If either full app shows a black picture, return to Ridepane and tap its **Compatibility view**. That chooses JPEG frames for that Tesla browser. JPEG works without WebCodecs but may use more data or have lower motion quality. The normal entry restores H.264 in that browser. This setting does not affect other browsers or quick-play video.
- **Sound mode** defaults to the separate 320 kbps MP3 path. If voices lag the picture, select **384 kbps MP2 · sync test** before starting a title. This interleaves audio and picture in the same MPEG-TS stream; tap **Start sound** if the browser blocks Web Audio autoplay. JSMpeg's streaming decoder does not use media timestamps, so this may reduce sync errors but cannot guarantee precise lip sync, especially over an uneven cellular connection. Switch back to the default path if the test is worse. The choice applies to Plex and **YouTube link** playback; Full YouTube uses its own remote browser audio path.
- **Delay sound** appears during Plex and YouTube link playback. If voices are heard before lips move, move the slider right in 50 ms steps, up to 1.5 seconds. It adds output delay in the car browser without changing the source file or video quality. A fixed delay can correct a steady offset; if the gap keeps growing, note that separately because the player needs a different fix. The slider resets to zero for each new title.
- **Audio output** is currently stereo, including when Plex provides a 5.1 or 7.1 source. The app's **Check browser channels** button reports the browser's maximum output channel count. A Tesla's speaker count does not guarantee that its browser exposes discrete surround channels; that must be checked in the car before a surround stream can be offered. Re-encoding lower-bitrate source audio at 320 kbps does not restore lost detail.
- **Picture quality** has Balanced (540p/30 fps at about 2.5 Mbps), High (720p/30 fps at about 5 Mbps, the default), and Maximum (1080p/30 fps at about 10 Mbps). These are encoding targets, not guaranteed delivered rates. Maximum needs a capable Unraid CPU and Tesla browser, and cannot add detail to a lower-resolution source. Start with High and compare on your car. MPEG-1 still uses more bandwidth than modern codecs at the same visual quality, so the original stream is not preserved bit for bit.
- The two full apps share one remote browser, so opening one replaces the other on its screen. Quick play supports one video session at a time; its subtitles, playback position, and Plex watch status are not yet synchronized. Full Plex uses Plex's own player and account features. Any download started inside remote Chromium stays on Unraid; it does not create an offline copy in the Tesla browser.

## Development

Requires Node.js 22 or newer. Run `npm test` for the app logic and local Plex API flow. To run the server outside Docker, install FFmpeg and `yt-dlp`, then set the environment variables from `.env.example` and run `npm start`.

The SVG artwork in `public/brand/` is the editable original source. The dark logo is used on the app, phone pairing, GitHub Pages, and sign-in screen; the light logo is provided for light surfaces. `icon.svg` is the browser icon, and PNG variants are provided for Unraid and other platform surfaces.

JSMpeg is bundled at `public/vendor/jsmpeg.min.js` from [phoboslab/jsmpeg](https://github.com/phoboslab/jsmpeg), commit `924acfbd96fdf15e6748d1368a36d79d8f4cecf6`. Its MIT license is included alongside the decoder.
