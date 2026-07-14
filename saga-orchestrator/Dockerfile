# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:18-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

COPY proto /proto
RUN npm run build

# ─── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --only=production && npm cache clean --force

# Copy compiled output
COPY --from=builder /app/dist ./dist

# proto file is needed at runtime for gRPC client
COPY --from=builder /proto /proto

EXPOSE 8083

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8083/health || exit 1

CMD ["node", "dist/index.js"]
