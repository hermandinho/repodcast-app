# Repodcast render worker.
#
# Q1 wk3: adds ffmpeg + fonts on top of the Fastify skeleton. Alpine's
# ffmpeg 6.x supports H.264/AAC/MP3/subtitles — enough for the wk3 clip
# pipeline. `ttf-dejavu` supplies the caption font referenced by
# `force_style='Fontname=DejaVu Sans'` in worker/src/lib/ffmpeg.ts.
# `python3` is a runtime dep of ytdl-core's HTTP/HLS fallback.

FROM node:22-alpine

RUN apk add --no-cache \
      ffmpeg \
      fontconfig \
      ttf-dejavu \
      python3 \
 && fc-cache -f

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
