# ── Stage 1: Build React web app ─────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# ── Stage 2: Production server (Express + built SPA) ────────────────────────
FROM node:20-alpine

WORKDIR /app

# Server dependencies only (no devDeps needed at runtime)
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

# Server source
COPY server/ ./server/

# Built React app from stage 1 — server will serve this as static files
COPY --from=builder /app/web/dist ./web/dist

EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

CMD ["node", "server/index.js"]