# Repodcast render worker.
#
# Q1 wk3: adds ffmpeg + fonts on top of the Fastify skeleton. Alpine's
# ffmpeg 6.x supports H.264/AAC/MP3/subtitles — enough for the wk3 clip
# pipeline. `ttf-dejavu` supplies the caption font referenced by
# `force_style='Fontname=DejaVu Sans'` in worker/src/lib/ffmpeg.ts.
# `python3` is a runtime dep of ytdl-core's HTTP/HLS fallback.
#
# `yt-dlp[default]` + `bgutil-ytdlp-pot-provider` power the /import/youtube/*
# endpoints — running from the VPS dodges Vercel's datacenter-IP block, and
# the pot-provider plugin mints the BotGuard tokens YouTube demands. The
# `[default]` extras pull in `curl-cffi`, which is critical: without it,
# yt-dlp falls back to Python's stock urllib TLS stack and YouTube flags
# every request as a bot by JA3 fingerprint alone, long before any client-
# level PO check runs.
#
# `deno` provides the JS runtime yt-dlp needs to solve YouTube's player
# JavaScript challenge on the `web` and `mweb` clients (the ones that
# actually consume PO tokens). Without a JS runtime the extraction chain
# never reaches those clients, so the PO provider sits idle. Alpine's
# `deno` package is in community; if it disappears in a future Alpine
# release, swap to a curl-and-untar install from deno_land releases.
#
# Plugin auto-discovery: bgutil-ytdlp-pot-provider registers itself under
# yt-dlp's plugin namespace when both packages sit in the same
# site-packages tree, so a single pip install is enough — no
# /etc/yt-dlp/plugins juggling. `--break-system-packages` is the
# sanctioned escape from PEP 668 in a container context.

FROM node:22-alpine

RUN apk add --no-cache \
      ffmpeg \
      fontconfig \
      ttf-dejavu \
      python3 \
      py3-pip \
      deno \
 && fc-cache -f \
 && pip install --break-system-packages --no-cache-dir \
      "yt-dlp[default]" \
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
