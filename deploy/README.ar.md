# 🚀 نشر Olive CRM على VPS Hostinger — دليل بالعربي

## المتطلبات
- VPS على Hostinger (أو أي مزود) — Ubuntu 22.04 أو 24.04 LTS
- صلاحية SSH كـ root (أو مستخدم sudo)
- (اختياري) دومين موجّه لـ IP السيرفر

---

## ⚡ النشر السريع (سطر واحد)

افتح SSH للسيرفر وانفّذ:

```bash
curl -fsSL https://raw.githubusercontent.com/3moOoriiy/olive-crm/main/deploy/setup.sh -o setup.sh && sudo bash setup.sh
```

السكربت هيسألك:
1. **الدومين** (سيبه فاضي لو هتستخدم IP بس)
2. **GitHub repo URL** (default: 3moOoriiy/olive-crm)
3. **مكان التثبيت** (default: /opt/olive-crm)
4. **توليد JWT secret أوتوماتيك؟** (Y/n)

---

## 🔧 الخطوات يدوياً (لو حابب تتحكم)

### 1. ادخل VPS عبر SSH

من Hostinger Dashboard → VPS → Browser Terminal، أو من ويندوز:

```bash
ssh root@YOUR_VPS_IP
```

### 2. حدّث النظام

```bash
sudo apt-get update -y && sudo apt-get upgrade -y
sudo apt-get install -y curl git build-essential ufw
```

### 3. ثبّت Node.js 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt-get install -y nodejs
node -v   # لازم يطلع v22.x
```

### 4. ثبّت PM2 و Nginx

```bash
sudo npm install -g pm2
sudo apt-get install -y nginx
```

### 5. Clone المشروع

```bash
cd /opt
sudo git clone https://github.com/3moOoriiy/olive-crm.git
cd olive-crm
sudo npm install --omit=dev
```

### 6. ثبّت dependencies نظام المخزن (لو هتستخدمه)

```bash
cd inventory-system/backend
sudo npm install --omit=dev
sudo npx prisma generate

cd ../frontend
sudo npm install
sudo npm run build

cd /opt/olive-crm
```

### 7. اعمل ملف .env

```bash
sudo nano .env
```

والصق ده وعدّل القيم:

```env
PORT=3000
NODE_ENV=production
JWT_SECRET=GENERATE_STRONG_RANDOM_STRING_HERE

# Inventory
DATABASE_URL=file:/opt/olive-crm/data/inventory.db
JWT_REFRESH_SECRET=ANOTHER_STRONG_RANDOM_STRING
UPLOAD_DIR=/opt/olive-crm/data/inventory-uploads

# Integration / Shopify / J&T — ضيف القيم اللي محتاجها
INTEGRATION_API_KEY=
SHOPIFY_WEBHOOK_SECRET=
JT_AUTH_TOKEN=
```

> لتوليد secret قوي: `openssl rand -base64 48`

### 8. شغّل migrations المخزن

```bash
mkdir -p data/wa_auth data/inventory-uploads
cd inventory-system/backend
sudo npx prisma migrate deploy
cd /opt/olive-crm
```

### 9. شغّل التطبيق بـ PM2

```bash
sudo pm2 start server.js --name olive-crm
sudo pm2 save
sudo pm2 startup systemd -u root --hp /root
```

أوامر مفيدة:
```bash
pm2 status                # حالة التطبيق
pm2 logs olive-crm        # شوف الـ logs
pm2 restart olive-crm     # إعادة تشغيل
pm2 monit                 # مراقبة CPU/RAM
```

### 10. اعمل Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/olive-crm
```

والصق:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;
    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

فعّل الـ site:
```bash
sudo ln -s /etc/nginx/sites-available/olive-crm /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

### 11. الـ Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

### 12. SSL مجاناً (لو عندك دومين)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

اتبع الأسئلة. اضغط `2` لما يسأل عن redirect HTTP → HTTPS.

---

## 🔄 التحديث في المستقبل

كل ما تعمل push على GitHub، ادخل السيرفر ونفّذ:

```bash
cd /opt/olive-crm
bash deploy/update.sh
```

أو يدوياً:
```bash
cd /opt/olive-crm
git pull
npm install --omit=dev
pm2 restart olive-crm
```

---

## 🛠️ Troubleshooting

### السيرفر مش شغّال
```bash
pm2 logs olive-crm
```

### Nginx مش شغّال
```bash
sudo nginx -t
sudo systemctl status nginx
```

### المنفذ 3000 مشغول
```bash
sudo lsof -i :3000
```

### مساحة القرص
```bash
df -h
```

### إعادة تشغيل كل شيء
```bash
pm2 restart all
sudo systemctl restart nginx
```

---

## 🌐 ضبط Domain

في Hostinger Domain Panel:
- اعمل DNS A record يشير `your-domain.com` → `IP_VPS`
- لـ www: A record `www` → `IP_VPS`
- استنّى 5-30 دقيقة عشان DNS propagation
- بعدها شغّل `certbot --nginx -d your-domain.com -d www.your-domain.com`

---

## 📦 Hostinger Tips
- VPS plans عادةً تحت 4GB RAM → استخدم `max_memory_restart: '500M'` في PM2
- لو SSH ما يشتغلش بـ password، استخدم SSH key من Hostinger Panel
- Firewall في Hostinger Panel كمان لازم يفتح ports 80 و 443
