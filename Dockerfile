FROM node:20-slim AS base

WORKDIR /app

# Install build dependencies for native Node addons (better-sqlite3, sharp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json ./
RUN npm ci

COPY . .

CMD ["npm", "start"]
