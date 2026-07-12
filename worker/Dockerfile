# Repodcast render worker.
#
# v1 scope: Fastify HTTP server with /healthz. ffmpeg + ytdl-core land in
# a later commit (week 3) when we implement clip rendering.
#
# Alpine keeps the image small (~120 MB). We'll swap to node:22-slim
# (Debian) when we add ffmpeg + fonts, since Alpine's ffmpeg build is
# missing a couple of codecs we may want.

FROM node:22-alpine

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

USER app

ENV NODE_ENV=production
EXPOSE 8080

# wget is preinstalled on alpine; used by healthcheck in compose
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1

CMD ["node", "dist/server.js"]
