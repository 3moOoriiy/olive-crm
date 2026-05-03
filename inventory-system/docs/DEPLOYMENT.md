# دليل النشر على VPS - Ubuntu Server

## المتطلبات
- Ubuntu 20.04+ Server
- 2GB RAM minimum
- 20GB Storage minimum
- Domain name (اختياري)

---

## 1. تحديث النظام وتثبيت الأدوات الأساسية

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential ufw
```

## 2. تثبيت Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v && npm -v
```

## 3. تثبيت PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql

# إنشاء مستخدم وقاعدة بيانات
sudo -u postgres psql -c "CREATE USER inventory_user WITH PASSWORD 'StrongPassword123!';"
sudo -u postgres psql -c "CREATE DATABASE inventory_db OWNER inventory_user;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE inventory_db TO inventory_user;"
```

## 4. تثبيت PM2

```bash
sudo npm install -g pm2
```

## 5. رفع المشروع

```bash
# الطريقة 1: من Git
cd /var/www
sudo git clone YOUR_REPO_URL inventory-system
sudo chown -R $USER:$USER /var/www/inventory-system

# الطريقة 2: رفع مباشر عبر SCP
# scp -r ./inventory-system user@server-ip:/var/www/
```

## 6. إعداد Backend

```bash
cd /var/www/inventory-system/backend

# تثبيت الحزم
npm install --production

# إعداد ملف البيئة
cp .env.example .env
nano .env
```

**محتوى .env:**
```env
DATABASE_URL="postgresql://inventory_user:StrongPassword123!@localhost:5432/inventory_db?schema=public"
JWT_SECRET="your-very-strong-random-secret-key-min-32-chars"
JWT_REFRESH_SECRET="another-very-strong-random-secret-key"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
PORT=5000
NODE_ENV=production
FRONTEND_URL=https://yourdomain.com
```

```bash
# تهيئة قاعدة البيانات
npx prisma migrate deploy
npx prisma generate
npm run prisma:seed

# إنشاء مجلدات مطلوبة
mkdir -p uploads logs
```

## 7. بناء Frontend

```bash
cd /var/www/inventory-system/frontend
npm install
npm run build
```

## 8. تشغيل التطبيق بـ PM2

```bash
cd /var/www/inventory-system/backend

# تشغيل
pm2 start src/server.js --name "inventory-api" --env production

# حفظ الإعدادات للتشغيل التلقائي
pm2 save
pm2 startup

# أوامر مفيدة
pm2 status
pm2 logs inventory-api
pm2 restart inventory-api
```

## 9. إعداد Nginx

```bash
sudo apt install -y nginx

# إنشاء ملف الإعداد
sudo nano /etc/nginx/sites-available/inventory
```

**محتوى الملف:**
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Frontend (static files)
    root /var/www/inventory-system/frontend/dist;
    index index.html;

    # Uploads
    location /uploads {
        alias /var/www/inventory-system/backend/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # API Proxy
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 256;

    client_max_body_size 10M;
}
```

```bash
# تفعيل الموقع
sudo ln -s /etc/nginx/sites-available/inventory /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

## 10. إعداد SSL (Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# تجديد تلقائي
sudo certbot renew --dry-run
```

## 11. حماية السيرفر (Firewall)

```bash
# تفعيل جدار الحماية
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status

# تأمين SSH (اختياري لكن موصى به)
sudo nano /etc/ssh/sshd_config
# غيّر: PermitRootLogin no
# غيّر: PasswordAuthentication no  (بعد إعداد SSH keys)
sudo systemctl restart sshd
```

## 12. النسخ الاحتياطي التلقائي

```bash
# إنشاء سكربت النسخ الاحتياطي
sudo nano /usr/local/bin/backup-inventory.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/var/backups/inventory"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# نسخ قاعدة البيانات
pg_dump -U inventory_user inventory_db > "$BACKUP_DIR/db_$DATE.sql"

# نسخ الملفات المرفوعة
tar czf "$BACKUP_DIR/uploads_$DATE.tar.gz" /var/www/inventory-system/backend/uploads

# حذف النسخ الأقدم من 30 يوم
find $BACKUP_DIR -type f -mtime +30 -delete

echo "Backup completed: $DATE"
```

```bash
sudo chmod +x /usr/local/bin/backup-inventory.sh

# إضافة للـ crontab (نسخ يومية الساعة 2 صباحاً)
sudo crontab -e
# أضف السطر:
# 0 2 * * * /usr/local/bin/backup-inventory.sh >> /var/log/inventory-backup.log 2>&1
```

## 13. مراقبة الأداء

```bash
# مراقبة PM2
pm2 monit

# مراقبة الموارد
htop

# مراقبة السجلات
pm2 logs inventory-api --lines 100
tail -f /var/log/nginx/error.log
```

---

## استكشاف الأخطاء

| المشكلة | الحل |
|---------|------|
| 502 Bad Gateway | `pm2 restart inventory-api` ثم `pm2 logs` |
| خطأ قاعدة البيانات | تحقق من DATABASE_URL في .env |
| الصور لا تظهر | تحقق من صلاحيات مجلد uploads |
| SSL لا يعمل | `sudo certbot renew` |
