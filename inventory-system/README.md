# نظام إدارة المخزون والمبيعات - Enterprise Inventory & Sales Management System

نظام ويب احترافي متكامل لإدارة المخزون والمبيعات متعدد الفروع، مبني بتقنيات حديثة وجاهز للاستخدام التجاري.

**تم التطوير بواسطة AmrAlaa**

---

## المميزات الرئيسية

- **دعم فروع متعددة** - إدارة مخزون مستقل لكل فرع مع إمكانية نقل المخزون بينها
- **نظام نقطة البيع (POS)** - واجهة بيع احترافية مع دعم الباركود سكانر
- **الفواتير** - إنشاء فواتير بيع وإرجاع مع حساب الضرائب والخصومات
- **إدارة المخزون** - تتبع حركة المخزون، جرد دوري، تنبيهات المخزون المنخفض
- **QR Code** - توليد تلقائي لكل منتج
- **التقارير المتقدمة** - تقارير المبيعات، الأرباح، المنتجات الأكثر مبيعاً
- **صلاحيات دقيقة (RBAC)** - 5 أدوار مختلفة مع صلاحيات مرتبطة بالفرع
- **سجل النشاطات** - تتبع كامل لجميع العمليات
- **واجهة عربية** - تصميم RTL احترافي ومتجاوب بالكامل

## التقنيات المستخدمة

### Backend
| التقنية | الغرض |
|---------|-------|
| Node.js + Express | إطار العمل الخلفي |
| PostgreSQL | قاعدة البيانات |
| Prisma ORM | إدارة قاعدة البيانات |
| JWT | المصادقة (Access + Refresh Tokens) |
| Joi | التحقق من البيانات |
| Winston | نظام السجلات |
| Helmet + CORS | الحماية |
| Rate Limiting | حماية من الطلبات الزائدة |

### Frontend
| التقنية | الغرض |
|---------|-------|
| React 18 | واجهة المستخدم |
| Vite | أداة البناء |
| Tailwind CSS | التصميم |
| React Router 6 | التوجيه |
| Recharts | الرسوم البيانية |
| Axios | طلبات HTTP |
| React Hot Toast | الإشعارات |

## هيكل المشروع

```
inventory-system/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          # مخطط قاعدة البيانات
│   │   └── seed.js                # بيانات تجريبية
│   ├── src/
│   │   ├── config/                # إعدادات التطبيق
│   │   ├── controllers/           # وحدات التحكم
│   │   ├── middleware/            # الوسائط (Auth, RBAC, Validation)
│   │   ├── routes/                # مسارات API
│   │   ├── utils/                 # أدوات مساعدة
│   │   ├── validators/            # قواعد التحقق
│   │   ├── app.js                 # إعداد Express
│   │   └── server.js              # نقطة البدء
│   ├── uploads/                   # صور المنتجات
│   ├── .env.example
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── api/                   # خدمات API
│   │   ├── components/            # المكونات المشتركة
│   │   ├── context/               # سياق React
│   │   ├── pages/                 # الصفحات
│   │   ├── App.jsx                # المكون الرئيسي
│   │   └── main.jsx               # نقطة البدء
│   ├── index.html
│   └── package.json
├── docs/                          # الوثائق
└── README.md
```

## التشغيل المحلي

### المتطلبات
- Node.js 18+
- PostgreSQL 14+
- npm أو yarn

### 1. إعداد قاعدة البيانات
```bash
# إنشاء قاعدة بيانات
psql -U postgres -c "CREATE DATABASE inventory_db;"
```

### 2. إعداد Backend
```bash
cd backend

# نسخ ملف البيئة
cp .env.example .env
# عدّل .env بإعدادات قاعدة البيانات

# تثبيت الحزم
npm install

# تهيئة قاعدة البيانات
npx prisma migrate dev --name init
npx prisma generate

# إضافة بيانات تجريبية
npm run prisma:seed

# تشغيل الخادم
npm run dev
```

### 3. إعداد Frontend
```bash
cd frontend

# تثبيت الحزم
npm install

# تشغيل في وضع التطوير
npm run dev
```

### 4. الوصول
- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:5000/api

### بيانات الدخول التجريبية
| الدور | البريد | كلمة المرور |
|-------|--------|-------------|
| مدير النظام | admin@inventory.com | admin123 |
| مدير فرع | manager@inventory.com | manager123 |
| كاشير | cashier@inventory.com | cashier123 |

## نقاط API الرئيسية

| المسار | الطريقة | الوصف |
|--------|---------|-------|
| `/api/auth/login` | POST | تسجيل الدخول |
| `/api/auth/register` | POST | إنشاء مستخدم |
| `/api/branches` | GET/POST | إدارة الفروع |
| `/api/products` | GET/POST | إدارة المنتجات |
| `/api/products/barcode/:code` | GET | بحث بالباركود |
| `/api/invoices` | GET/POST | الفواتير |
| `/api/invoices/:id/refund` | POST | إرجاع فاتورة |
| `/api/inventory/stock/:branchId` | GET | مخزون الفرع |
| `/api/inventory/adjust` | POST | تعديل المخزون |
| `/api/inventory/counts` | POST | جرد دوري |
| `/api/transfers` | GET/POST | تحويل مخزون |
| `/api/reports/dashboard` | GET | لوحة التحكم |
| `/api/reports/sales` | GET | تقرير المبيعات |
| `/api/reports/profit` | GET | تقرير الأرباح |

## الأدوار والصلاحيات

| الدور | الصلاحيات |
|-------|----------|
| **ADMIN** | صلاحيات كاملة على النظام |
| **BRANCH_MANAGER** | إدارة الفرع، المبيعات، المخزون، التقارير |
| **CASHIER** | نقطة البيع، الفواتير، عرض المنتجات |
| **WAREHOUSE** | إدارة المخزون، المنتجات، التحويلات |
| **VIEWER** | عرض فقط |

## دعم الباركود سكانر

النظام يدعم أجهزة USB Barcode Scanner مباشرة:
1. قم بتوصيل الجهاز عبر USB
2. افتح صفحة نقطة البيع (POS)
3. امسح الباركود - سيتم التعرف على المنتج تلقائياً وإضافته للسلة

**آلية العمل:** أجهزة الباركود تعمل كلوحة مفاتيح، تكتب رقم الباركود وتضغط Enter. حقل الإدخال في POS يستمع لهذا الإدخال ويبحث عن المنتج.

## الترخيص

هذا النظام مطور بواسطة AmrAlaa ومحمي بحقوق الملكية الفكرية.
