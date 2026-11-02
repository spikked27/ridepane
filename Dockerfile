FROM node:22-bookworm-slim AS app-build

WORKDIR /opt/ridepane
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js lib.js desktop.js ./
COPY public ./public

FROM lscr.io/linuxserver/chromium:latest

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir 'yt-dlp[default]' \
    && rm -rf /var/lib/apt/lists/*

COPY --from=app-build /usr/local/bin/node /usr/local/bin/node
COPY --from=app-build /opt/ridepane /opt/ridepane
COPY docker/10-ridepane-profile /custom-cont-init.d/10-ridepane-profile
COPY docker/ridepane-service /custom-services.d/ridepane
RUN chmod 755 /custom-cont-init.d/10-ridepane-profile /custom-services.d/ridepane

ENV NODE_ENV=production \
    PORT=8080 \
    PULSE_RUNTIME_PATH=/tmp/ridepane-pulse \
    YTDLP_BIN=/opt/yt-dlp/bin/yt-dlp \
    DESKTOP_URL=http://127.0.0.1:3000 \
    SUBFOLDER=/desktop/ \
    HARDEN_DESKTOP=true \
    HARDEN_OPENBOX=true \
    SELKIES_ENABLE_SHARING=false \
    SELKIES_FILE_TRANSFERS=none \
    SELKIES_FRAMERATE=30 \
    SELKIES_RATE_CONTROL_MODE=cbr,crf \
    SELKIES_VIDEO_BITRATE=8000 \
    SELKIES_VIDEO_STREAMING_MODE=true \
    SELKIES_AUDIO_BITRATE=320000 \
    TITLE="Ridepane Full Apps" \
    CHROME_CLI="--kiosk --remote-debugging-port=9222 --user-data-dir=/config/ridepane-chromium https://www.youtube.com"

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 CMD node -e "Promise.all([fetch('http://127.0.0.1:8080/healthz'), fetch('http://127.0.0.1:3000/desktop/'), fetch('http://127.0.0.1:9222/json/list')]).then(async responses => process.exit(responses.every(response => response.ok) && (await responses[2].json()).some(target => target.type === 'page') && require('node:child_process').spawnSync('s6-setuidgid', ['abc', 'pactl', 'info'], { timeout: 2000 }).status === 0 ? 0 : 1)).catch(() => process.exit(1))"
