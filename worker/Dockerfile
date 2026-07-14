# Repodcast render worker.
#
# Q1 wk3: adds ffmpeg + fonts on top of the Fastify skeleton. Alpine's
# ffmpeg 6.x supports H.264/AAC/MP3/subtitles — enough for the wk3 clip
# pipeline. `ttf-dejavu` supplies the caption font referenced by
# `force_style='Fontname=DejaVu Sans'` in worker/src/lib/ffmpeg.ts.
# `python3` is a runtime dep of ytdl-core's HTTP/HLS fallback.
#
# `yt-dlp` + `bgutil-ytdlp-pot-provider` power the /import/youtube/*
# endpoints — running from the VPS dodges Vercel's datacenter-IP block,
# and the pot-provider plugin mints the BotGuard tokens YouTube demands
# when it decides a request "might be a bot". The plugin auto-registers
# with yt-dlp when both packages sit in the same site-packages tree, so
# a single pip install is enough — no /etc/yt-dlp/plugins juggling.
#
# We install via pip (not apk) so we can pick up upstream fixes on every
# image rebuild — YouTube ships anti-scraping changes monthly and Alpine's
# apk package trails by weeks. `--break-system-packages` is the sanctioned
# escape from PEP 668 in a container context where there's no OS-managed
# Python surface to conflict with.

FROM node:22-alpine

RUN apk add --no-cache \
      ffmpeg \
      fontconfig \
      ttf-dejavu \
      python3 \
      py3-pip \
 && fc-cache -f \
 && pip install --break-system-packages --no-cache-dir \
      yt-dlp \
      bgutil-ytdlp-pot-provider

# Non-root user for defence in depth
RUN addgroup -S app && adduser -S -G app app

WORKDIR /app

# Install deps first for better layer caching
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

# App code
COPY --chown=app:app tsconfig.json ./
COPY --chown=app:app src/ ./src/

# Compile TypeScript at build time
RUN npm install --no-save typescript@5.6 \
 && npx tsc --project tsconfig.json \
 && rm -rf src node_modules/typescript

# Scratch dir for per-job ffmpeg working files
RUN mkdir -p /tmp/render && chown app:app /tmp/render

USER app

ENV NODE_ENV=production
ENV WORK_DIR=/tmp/render
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["node", "dist/server.js"]
