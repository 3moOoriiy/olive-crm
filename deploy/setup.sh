#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
#  Olive CRM — VPS Setup Script (Ubuntu 20.04 / 22.04 / 24.04)
#  Run as root or with sudo on a FRESH Hostinger VPS:
#    bash setup.sh
# ════════════════════════════════════════════════════════════════
set -euo pipefail

GREEN="\033[1;32m"; YELLOW="\033[1;33m"; RED="\033[1;31m"; NC="\033[0m"
log()  { echo -e "${GREEN}▶${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
err()  { echo -e "${RED}✗${NC} $*" >&2; }

if [[ $EUID -ne 0 ]]; then
  err "Run with sudo or as root: sudo bash setup.sh"
  exit 1
fi

# ─── Inputs ─────────────────────────────────────────────────────
read -rp "🌐 الدومين (اتركه فاضي للوصول بالـ IP فقط): " DOMAIN
read -rp "📦 GitHub repo URL [https://github.com/3moOoriiy/olive-crm.git]: " REPO
REPO=${REPO:-https://github.com/3moOoriiy/olive-crm.git}
read -rp "📂 مكان التثبيت [/opt/olive-crm]: " APP_DIR
APP_DIR=${APP_DIR:-/opt/olive-crm}
read -rp "🔐 توليد JWT_SECRET تلقائياً؟ [Y/n]: " GEN_JWT
GEN_JWT=${GEN_JWT:-Y}

# ─── 1. System update + base packages ──────────────────────────
log "تحديث النظام وتثبيت الحزم الأساسية..."
apt-get update -y
apt-get install -y curl git build-essential ufw

# ─── 2. Node.js 22 (NodeSource) ────────────────────────────────
if ! command -v node >/dev/null 2>&1 || [[ $(node -v | sed 's/v//' | cut -d. -f1) -lt 20 ]]; then
  log "تثبيت Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
log "Node $(node -v) • npm $(npm -v)"

# ─── 3. PM2 (process manager) ──────────────────────────────────
if ! command -v pm2 >/dev/null 2>&1; then
  log "تثبيت PM2..."
  npm install -g pm2
fi

# ─── 4. Nginx ──────────────────────────────────────────────────
if ! command -v nginx >/dev/null 2>&1; then
  log "تثبيت Nginx..."
  apt-get install -y nginx
fi
systemctl enable --now nginx

# ─── 5. Certbot (SSL via Let's Encrypt) ────────────────────────
if [[ -n "$DOMAIN" ]] && ! command -v certbot >/dev/null 2>&1; then
  log "تثبيت Certbot..."
  apt-get install -y certbot python3-certbot-nginx
fi

# ─── 6. Clone the repo ─────────────────────────────────────────
if [[ -d "$APP_DIR/.git" ]]; then
  log "المشروع موجود — git pull..."
  cd "$APP_DIR" && git pull
else
  log "Clone للمشروع في $APP_DIR..."
  mkdir -p "$(dirname "$APP_DIR")"
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

# ─── 7. npm install ────────────────────────────────────────────
log "تثبيت dependencies الـ CRM..."
npm install --omit=dev
if [[ -d "inventory-system/backend" ]]; then
  log "تثبيت dependencies نظام المخزن..."
  (cd inventory-system/backend && npm install --omit=dev && npx prisma generate)
fi
if [[ -d "inventory-system/frontend" ]]; then
  log "بناء واجهة المخزن..."
  (cd inventory-system/frontend && npm install && npm run build)
fi

# ─── 8. .env scaffolding ───────────────────────────────────────
if [[ ! -f .env ]]; then
  log "إنشاء ملف .env..."
  if [[ "$GEN_JWT" =~ ^[Yy]$ ]]; then
    JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')
  else
    JWT_SECRET="CHANGE-ME"
  fi
  cat > .env <<EOF
# Server
PORT=3000
NODE_ENV=production
JWT_SECRET=$JWT_SECRET

# Rate limit
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=5

# Inventory (Prisma)
DATABASE_URL=file:$APP_DIR/data/inventory.db
JWT_REFRESH_SECRET=$(openssl rand -base64 48 | tr -d '\n')
UPLOAD_DIR=$APP_DIR/data/inventory-uploads

# Integration webhook (for external websites)
INTEGRATION_API_KEY=$(openssl rand -hex 24)

# J&T Express Egypt — leave blank if not used
JT_AUTH_TOKEN=
JT_SENDER_NAME=
JT_SENDER_PHONE=
JT_SENDER_PROVINCE=
JT_SENDER_CITY=

# Shopify — leave blank if not used
SHOPIFY_WEBHOOK_SECRET=
SHOPIFY_SHOP_DOMAIN=
SHOPIFY_ADMIN_TOKEN=
EOF
  warn "ملف .env تم إنشاؤه — افتحه وعدل القيم اللي محتاجها: nano $APP_DIR/.env"
else
  log ".env موجود بالفعل — لن يتم استبداله"
fi

# Prepare data folders
mkdir -p data data/wa_auth data/inventory-uploads
chown -R "$(logname 2>/dev/null || echo root):" data || true

# Prisma migrations (if inventory used)
if [[ -d "inventory-system/backend" ]]; then
  log "تشغيل Prisma migrations..."
  (cd inventory-system/backend && npx prisma migrate deploy) || warn "Migrations failed — تحقق من DATABASE_URL"
fi

# ─── 9. PM2 ecosystem ──────────────────────────────────────────
cat > ecosystem.config.cjs <<EOF
module.exports = {
  apps: [{
    name: 'olive-crm',
    script: 'server.js',
    cwd: '$APP_DIR',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: { NODE_ENV: 'production' }
  }]
};
EOF

log "تشغيل التطبيق عبر PM2..."
pm2 startOrRestart ecosystem.config.cjs --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null

# ─── 10. Nginx site ────────────────────────────────────────────
log "إعداد Nginx..."
SITE_NAME=${DOMAIN:-olive-crm}
cat > /etc/nginx/sites-available/$SITE_NAME <<EOF
server {
    listen 80;
    server_name ${DOMAIN:-_};
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 120s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/$SITE_NAME /etc/nginx/sites-enabled/$SITE_NAME
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ─── 11. Firewall ──────────────────────────────────────────────
log "إعداد الـ firewall..."
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
yes | ufw enable || true

# ─── 12. SSL (Let's Encrypt) ───────────────────────────────────
if [[ -n "$DOMAIN" ]]; then
  log "محاولة الحصول على شهادة SSL لـ $DOMAIN..."
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || warn "SSL فشل — تأكد إن الدومين موجّه لـ IP السيرفر"
fi

# ─── Done ──────────────────────────────────────────────────────
IP=$(curl -s ifconfig.me || echo "?")
echo ""
echo "════════════════════════════════════════════"
echo "  ✅ تم النشر بنجاح!"
echo "════════════════════════════════════════════"
echo "  IP السيرفر: $IP"
[[ -n "$DOMAIN" ]] && echo "  الدومين: https://$DOMAIN"
echo "  مكان المشروع: $APP_DIR"
echo "  ملف .env: $APP_DIR/.env"
echo ""
echo "  أوامر مفيدة:"
echo "    pm2 status              # حالة التطبيق"
echo "    pm2 logs olive-crm      # عرض الـ logs مباشر"
echo "    pm2 restart olive-crm   # إعادة تشغيل"
echo "    nano $APP_DIR/.env      # تعديل الإعدادات"
echo ""
echo "  للتحديث في المستقبل:"
echo "    cd $APP_DIR && git pull && npm install --omit=dev && pm2 restart olive-crm"
echo "════════════════════════════════════════════"
