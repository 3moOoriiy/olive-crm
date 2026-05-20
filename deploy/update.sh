#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  Olive CRM — Update Script
#  Pull latest from git + rebuild + restart
#  Usage: cd /opt/olive-crm/deploy && bash update.sh
# ════════════════════════════════════════════════════════════════
set -euo pipefail

GREEN="\033[1;32m"; NC="\033[0m"
log() { echo -e "${GREEN}▶${NC} $*"; }

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

log "Pulling latest from git..."
git pull --rebase

log "Installing CRM dependencies..."
npm install --omit=dev

if [[ -d "inventory-system/backend" ]]; then
  log "Updating inventory backend..."
  (cd inventory-system/backend && npm install --omit=dev && npx prisma generate && npx prisma migrate deploy)
fi
if [[ -d "inventory-system/frontend" ]]; then
  log "Rebuilding inventory frontend..."
  (cd inventory-system/frontend && npm install && npm run build)
fi

log "Restarting PM2..."
pm2 restart olive-crm --update-env

log "Done — pm2 status:"
pm2 status
