# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests
COPY package*.json ./
COPY client/package*.json ./client/

# Install client deps
RUN npm install --workspace=client

# Copy client source
COPY client/ ./client/

# VITE_API_BASE_URL is intentionally left empty — nginx proxies /api/* and
# /uploads/* from the same origin, so the client uses relative paths.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build --workspace=client

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=builder /app/client/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
