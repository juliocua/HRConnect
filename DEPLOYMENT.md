# HRConnect — On-Premises Deployment Guide

## Overview

HRConnect is a full-stack HR Information System consisting of:
- **Server** — Node.js / Express / TypeScript (runs as a background service via PM2)
- **Client** — React / Vite (built to static files, served by Nginx)
- **Database** — PostgreSQL (managed locally or via a dedicated DB server)

---

## Prerequisites

Install the following on the server before anything else:

| Tool | Version | Notes |
|---|---|---|
| Node.js | 20.x LTS | Use [nvm](https://github.com/nvm-sh/nvm) or the official installer |
| npm | Comes with Node | |
| PostgreSQL | 14+ | Can be local or remote |
| PM2 | Latest | `npm install -g pm2` |
| Nginx | Latest | `apt install nginx` / `yum install nginx` |
| Git | Latest | For pulling updates |

---

## First-Time Setup (One-Time)

### 1. Clone the repository

```bash
git clone https://github.com/YOUR_ORG/hrconnect.git /opt/hrconnect
cd /opt/hrconnect
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example env file and fill in all values:

```bash
cp server/.env.example server/.env
nano server/.env
```

Required variables in `server/.env`:

```env
DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/hrconnect
JWT_SECRET=your-long-random-secret
SERVER_URL=http://YOUR_SERVER_IP_OR_DOMAIN
PORT=4000
NODE_ENV=production
```

> **Important:** `SERVER_URL` must be the public-facing URL of the server (used to construct photo/file URLs). No trailing slash.

### 4. Set up the database

Create the PostgreSQL database, then push the schema:

```bash
createdb hrconnect   # or create via psql
cd server
npx prisma db push
```

### 5. Seed the database (first time only)

```bash
cd server
npx ts-node src/seed.ts
# Default admin: admin@hrconnect.demo / Admin@2026
```

### 6. Build the application

```bash
# Build the backend
cd /opt/hrconnect/server
npm run build

# Build the frontend
cd /opt/hrconnect/client
npm run build
```

### 7. Start the server with PM2

```bash
cd /opt/hrconnect/server
pm2 start dist/index.js --name hrconnect-server
pm2 save
pm2 startup   # follow the printed command to enable auto-start on reboot
```

### 8. Configure Nginx

Create `/etc/nginx/sites-available/hrconnect`:

```nginx
server {
    listen 80;
    server_name YOUR_SERVER_IP_OR_DOMAIN;

    # Serve the React frontend (static files)
    root /opt/hrconnect/client/dist;
    index index.html;

    # SPA fallback — React Router handles routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to the Express backend
    location /api/ {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # Serve uploaded files (photos, documents)
    location /uploads/ {
        proxy_pass http://localhost:4000;
    }
}
```

Enable and start:

```bash
ln -s /etc/nginx/sites-available/hrconnect /etc/nginx/sites-enabled/
nginx -t          # verify config
systemctl reload nginx
```

---

## Deploying Updates

Run this every time you push new code to the repository.

### Quick reference

```bash
cd /opt/hrconnect

# 1. Pull latest code
git pull origin main

# 2. Install any new packages
npm install

# 3. Push schema changes (ONLY if schema.prisma was modified)
cd server && npx prisma db push && cd ..

# 4. Rebuild the backend
cd server && npm run build && cd ..

# 5. Rebuild the frontend
cd client && npm run build && cd ..

# 6. Restart the backend service
pm2 restart hrconnect-server
```

Nginx does **not** need to be restarted — it picks up the new `client/dist/` automatically.

### When to run `prisma db push`

Run it whenever `server/prisma/schema.prisma` has changed. If you're unsure, check the git diff:

```bash
git diff HEAD~1 -- server/prisma/schema.prisma
```

If there's output, run `prisma db push`. If no output, skip it.

### When to run `npm install`

Run it whenever `package.json` or `package-lock.json` changed:

```bash
git diff HEAD~1 -- package.json package-lock.json server/package.json client/package.json
```

---

## Deploy Script (Recommended)

Save this as `/opt/hrconnect/deploy.sh` and make it executable (`chmod +x deploy.sh`):

```bash
#!/bin/bash
set -e

echo "=== HRConnect Deploy ==="
cd /opt/hrconnect

echo "[1/5] Pulling latest code..."
git pull origin main

echo "[2/5] Installing packages..."
npm install

echo "[3/5] Pushing schema (if changed)..."
cd server
npx prisma db push
cd ..

echo "[4/5] Building..."
cd server && npm run build && cd ..
cd client && npm run build && cd ..

echo "[5/5] Restarting server..."
pm2 restart hrconnect-server

echo "=== Deploy complete ==="
pm2 status
```

Run a deploy from anywhere with:

```bash
ssh user@server-ip "cd /opt/hrconnect && ./deploy.sh"
```

---

## AI Assistant Setup (Post-Deploy)

After deploying, activate the Gemini AI chatbot:

1. Log in as Super Admin
2. Go to **Global Setup → AI**
3. Paste your Gemini API key (get one free at [aistudio.google.com](https://aistudio.google.com/app/apikey))
4. Click **Save API Key**

The chat bubble will appear for all logged-in users immediately.

---

## Useful Commands

| Task | Command |
|---|---|
| View server logs | `pm2 logs hrconnect-server` |
| Check service status | `pm2 status` |
| Restart server | `pm2 restart hrconnect-server` |
| Stop server | `pm2 stop hrconnect-server` |
| Check Nginx status | `systemctl status nginx` |
| Reload Nginx config | `systemctl reload nginx` |
| Connect to DB | `psql -U postgres -d hrconnect` |
| Check Node version | `node -v` |

---

## Rollback

If a deploy breaks something:

```bash
cd /opt/hrconnect

# Go back one commit
git revert HEAD --no-edit
# OR reset to last known good commit
git reset --hard <COMMIT_HASH>

# Rebuild and restart
cd server && npm run build && cd ..
cd client && npm run build && cd ..
pm2 restart hrconnect-server
```

> Always tag releases before deploying so you have a clean rollback target: `git tag v1.2.0 && git push --tags`

---

## Node.js Version Note

HRConnect requires **Node.js 20+**. Two dependencies (`nodemailer`, `resend`) will show engine warnings on Node 18 — upgrade to avoid potential runtime issues:

```bash
# Using nvm
nvm install 20
nvm use 20
nvm alias default 20

# Verify
node -v   # should show v20.x.x
```
