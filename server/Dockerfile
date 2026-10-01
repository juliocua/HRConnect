# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache openssl

COPY server/package*.json ./
RUN npm install

COPY server/ ./

RUN node_modules/.bin/prisma generate
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

RUN apk add --no-cache openssl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY server/package.json ./

RUN mkdir -p uploads/photos

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "node node_modules/.bin/prisma db push && node dist/index.js"]