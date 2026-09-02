FROM node:22-alpine AS dev

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3, sharp)
RUN apk add --no-cache python3 make g++

# Optimize layer caching: install dependencies first
COPY package*.json tsconfig.json ./
RUN npm install

# Copy source code
COPY . .

CMD [ "npm", "run", "dev" ]

# ── Stage 1: Build, Test & Compile TypeScript ─────────────────
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json vitest.config.* ./
RUN npm ci

COPY src/ ./src/
COPY tests/ ./tests/

# Test gating: verify type safety and unit tests before producing build artifact
RUN npx tsc --noEmit && npm test && npx tsc

# ── Stage 2: Minimal Production Runner ────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev && apk del python3 make g++

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/auth_info && chown -R node:node /app

USER node

CMD ["node", "dist/index.js"]
