# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm run build

# ── Stage 2: Production ────────────────────────────────────────────────────
FROM node:20-bookworm AS production

# Install Chromium via apt (bookworm has all required libs)
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN npm install -g pnpm@10.4.1

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
COPY patches ./patches

RUN pnpm install --no-frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

COPY drizzle ./drizzle
COPY drizzle.config.ts ./

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "dist/index.js"]
