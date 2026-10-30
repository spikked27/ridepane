FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates \
    && python3 -m venv /opt/yt-dlp \
    && /opt/yt-dlp/bin/pip install --no-cache-dir yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js lib.js ./
COPY public ./public
ENV NODE_ENV=production PORT=8080 YTDLP_BIN=/opt/yt-dlp/bin/yt-dlp
USER node
EXPOSE 8080
CMD ["node", "server.js"]
