require('dotenv').config();
// Required for inventory's Prisma raw SQL queries (CAST/SUM return BigInt)
BigInt.prototype.toJSON = function () { return Number(this); };
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { initDB, getDB, normalizePhone } = require('./db');
const jwt = require('jsonwebtoken');
const { loginHandler, requireAuth, requireRole, requirePermission, PERMISSIONS, JWT_SECRET } = require('./auth');
const { initWhatsApp, getStatus, sendMessage } = require('./whatsapp');
const jt = require('./jt');
const cors = require('cors');

// ═══════════════ CONSTANTS ═══════════════
const VALID_STATUSES = ['first_attempt', 'second_attempt', 'third_attempt', 'confirmed', 'rejected', 'waiting_transfer', 'postponed', 'shipped', 'duplicate'];

// ═══════════════ SERVER SETUP ═══════════════
const app = express();

// ✅ مهم على Render/Proxy عشان req.ip يبقى IP الحقيقي
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '10mb' }));

// ═══════════════ CORS — only on /api/integrations/* (public webhook) ═══════════════
const corsMiddleware = cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
});
app.use('/api/integrations', corsMiddleware);
app.options('/api/integrations/*', corsMiddleware);
// Disable browser caching for CRM static files (not /inventory which is versioned)
app.use((req, res, next) => {
  if (!req.path.startsWith('/inventory') && (req.path === '/' ||
      req.path.endsWith('.html') || req.path.endsWith('.css') || req.path.endsWith('.js'))) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

// ═══════════════ INVENTORY SYSTEM (mounted at /inventory) ═══════════════
require('dotenv').config({ path: path.join(__dirname, 'inventory-system/backend/.env') });
const inventoryDist = path.join(__dirname, 'inventory-system/frontend/dist');
app.use('/inventory', express.static(inventoryDist, { etag: false, maxAge: 0 }));
app.use('/inventory', (req, res, next) => {
  if (req.method === 'GET' && req.accepts('html') && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
    return res.sendFile(path.join(inventoryDist, 'index.html'));
  }
  next();
});
const inventoryApp = require('./inventory-system/backend/src/app');
app.use('/inventory', inventoryApp);

// ═══════════════ HELPERS ═══════════════
function checkAgentOwnership(req, res, customerId) {
  if (['moderator', 'call_center'].includes(req.user.role)) {
    const db = getDB();
    const customer = db.get('SELECT assigned_to FROM customers WHERE id = ?', [customerId]);
    if (!customer) return { error: true, status: 404, msg: 'العميل غير موجود' };
    if (customer.assigned_to !== req.user.id) return { error: true, status: 403, msg: 'غير مصرح لك بالتعامل مع هذا العميل' };
  }
  return { error: false };
}

// ═══════════════ AUTH ROUTES ═══════════════
app.post('/api/auth/login', loginHandler);

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ═══════════════ INVENTORY SSO ═══════════════
const inventoryPrisma = require('./inventory-system/backend/src/config/database');
const inventoryConfig = require('./inventory-system/backend/src/config');
const { v4: uuidv4 } = require('./inventory-system/backend/node_modules/uuid');

const CRM_TO_INV_ROLE = {
  admin: 'ADMIN',
  operations: 'ADMIN',
  supervisor: 'BRANCH_MANAGER',
  call_center: 'CASHIER',
  moderator: 'CASHIER',
  complaints: 'VIEWER',
  warehouse_manager:    'ADMIN',
  warehouse_supervisor: 'BRANCH_MANAGER',
  warehouse_worker:     'WAREHOUSE',
};

app.post('/api/inventory/sso', requireAuth, requirePermission('view:inventory'), async (req, res) => {
  try {
    const crmUser = req.user;
    const invRole = CRM_TO_INV_ROLE[crmUser.role] || 'VIEWER';

    // Ensure a default branch exists, so POS works out-of-the-box
    let defaultBranch = await inventoryPrisma.branch.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!defaultBranch) {
      defaultBranch = await inventoryPrisma.branch.create({
        data: { name: 'الفرع الرئيسي', address: '-', phone: '-' },
      });
    }

    let invUser = await inventoryPrisma.user.findUnique({ where: { email: crmUser.email } });
    if (!invUser) {
      const placeholderHash = await bcrypt.hash(uuidv4(), 4);
      invUser = await inventoryPrisma.user.create({
        data: {
          email: crmUser.email,
          name: crmUser.name,
          password: placeholderHash,
          role: invRole,
          isActive: true,
          branchId: defaultBranch.id,
        },
      });
    } else {
      const updates = {};
      if (invUser.role !== invRole && !invUser.permissions) updates.role = invRole;
      if (!invUser.branchId) updates.branchId = defaultBranch.id;
      if (Object.keys(updates).length) {
        invUser = await inventoryPrisma.user.update({ where: { id: invUser.id }, data: updates });
      }
    }

    const accessToken = jwt.sign({ userId: invUser.id }, inventoryConfig.jwt.secret, { expiresIn: inventoryConfig.jwt.expiresIn });
    const refreshToken = jwt.sign({ userId: invUser.id, tokenId: uuidv4() }, inventoryConfig.jwt.refreshSecret, { expiresIn: inventoryConfig.jwt.refreshExpiresIn });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    await inventoryPrisma.refreshToken.create({ data: { token: refreshToken, userId: invUser.id, expiresAt } });

    const { password: _, ...userData } = invUser;
    res.json({ user: userData, accessToken, refreshToken });
  } catch (err) {
    console.error('Inventory SSO error:', err);
    res.status(500).json({ error: 'فشل تسجيل الدخول للمخزن' });
  }
});

// ═══════════════ CUSTOMERS ═══════════════
app.get('/api/customers', requireAuth, (req, res) => {
  const db = getDB();
  const { status, source, agent, search, page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let where = ' WHERE 1=1';
  const params = [];

  if (status && status !== 'all') { where += ' AND status = ?'; params.push(status); }
  if (source && source !== 'all') { where += ' AND source = ?'; params.push(source); }
  if (agent && agent !== 'all') { where += ' AND assigned_to = ?'; params.push(agent); }
  if (search) {
    where += ' AND (name LIKE ? OR phone LIKE ? OR region LIKE ?)';
    const s = '%' + search + '%';
    params.push(s, s, s);
  }

  // If limited role, only show their own customers
  if (['moderator', 'call_center'].includes(req.user.role)) {
    where += ' AND assigned_to = ?';
    params.push(req.user.id);
  }

  // Get total count
  const total = db.get('SELECT COUNT(*) as c FROM customers' + where, params).c;

  // Get paginated results
  const sql = 'SELECT * FROM customers' + where + ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const customers = db.all(sql, [...params, limitNum, offset]);

  res.json({
    customers,
    pagination: {
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum)
    }
  });
});

app.get('/api/customers/:id', requireAuth, (req, res) => {
  const db = getDB();
  const id = req.params.id;

  const ownerCheck = checkAgentOwnership(req, res, id);
  if (ownerCheck.error) return res.status(ownerCheck.status).json({ error: ownerCheck.msg });

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [id]);
  if (!customer) return res.status(404).json({ error: 'العميل غير موجود' });

  const timeline = db.all('SELECT * FROM timeline WHERE customer_id = ? ORDER BY created_at DESC', [customer.id]);
  const orders = db.all('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC', [customer.id]);
  const messages = db.all('SELECT * FROM messages WHERE customer_id = ? ORDER BY created_at ASC', [customer.id]);

  res.json({ ...customer, timeline, orders, messages });
});

app.post('/api/customers', requireAuth, (req, res) => {
  const db = getDB();
  const { name, phone, phone2, region, source, assignedTo, notes, address } = req.body;

  if (!name || !phone) return res.status(400).json({ error: 'الاسم ورقم الهاتف مطلوبين' });

  const normalized = normalizePhone(phone);
  const existing = db.get('SELECT id, name FROM customers WHERE phone = ?', [normalized]);
  if (existing) return res.status(409).json({ error: 'يوجد عميل بهذا الرقم: ' + existing.name });

  const result = db.run(`
    INSERT INTO customers (name, phone, phone2, region, source, assigned_to, notes, address, status, last_contact, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'first_attempt', datetime('now'), datetime('now'))
  `, [name, normalized, normalizePhone(phone2) || '', region || '', source || '', assignedTo || req.user.id, notes || '', address || '']);

  // Add timeline entry
  db.run(`
    INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
    VALUES (?, 'created', 'تم إضافة العميل', '➕', ?, ?, datetime('now'))
  `, [result.lastInsertRowid, req.user.name, req.user.id]);

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(customer);
});

// ═══════════════ DELETE ALL CUSTOMERS ═══════════════
app.delete('/api/customers/all', requireAuth, requirePermission('customers:delete_all'), (req, res) => {
  const db = getDB();
  const count = db.get('SELECT COUNT(*) as c FROM customers').c;
  if (count === 0) return res.json({ deleted: 0, message: 'لا يوجد عملاء للحذف' });

  // Delete related data first (cascading)
  db.run('DELETE FROM messages WHERE customer_id IN (SELECT id FROM customers)');
  db.run('DELETE FROM timeline WHERE customer_id IN (SELECT id FROM customers)');
  db.run('DELETE FROM orders WHERE customer_id IN (SELECT id FROM customers)');
  db.run('DELETE FROM customers');

  res.json({ deleted: count, message: `تم حذف ${count} عميل بنجاح` });
});

// ═══════════════ IMPORT CUSTOMERS ═══════════════
app.post('/api/customers/import', requireAuth, (req, res) => {
  const db = getDB();
  const { customers: rows } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'لا توجد بيانات للاستيراد' });
  }

  let imported = 0, skipped = 0, errors = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try {
      const name = (row.name || '').trim();
      const phone = normalizePhone(row.phone || '');
      if (!name || !phone || phone.length < 5) {
        skipped++;
        continue;
      }

      const existing = db.get('SELECT id FROM customers WHERE phone = ?', [phone]);
      if (existing) { skipped++; continue; }

      const phone2 = normalizePhone(row.phone2 || '');
      const region = (row.region || '').trim();
      const source = (row.source || '').trim();
      const notes = (row.notes || '').trim();
      const address = (row.address || '').trim();
      const fullNotes = [notes, address].filter(Boolean).join(' — ');

      const statusMap = {
        'محاوله اولي': 'first_attempt', 'محاولة أولى': 'first_attempt', 'محاوله أولي': 'first_attempt', 'first_attempt': 'first_attempt',
        'محاوله ثانيه': 'second_attempt', 'محاولة ثانية': 'second_attempt', 'second_attempt': 'second_attempt',
        'محاوله ثالثه': 'third_attempt', 'محاولة ثالثة': 'third_attempt', 'third_attempt': 'third_attempt',
        'تم التأكيد': 'confirmed', 'confirmed': 'confirmed', 'مهتم': 'confirmed',
        'رفض': 'rejected', 'rejected': 'rejected', 'ملغي': 'rejected', 'cancelled': 'rejected', 'غير مهتم': 'rejected',
        'في انتظار التحويل': 'waiting_transfer', 'waiting_transfer': 'waiting_transfer',
        'تأجيل': 'postponed', 'postponed': 'postponed', 'يعاود الاتصال': 'postponed', 'callback': 'postponed',
        'تم الشحن': 'shipped', 'shipped': 'shipped', 'تم الارسال': 'shipped', 'شحن': 'shipped', 'تم الطلب': 'shipped', 'ordered': 'shipped', 'تم التسليم': 'shipped', 'delivered': 'shipped',
        'مكرر': 'duplicate', 'duplicate': 'duplicate',
        'جديد': 'first_attempt', 'new': 'first_attempt', 'لا يرد': 'second_attempt', 'no_answer': 'second_attempt',
      };
      const status = statusMap[(row.status || '').trim()] || 'first_attempt';

      const result = db.run(`
        INSERT INTO customers (name, phone, phone2, region, source, assigned_to, notes, status, last_contact, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `, [name, phone, phone2, region, source, req.user.id, fullNotes, status]);

      db.run(`
        INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
        VALUES (?, 'created', 'تم استيراد العميل من Excel', '📥', ?, ?, datetime('now'))
      `, [result.lastInsertRowid, req.user.name, req.user.id]);

      if (row.product && row.price) {
        const qty = parseInt(row.qty) || 1;
        const price = parseFloat(row.price) || 0;
        if (price > 0) {
          db.run(`
            INSERT INTO orders (customer_id, product_name, qty, price, total, status, address, product_id, created_at)
            VALUES (?, ?, ?, ?, ?, 'جديد', ?, 0, datetime('now'))
          `, [result.lastInsertRowid, row.product, qty, price, price * qty, region]);
        }
      }

      imported++;
    } catch (e) {
      errors.push(`صف ${i + 1}: ${e.message}`);
    }
  }

  res.json({ imported, skipped, errors: errors.slice(0, 10) });
});

app.put('/api/customers/:id', requireAuth, (req, res) => {
  const db = getDB();
  const { name, phone, phone2, region, source, assignedTo, address } = req.body;
  const id = req.params.id;

  const ownerCheck = checkAgentOwnership(req, res, id);
  if (ownerCheck.error) return res.status(ownerCheck.status).json({ error: ownerCheck.msg });

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [id]);
  if (!customer) return res.status(404).json({ error: 'العميل غير موجود' });

  const normalized = phone ? normalizePhone(phone) : customer.phone;
  if (normalized !== customer.phone) {
    const existing = db.get('SELECT id FROM customers WHERE phone = ? AND id != ?', [normalized, id]);
    if (existing) return res.status(409).json({ error: 'يوجد عميل آخر بهذا الرقم' });
  }

  db.run(`
    UPDATE customers SET name = ?, phone = ?, phone2 = ?, region = ?, source = ?, assigned_to = ?, address = ?,
    updated_at = datetime('now'), updated_by = ?, updated_by_name = ?
    WHERE id = ?
  `, [
    name || customer.name,
    normalized,
    phone2 !== undefined ? normalizePhone(phone2) || '' : customer.phone2,
    region !== undefined ? region : customer.region,
    source !== undefined ? source : customer.source,
    assignedTo || customer.assigned_to,
    address !== undefined ? address : customer.address,
    req.user.id, req.user.name,
    id
  ]);

  const updated = db.get('SELECT * FROM customers WHERE id = ?', [id]);
  res.json(updated);
});

app.patch('/api/customers/:id/status', requireAuth, (req, res) => {
  const db = getDB();
  const { status } = req.body;
  const id = req.params.id;

  // Validate status
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة' });
  }

  const ownerCheck = checkAgentOwnership(req, res, id);
  if (ownerCheck.error) return res.status(ownerCheck.status).json({ error: ownerCheck.msg });

  db.run('UPDATE customers SET status = ?, last_contact = datetime("now"), updated_at = datetime("now"), updated_by = ?, updated_by_name = ? WHERE id = ?', [status, req.user.id, req.user.name, id]);

  db.run(`
    INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
    VALUES (?, 'status', ?, '🔄', ?, ?, datetime('now'))
  `, [id, 'تغيير الحالة إلى: ' + status, req.user.name, req.user.id]);

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [id]);
  io.emit('customer:updated', { customer });
  res.json(customer);
});

app.patch('/api/customers/:id/notes', requireAuth, (req, res) => {
  const db = getDB();
  const id = req.params.id;

  const ownerCheck = checkAgentOwnership(req, res, id);
  if (ownerCheck.error) return res.status(ownerCheck.status).json({ error: ownerCheck.msg });

  db.run('UPDATE customers SET notes = ? WHERE id = ?', [req.body.notes || '', id]);
  res.json({ ok: true });
});

app.patch('/api/customers/:id/followup', requireAuth, (req, res) => {
  const db = getDB();
  const { followUpDate } = req.body;
  const id = req.params.id;

  const ownerCheck = checkAgentOwnership(req, res, id);
  if (ownerCheck.error) return res.status(ownerCheck.status).json({ error: ownerCheck.msg });

  db.run('UPDATE customers SET follow_up_date = ? WHERE id = ?', [followUpDate, id]);

  db.run(`
    INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
    VALUES (?, 'follow_up', ?, '📅', ?, ?, datetime('now'))
  `, [id, 'تم تحديد موعد متابعة: ' + followUpDate, req.user.name, req.user.id]);

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [id]);
  res.json(customer);
});

// ═══════════════ QUICK ACTIONS ═══════════════
app.post('/api/customers/:id/quick-action', requireAuth, (req, res) => {
  const db = getDB();
  const { action } = req.body;
  const id = req.params.id;

  const ownerCheck = checkAgentOwnership(req, res, id);
  if (ownerCheck.error) return res.status(ownerCheck.status).json({ error: ownerCheck.msg });

  const statusMap = { first_attempt: 'first_attempt', second_attempt: 'second_attempt', third_attempt: 'third_attempt', confirmed: 'confirmed', rejected: 'rejected', postponed: 'postponed' };
  const textMap = { first_attempt: 'محاولة أولى', second_attempt: 'محاولة ثانية', third_attempt: 'محاولة ثالثة', confirmed: 'تم التأكيد', rejected: 'رفض', postponed: 'تأجيل' };
  const iconMap = { first_attempt: '1️⃣', second_attempt: '2️⃣', third_attempt: '3️⃣', confirmed: '✅', rejected: '❌', postponed: '⏳' };

  const newStatus = statusMap[action];
  if (!newStatus) return res.status(400).json({ error: 'إجراء غير صالح' });

  db.run('UPDATE customers SET status = ?, last_contact = datetime("now"), updated_at = datetime("now"), updated_by = ?, updated_by_name = ? WHERE id = ?', [newStatus, req.user.id, req.user.name, id]);

  db.run(`
    INSERT INTO timeline (customer_id, type, text, icon, call_type, user_name, user_id, created_at)
    VALUES (?, 'call', ?, ?, 'outgoing', ?, ?, datetime('now'))
  `, [id, textMap[action], iconMap[action], req.user.name, req.user.id]);

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [id]);
  io.emit('customer:updated', { customer });
  res.json(customer);
});

app.post('/api/customers/:id/log-call', requireAuth, (req, res) => {
  const db = getDB();
  const { callType, result, notes } = req.body;
  const id = req.params.id;

  const ownerCheck = checkAgentOwnership(req, res, id);
  if (ownerCheck.error) return res.status(ownerCheck.status).json({ error: ownerCheck.msg });

  const statusMap = { 'تم التأكيد': 'confirmed', 'رفض': 'rejected', 'محاوله ثانيه': 'second_attempt', 'محاوله ثالثه': 'third_attempt', 'تأجيل': 'postponed', 'تم الشحن': 'shipped', 'مكرر': 'duplicate' };
  const newStatus = statusMap[result];

  if (newStatus) {
    db.run('UPDATE customers SET status = ?, last_contact = datetime("now"), updated_at = datetime("now"), updated_by = ?, updated_by_name = ? WHERE id = ?', [newStatus, req.user.id, req.user.name, id]);
  } else {
    db.run('UPDATE customers SET last_contact = datetime("now"), updated_at = datetime("now"), updated_by = ?, updated_by_name = ? WHERE id = ?', [req.user.id, req.user.name, id]);
  }

  const typeLabel = callType === 'outgoing' ? '📤 صادرة' : '📥 واردة';
  db.run(`
    INSERT INTO timeline (customer_id, type, text, detail, result, call_type, icon, user_name, user_id, created_at)
    VALUES (?, 'call', ?, ?, ?, ?, '📞', ?, ?, datetime('now'))
  `, [id, typeLabel + ' — ' + result, notes || '', result, callType, req.user.name, req.user.id]);

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [id]);
  io.emit('customer:updated', { customer });
  res.json(customer);
});

// ═══════════════ ORDERS ═══════════════
app.get('/api/orders', requireAuth, (req, res) => {
  const db = getDB();
  const { status, page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let where = '';
  const params = [];
  if (status && status !== 'all') { where = ' WHERE o.status = ?'; params.push(status); }

  const total = db.get(`SELECT COUNT(*) as c FROM orders o` + where, params).c;

  const sql = `SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.region as customer_region
               FROM orders o JOIN customers c ON o.customer_id = c.id` + where +
               ` ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;

  const orders = db.all(sql, [...params, limitNum, offset]);

  res.json({
    orders,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
  });
});

app.post('/api/customers/:id/orders', requireAuth, (req, res) => {
  const db = getDB();
  const customerId = req.params.id;
  const ownerCheck = checkAgentOwnership(req, res, customerId);
  if (ownerCheck.error) return res.status(ownerCheck.status).json({ error: ownerCheck.msg });

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
  if (!customer) return res.status(404).json({ error: 'العميل غير موجود' });

  // Accept either { items: [{productId, qty}, ...] } or legacy { productId, qty }
  const items = Array.isArray(req.body.items) && req.body.items.length
    ? req.body.items
    : [{ productId: req.body.productId, qty: req.body.qty }];
  const address = req.body.address || customer.region;

  const created = [];
  let grandTotal = 0;
  const labels = [];
  for (const it of items) {
    const product = db.get('SELECT * FROM products WHERE id = ?', [it.productId]);
    if (!product) return res.status(400).json({ error: `المنتج ID ${it.productId} غير موجود` });
    const q = parseInt(it.qty) || 1;
    const total = product.price * q;
    grandTotal += total;
    const result = db.run(`
      INSERT INTO orders (customer_id, product_id, product_name, qty, price, total, status, address, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'جديد', ?, 'manual', datetime('now'))
    `, [customerId, it.productId, product.name, q, product.price, total, address]);
    created.push(db.get('SELECT * FROM orders WHERE id = ?', [result.lastInsertRowid]));
    labels.push(`${product.name} × ${q}`);
  }

  db.run('UPDATE customers SET status = ?, last_contact = datetime("now") WHERE id = ?', ['ordered', customerId]);
  db.run(`
    INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
    VALUES (?, 'order', ?, '🛍️', ?, ?, datetime('now'))
  `, [customerId, `طلب جديد: ${labels.join(' • ')} — إجمالي ${grandTotal} جنيه`, req.user.name, req.user.id]);

  io.emit('customer:updated', { customer: db.get('SELECT * FROM customers WHERE id = ?', [customerId]) });
  res.status(201).json(created.length === 1 ? created[0] : { orders: created, total: grandTotal });
});

app.patch('/api/orders/:id/status', requireAuth, (req, res) => {
  const db = getDB();
  const { status } = req.body;
  db.run('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
  const order = db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  res.json(order);
});

// ═══════════════ WHATSAPP ═══════════════
app.get('/api/whatsapp/status', requireAuth, (req, res) => {
  res.json(getStatus());
});

app.post('/api/whatsapp/reconnect', requireAuth, async (req, res) => {
  try {
    console.log('🔄 Manual WhatsApp reconnect requested');
    await initWhatsApp(io);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/whatsapp/send', requireAuth, async (req, res) => {
  const db = getDB();
  const { customerId, text } = req.body;

  if (!text) return res.status(400).json({ error: 'الرسالة فارغة' });

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
  if (!customer) return res.status(404).json({ error: 'العميل غير موجود' });

  try {
    // Pick the best target for the WhatsApp API:
    // 1. existing wa_id (real @s.whatsapp.net JID we recorded)
    // 2. wa_lid (anonymous LID — only way to reach a customer that messaged us via LID)
    // 3. fall back to the normalized phone
    let waTarget;
    const phoneIsPlaceholder = (customer.phone || '').startsWith('lid:');
    if (customer.wa_id && customer.wa_id.includes('@')) {
      waTarget = customer.wa_id;
    } else if (customer.wa_lid && customer.wa_lid.includes('@')) {
      waTarget = customer.wa_lid;
    } else if (!phoneIsPlaceholder) {
      waTarget = normalizePhone(customer.phone);
    } else {
      return res.status(400).json({ error: 'لا يوجد رقم واتساب صالح لهذا العميل' });
    }
    const sendResult = await sendMessage(waTarget, text);

    // Store the ACTUAL JID from WhatsApp (may be lid format different from phone)
    // This ensures incoming replies match this customer
    const actualJid = sendResult?.key?.remoteJid;
    if (actualJid) {
      db.run('UPDATE customers SET wa_id = ? WHERE id = ?', [actualJid, customerId]);
    } else if (!customer.wa_id) {
      db.run('UPDATE customers SET wa_id = ? WHERE id = ?', [waPhone + '@s.whatsapp.net', customerId]);
    }

    const result = db.run(`
      INSERT INTO messages (customer_id, direction, text, user_name, user_id, created_at)
      VALUES (?, 'out', ?, ?, ?, datetime('now'))
    `, [customerId, text, req.user.name, req.user.id]);

    db.run('UPDATE customers SET last_contact = datetime("now") WHERE id = ?', [customerId]);

    db.run(`
      INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
      VALUES (?, 'whatsapp', ?, '💬', ?, ?, datetime('now'))
    `, [customerId, 'رسالة واتساب: ' + text.substring(0, 50), req.user.name, req.user.id]);

    const message = db.get('SELECT * FROM messages WHERE id = ?', [result.lastInsertRowid]);
    io.emit('message:new', { customerId, customerName: customer.name, customerPhone: customer.phone, message });

    res.json({ ok: true, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/customers/:id/messages', requireAuth, (req, res) => {
  const db = getDB();
  const messages = db.all('SELECT * FROM messages WHERE customer_id = ? ORDER BY created_at ASC', [req.params.id]);
  res.json(messages);
});

// ═══════════════ WHATSAPP CHATS ═══════════════
app.get('/api/whatsapp/chats', requireAuth, (req, res) => {
  const db = getDB();
  const { search, page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let where = ' WHERE 1=1';
  const params = [];

  // Limited roles see only their own customers
  if (['moderator', 'call_center'].includes(req.user.role)) {
    where += ' AND c.assigned_to = ?';
    params.push(req.user.id);
  }

  // Search by phone
  if (search) {
    where += ' AND (c.phone LIKE ? OR c.phone2 LIKE ? OR c.name LIKE ?)';
    const s = '%' + search + '%';
    params.push(s, s, s);
  }

  const total = db.get(`
    SELECT COUNT(*) as c FROM customers c
    INNER JOIN messages m ON m.customer_id = c.id
    ${where}
    AND m.id = (SELECT id FROM messages WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1)
  `, params).c;

  const chats = db.all(`
    SELECT c.id, c.name, c.phone, c.phone2, c.region, c.status,
           m.text as last_message_text,
           m.direction as last_message_direction,
           m.created_at as last_message_at,
           (SELECT COUNT(*) FROM messages WHERE customer_id = c.id AND direction = 'in'
            AND created_at > COALESCE(
              (SELECT MAX(created_at) FROM messages WHERE customer_id = c.id AND direction = 'out'),
              '1970-01-01'
            )
           ) as unread_count
    FROM customers c
    INNER JOIN messages m ON m.customer_id = c.id
    ${where}
    AND m.id = (SELECT id FROM messages WHERE customer_id = c.id ORDER BY created_at DESC LIMIT 1)
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limitNum, offset]);

  res.json({
    chats,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) || 1 }
  });
});

// ═══════════════ DASHBOARD ═══════════════
app.get('/api/dashboard', requireAuth, (req, res) => {
  const db = getDB();

  const todayCalls = db.get(`
    SELECT COUNT(*) as c FROM timeline WHERE type = 'call' AND date(created_at) = date('now')
  `).c;

  const todayOrders = db.get(`
    SELECT COUNT(*) as c FROM orders WHERE date(created_at) = date('now')
  `).c;

  const totalCustomers = db.get('SELECT COUNT(*) as c FROM customers').c;
  const orderedCustomers = db.get(`
    SELECT COUNT(*) as c FROM customers WHERE status IN ('confirmed', 'shipped')
  `).c;
  const convRate = totalCustomers > 0 ? Math.round((orderedCustomers / totalCustomers) * 100) : 0;

  const totalOrders = db.get('SELECT COUNT(*) as c FROM orders').c;

  const todayFollowups = db.all(`
    SELECT * FROM customers WHERE date(follow_up_date) = date('now')
  `);

  const overdueFollowups = db.all(`
    SELECT * FROM customers WHERE follow_up_date IS NOT NULL AND date(follow_up_date) < date('now')
  `);

  const hotLeads = db.all(`
    SELECT * FROM customers WHERE status = 'confirmed'
    AND last_contact IS NOT NULL
    AND julianday('now') - julianday(last_contact) < 3
    LIMIT 5
  `);

  const noContact = db.all(`
    SELECT * FROM customers WHERE status NOT IN ('shipped', 'rejected', 'duplicate')
    AND (last_contact IS NULL OR julianday('now') - julianday(last_contact) >= 3)
  `);

  res.json({ todayCalls, todayOrders, convRate, totalOrders, totalCustomers, todayFollowups, overdueFollowups, hotLeads, noContact });
});

// ═══════════════ PERFORMANCE (optimized) ═══════════════
app.get('/api/performance', requireAuth, (req, res) => {
  const db = getDB();
  const agents = db.all("SELECT id, name, avatar_initials, color FROM users WHERE role IN ('call_center','complaints','moderator') AND is_active = 1");

  const result = agents.map(agent => {
    const total = db.get('SELECT COUNT(*) as c FROM customers WHERE assigned_to = ?', [agent.id]).c;
    const calls = db.get("SELECT COUNT(*) as c FROM timeline WHERE user_id = ? AND type = 'call'", [agent.id]).c;
    const orders = db.get(`
      SELECT COUNT(*) as c FROM orders o JOIN customers c ON o.customer_id = c.id WHERE c.assigned_to = ?
    `, [agent.id]).c;
    const revenue = db.get(`
      SELECT COALESCE(SUM(o.total), 0) as r FROM orders o JOIN customers c ON o.customer_id = c.id WHERE c.assigned_to = ?
    `, [agent.id]).r;
    const converted = db.get(`
      SELECT COUNT(*) as c FROM customers WHERE assigned_to = ? AND status IN ('confirmed', 'shipped')
    `, [agent.id]).c;
    const conv = total > 0 ? Math.round((converted / total) * 100) : 0;
    const overdue = db.get(`
      SELECT COUNT(*) as c FROM customers WHERE assigned_to = ? AND follow_up_date IS NOT NULL AND date(follow_up_date) < date('now')
    `, [agent.id]).c;
    const score = (orders * 20) + (calls * 5) - (overdue * 10);

    return { ...agent, total, calls, orders, revenue, conv, overdue, score };
  }).sort((a, b) => b.score - a.score);

  res.json(result);
});

// ═══════════════ REPORTS (optimized) ═══════════════
app.get('/api/reports', requireAuth, (req, res) => {
  const db = getDB();

  const totalCustomers = db.get('SELECT COUNT(*) as c FROM customers').c;

  const bySource = db.all(`
    SELECT source, COUNT(*) as count,
    SUM(CASE WHEN status IN ('confirmed', 'shipped') THEN 1 ELSE 0 END) as orders
    FROM customers WHERE source != '' GROUP BY source ORDER BY count DESC
  `);

  const byRegion = db.all(`
    SELECT region, COUNT(*) as count FROM customers WHERE region != '' GROUP BY region ORDER BY count DESC
  `);

  const agents = db.all("SELECT id, name, color FROM users WHERE role IN ('call_center','complaints','moderator')");
  const convByAgent = agents.map(agent => {
    const stats = db.get(`
      SELECT COUNT(*) as total,
      SUM(CASE WHEN status IN ('confirmed', 'shipped') THEN 1 ELSE 0 END) as converted
      FROM customers WHERE assigned_to = ?
    `, [agent.id]);
    const rate = stats.total > 0 ? Math.round((stats.converted / stats.total) * 100) : 0;
    return { name: agent.name, color: agent.color, rate };
  }).sort((a, b) => b.rate - a.rate);

  res.json({ totalCustomers, bySource, byRegion, convByAgent });
});

// ═══════════════ SETTINGS / ADMIN ═══════════════
app.get('/api/users', requireAuth, (req, res) => {
  const db = getDB();
  const users = db.all('SELECT id, name, email, role, avatar_initials, color, is_active, permissions FROM users');
  res.json(users);
});

app.post('/api/users', requireAuth, requirePermission('users:manage'), (req, res) => {
  const db = getDB();
  const { name, email, password, role, avatarInitials, color } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });

  const existing = db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.status(409).json({ error: 'البريد مسجل مسبقاً' });

  const validRoles = ['moderator', 'call_center', 'complaints', 'supervisor', 'operations', 'admin', 'warehouse_manager', 'warehouse_supervisor', 'warehouse_worker'];
  const safeRole = validRoles.includes(role) ? role : 'call_center';

  const hash = bcrypt.hashSync(password, 10);
  const initials = avatarInitials || name.substring(0, 2);
  const result = db.run(`
    INSERT INTO users (name, email, password_hash, role, avatar_initials, color)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [name, email, hash, safeRole, initials, color || '#6366f1']);

  const user = db.get('SELECT id, name, email, role, avatar_initials, color FROM users WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(user);
});

app.put('/api/users/:id', requireAuth, requirePermission('users:manage'), (req, res) => {
  const db = getDB();
  const { name, email, role, password, permissions } = req.body;
  const id = req.params.id;
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });

  if (email && email !== user.email) {
    const existing = db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
    if (existing) return res.status(409).json({ error: 'البريد مسجل مسبقاً' });
  }

  db.run('UPDATE users SET name = ?, email = ?, role = ? WHERE id = ?', [
    name || user.name, email || user.email, role || user.role, id
  ]);

  if (permissions !== undefined) {
    const permsValue = Array.isArray(permissions) ? JSON.stringify(permissions) : null;
    db.run('UPDATE users SET permissions = ? WHERE id = ?', [permsValue, id]);
  }

  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
  }

  const initials = (name || user.name).substring(0, 2);
  db.run('UPDATE users SET avatar_initials = ? WHERE id = ?', [initials, id]);

  const updated = db.get('SELECT id, name, email, role, avatar_initials, color, is_active, permissions FROM users WHERE id = ?', [id]);
  res.json(updated);
});

app.patch('/api/users/:id/toggle', requireAuth, requirePermission('users:manage'), (req, res) => {
  const db = getDB();
  const id = req.params.id;
  if (String(id) === String(req.user.id)) return res.status(400).json({ error: 'لا يمكنك تعطيل حسابك' });
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const newStatus = user.is_active ? 0 : 1;
  db.run('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, id]);
  res.json({ id, is_active: newStatus });
});

app.get('/api/products', requireAuth, (req, res) => {
  const db = getDB();
  res.json(db.all('SELECT * FROM products WHERE is_active = 1 ORDER BY price ASC'));
});

app.post('/api/products', requireAuth, requirePermission('products:manage'), (req, res) => {
  const db = getDB();
  const { name, price } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'الاسم والسعر مطلوبين' });
  const result = db.run('INSERT INTO products (name, price) VALUES (?, ?)', [name, price]);
  res.status(201).json(db.get('SELECT * FROM products WHERE id = ?', [result.lastInsertRowid]));
});

app.put('/api/products/:id', requireAuth, requirePermission('products:manage'), (req, res) => {
  const db = getDB();
  const { name, price } = req.body;
  db.run('UPDATE products SET name = ?, price = ? WHERE id = ?', [name, price, req.params.id]);
  res.json(db.get('SELECT * FROM products WHERE id = ?', [req.params.id]));
});

app.delete('/api/products/:id', requireAuth, requirePermission('products:manage'), (req, res) => {
  const db = getDB();
  db.run('UPDATE products SET is_active = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/wa-templates', requireAuth, (req, res) => {
  const db = getDB();
  res.json(db.all('SELECT * FROM wa_templates ORDER BY id ASC'));
});

app.post('/api/wa-templates', requireAuth, requirePermission('templates:manage'), (req, res) => {
  const db = getDB();
  const { name, text } = req.body;
  if (!name || !text) return res.status(400).json({ error: 'الاسم والنص مطلوبين' });
  const result = db.run('INSERT INTO wa_templates (name, text) VALUES (?, ?)', [name, text]);
  res.status(201).json(db.get('SELECT * FROM wa_templates WHERE id = ?', [result.lastInsertRowid]));
});

app.put('/api/wa-templates/:id', requireAuth, requirePermission('templates:manage'), (req, res) => {
  const db = getDB();
  const { name, text } = req.body;
  db.run('UPDATE wa_templates SET name = ?, text = ? WHERE id = ?', [name, text, req.params.id]);
  res.json(db.get('SELECT * FROM wa_templates WHERE id = ?', [req.params.id]));
});

app.delete('/api/wa-templates/:id', requireAuth, requirePermission('templates:manage'), (req, res) => {
  const db = getDB();
  db.run('DELETE FROM wa_templates WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ═══════════════ PERMISSIONS API ═══════════════
app.get('/api/permissions', requireAuth, (req, res) => {
  res.json({ permissions: PERMISSIONS });
});

// ═══════════════ DELETE USER ═══════════════
app.delete('/api/users/:id', requireAuth, requirePermission('users:delete'), (req, res) => {
  const db = getDB();
  const id = parseInt(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'لا يمكنك حذف حسابك' });
  const user = db.get('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  // Unassign customers
  db.run('UPDATE customers SET assigned_to = NULL WHERE assigned_to = ?', [id]);
  // Delete user
  db.run('DELETE FROM users WHERE id = ?', [id]);
  res.json({ ok: true, message: 'تم حذف المستخدم نهائياً' });
});

// ═══════════════ COMPLAINTS ═══════════════
app.get('/api/complaints', requireAuth, requirePermission('complaints:manage'), (req, res) => {
  const db = getDB();
  const { status, page = 1, limit = 50 } = req.query;
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (pageNum - 1) * limitNum;

  let where = '';
  const params = [];
  if (status && status !== 'all') { where = ' WHERE co.status = ?'; params.push(status); }

  const total = db.get('SELECT COUNT(*) as c FROM complaints co' + where, params).c;

  const sql = `SELECT co.*, c.name as customer_name, c.phone as customer_phone
               FROM complaints co LEFT JOIN customers c ON co.customer_id = c.id` + where +
               ` ORDER BY co.created_at DESC LIMIT ? OFFSET ?`;

  const complaints = db.all(sql, [...params, limitNum, offset]);
  res.json({
    complaints,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
  });
});

app.post('/api/complaints', requireAuth, requirePermission('complaints:manage'), (req, res) => {
  const db = getDB();
  const b = req.body || {};
  // Accept both camelCase and snake_case keys from frontend
  const customerId = b.customerId || b.customer_id;
  const shipmentNumber = b.shipmentNumber || b.shipment_number;
  const complaintNumber = b.complaintNumber || b.complaint_number;
  const complaintType = b.complaintType || b.complaint_type;
  const feedback = b.feedback;
  const status = b.status;

  if (!complaintType) return res.status(400).json({ error: 'نوع الشكوى مطلوب' });

  const result = db.run(`
    INSERT INTO complaints (customer_id, shipment_number, complaint_number, complaint_type, feedback, status, created_by, created_by_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `, [customerId || null, shipmentNumber || '', complaintNumber || '', complaintType, feedback || '', status || 'open', req.user.id, req.user.name]);

  const complaint = db.get('SELECT * FROM complaints WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(complaint);
});

app.put('/api/complaints/:id', requireAuth, requirePermission('complaints:manage'), (req, res) => {
  const db = getDB();
  const b = req.body || {};
  const shipmentNumber = b.shipmentNumber || b.shipment_number;
  const complaintNumber = b.complaintNumber || b.complaint_number;
  const complaintType = b.complaintType || b.complaint_type;
  const feedback = b.feedback;
  const status = b.status;
  const id = req.params.id;
  const existing = db.get('SELECT * FROM complaints WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'الشكوى غير موجودة' });

  db.run(`UPDATE complaints SET shipment_number = ?, complaint_number = ?, complaint_type = ?, feedback = ?, status = ? WHERE id = ?`,
    [shipmentNumber || existing.shipment_number, complaintNumber || existing.complaint_number,
     complaintType || existing.complaint_type, feedback !== undefined ? feedback : existing.feedback,
     status || existing.status, id]);

  const updated = db.get('SELECT * FROM complaints WHERE id = ?', [id]);
  res.json(updated);
});

app.delete('/api/complaints/:id', requireAuth, requirePermission('complaints:manage'), (req, res) => {
  const db = getDB();
  const id = req.params.id;
  const existing = db.get('SELECT * FROM complaints WHERE id = ?', [id]);
  if (!existing) return res.status(404).json({ error: 'الشكوى غير موجودة' });
  db.run('DELETE FROM complaints WHERE id = ?', [id]);
  res.json({ ok: true });
});

// ═══════════════ MODERATOR ORDER ═══════════════
app.post('/api/moderator-orders', requireAuth, requirePermission('orders:create'), (req, res) => {
  const db = getDB();
  const b = req.body || {};
  const customerName = b.customerName || b.customer_name || b.name;
  const phone = b.phone || b.customer_phone;
  const phone2 = b.phone2 || b.customer_phone2;
  const address = b.address || b.customer_address;
  const moderatorCode = b.moderatorCode || b.moderator_code;
  const moderatorName = b.moderatorName || b.moderator_name;
  const instapayImage = b.instapayImage || b.instapay_image;

  // Accept either { items: [{product_id, product_name, qty, price}, ...] } or legacy single
  const items = Array.isArray(b.items) && b.items.length ? b.items : [{
    product_id: b.productId || b.product_id || 0,
    product_name: b.productName || b.product_name,
    qty: b.qty,
    price: b.price,
  }];

  if (!customerName || !phone) {
    return res.status(400).json({ error: 'اسم العميل والهاتف مطلوبين' });
  }
  if (!items[0].product_name || !items[0].price) {
    return res.status(400).json({ error: 'منتج واحد على الأقل بسعر مطلوب' });
  }

  const normalized = normalizePhone(phone);

  // Find or create customer
  let customer = db.get('SELECT * FROM customers WHERE phone = ?', [normalized]);
  if (!customer) {
    const custResult = db.run(`
      INSERT INTO customers (name, phone, phone2, address, source, status, assigned_to, last_contact, created_at)
      VALUES (?, ?, ?, ?, 'مودوريتور', 'confirmed', ?, datetime('now'), datetime('now'))
    `, [customerName, normalized, normalizePhone(phone2) || '', address || '', req.user.id]);
    customer = db.get('SELECT * FROM customers WHERE id = ?', [custResult.lastInsertRowid]);
    db.run(`INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
      VALUES (?, 'created', 'تم إضافة العميل من فورم المودوريتور', '📋', ?, ?, datetime('now'))`,
      [customer.id, req.user.name, req.user.id]);
  }

  // Create one order row per item
  const created = [];
  const labels = [];
  let grand = 0;
  for (const it of items) {
    const q = parseInt(it.qty) || 1;
    const p = parseFloat(it.price) || 0;
    const total = p * q;
    grand += total;
    const r = db.run(`
      INSERT INTO orders (customer_id, product_id, product_name, qty, price, total, status, address, moderator_code, moderator_name, instapay_image, created_by, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'جديد', ?, ?, ?, ?, ?, 'moderator', datetime('now'))
    `, [customer.id, parseInt(it.product_id) || 0, it.product_name, q, p, total, address || '', moderatorCode || '', moderatorName || req.user.name, instapayImage || '', req.user.id]);
    created.push(db.get('SELECT * FROM orders WHERE id = ?', [r.lastInsertRowid]));
    labels.push(`${it.product_name} × ${q}`);
  }

  db.run(`INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
    VALUES (?, 'order', ?, '🛍️', ?, ?, datetime('now'))`,
    [customer.id, `طلب مودوريتور: ${labels.join(' • ')} — إجمالي ${grand} جنيه`, req.user.name, req.user.id]);

  res.status(201).json({ orders: created, customer, total: grand });
});

// ═══════════════ ONLINE USERS TRACKING ═══════════════
const onlineUsers = new Map(); // userId → Set<socketId>

function getOnlineUsersList() {
  const db = getDB();
  const userIds = [...onlineUsers.keys()];
  if (userIds.length === 0) return [];
  const placeholders = userIds.map(() => '?').join(',');
  return db.all(`SELECT id, name, avatar_initials, color, role FROM users WHERE id IN (${placeholders}) AND is_active = 1`, userIds);
}

// ═══════════════ STAFF CHAT API ═══════════════
app.get('/api/staff-chat/conversations', requireAuth, (req, res) => {
  const db = getDB();
  const me = req.user.id;
  const users = db.all('SELECT id, name, avatar_initials, color, role FROM users WHERE is_active = 1 AND id != ?', [me]);

  const conversations = users.map(u => {
    const lastMsg = db.get(
      `SELECT text, created_at, from_user_id FROM staff_messages
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
       ORDER BY created_at DESC LIMIT 1`,
      [me, u.id, u.id, me]
    );
    const unreadRow = db.get(
      'SELECT COUNT(*) as cnt FROM staff_messages WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0',
      [u.id, me]
    );
    return {
      user: u,
      lastMessage: lastMsg ? lastMsg.text : '',
      lastMessageAt: lastMsg ? lastMsg.created_at : '',
      lastMessageFromMe: lastMsg ? lastMsg.from_user_id === me : false,
      unread: unreadRow ? unreadRow.cnt : 0,
      online: onlineUsers.has(u.id)
    };
  });

  // Sort: has messages first (by last message time desc), then no messages
  conversations.sort((a, b) => {
    if (a.lastMessageAt && !b.lastMessageAt) return -1;
    if (!a.lastMessageAt && b.lastMessageAt) return 1;
    if (a.lastMessageAt && b.lastMessageAt) return b.lastMessageAt.localeCompare(a.lastMessageAt);
    return a.user.name.localeCompare(b.user.name);
  });

  res.json(conversations);
});

app.get('/api/staff-chat/messages/:userId', requireAuth, (req, res) => {
  const db = getDB();
  const me = req.user.id;
  const other = parseInt(req.params.userId);
  if (!other) return res.status(400).json({ error: 'معرف المستخدم غير صحيح' });

  const messages = db.all(
    `SELECT * FROM staff_messages
     WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
     ORDER BY created_at ASC`,
    [me, other, other, me]
  );

  // Mark messages from other as read
  db.run('UPDATE staff_messages SET is_read = 1 WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0', [other, me]);

  res.json(messages);
});

app.get('/api/staff-chat/unread-count', requireAuth, (req, res) => {
  const db = getDB();
  const row = db.get('SELECT COUNT(*) as cnt FROM staff_messages WHERE to_user_id = ? AND is_read = 0', [req.user.id]);
  res.json({ count: row ? row.cnt : 0 });
});

// ═══════════════ DATABASE BACKUP / RESTORE ═══════════════
app.get('/api/backup', requireAuth, requirePermission('users:manage'), (req, res) => {
  const db = getDB();
  db.saveDB();
  const dbPath = path.join(__dirname, 'data', 'olive-crm.db');
  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: 'ملف الداتابيز غير موجود' });
  }
  const date = new Date().toISOString().slice(0, 10);
  res.download(dbPath, `olive-crm-backup-${date}.db`);
});

app.post('/api/restore', requireAuth, requirePermission('users:manage'), express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
  try {
    if (!req.body || req.body.length < 100) {
      return res.status(400).json({ error: 'ملف الداتابيز غير صحيح' });
    }
    const dbPath = path.join(__dirname, 'data', 'olive-crm.db');
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    // Save backup of current DB first
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, dbPath + '.bak');
    }

    // Write uploaded DB
    fs.writeFileSync(dbPath, req.body);
    res.json({ success: true, message: 'تم استعادة الداتابيز. أعد تشغيل السيرفر لتفعيل التغييرات.' });
  } catch (e) {
    console.error('Restore error:', e);
    res.status(500).json({ error: 'فشل استعادة الداتابيز: ' + e.message });
  }
});

// ═══════════════ GLOBAL ERROR HANDLER ═══════════════
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'حدث خطأ في السيرفر' });
});

// ═══════════════ SOCKET.IO ═══════════════
io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  const status = getStatus();
  if (status.connected) {
    socket.emit('whatsapp:ready', { phoneNumber: status.phoneNumber });
  } else if (status.qrCode) {
    socket.emit('whatsapp:qr', { qrDataUrl: status.qrCode });
  }

  // ── User identity + online presence ──
  socket.on('user:identify', (data) => {
    try {
      const decoded = jwt.verify(data.token, JWT_SECRET);
      const userId = decoded.userId;
      socket.userId = userId;

      if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
      }
      onlineUsers.get(userId).add(socket.id);

      // Broadcast updated online list to all
      io.emit('users:online', getOnlineUsersList());
      console.log(`👤 User #${userId} online (${onlineUsers.get(userId).size} tabs)`);
    } catch (e) {
      console.log('Socket auth failed:', e.message);
    }
  });

  // ── Staff chat: send message ──
  socket.on('staff:message', (data) => {
    if (!socket.userId) return;
    const { toUserId, text } = data;
    if (!toUserId || !text || !text.trim()) return;

    const db = getDB();
    const result = db.run(
      'INSERT INTO staff_messages (from_user_id, to_user_id, text) VALUES (?, ?, ?)',
      [socket.userId, toUserId, text.trim()]
    );

    const msg = db.get('SELECT * FROM staff_messages WHERE id = ?', [result.lastInsertRowid]);
    if (!msg) return;

    // Send to sender's sockets
    const senderSockets = onlineUsers.get(socket.userId);
    if (senderSockets) {
      for (const sid of senderSockets) {
        io.to(sid).emit('staff:message:new', msg);
      }
    }

    // Send to recipient's sockets
    const recipientSockets = onlineUsers.get(toUserId);
    if (recipientSockets) {
      for (const sid of recipientSockets) {
        io.to(sid).emit('staff:message:new', msg);
      }
    }
  });

  // ── Staff chat: mark messages as read ──
  socket.on('staff:messages:read', (data) => {
    if (!socket.userId) return;
    const { fromUserId } = data;
    if (!fromUserId) return;

    const db = getDB();
    db.run('UPDATE staff_messages SET is_read = 1 WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0',
      [fromUserId, socket.userId]);
  });

  // ── Disconnect: remove from online tracking ──
  socket.on('disconnect', () => {
    console.log('🔌 Client disconnected:', socket.id);
    if (socket.userId) {
      const sockets = onlineUsers.get(socket.userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(socket.userId);
        }
      }
      io.emit('users:online', getOnlineUsersList());
    }
  });
});

// ═══════════════ PUBLIC INTEGRATIONS (CORS-enabled webhook) ═══════════════
// Accepts new orders from external websites/landing pages.
// Authenticate by X-API-Key header or apiKey query/body field.
// Set INTEGRATION_API_KEY in .env to enable.

function requireApiKey(req, res, next) {
  const expected = process.env.INTEGRATION_API_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'INTEGRATION_API_KEY غير معرّف على السيرفر' });
  }
  const provided =
    req.headers['x-api-key'] ||
    req.query.apiKey ||
    (req.body && req.body.apiKey);
  if (!provided || provided !== expected) {
    return res.status(401).json({ error: 'API key غير صحيح' });
  }
  next();
}

app.get('/api/integrations/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.post('/api/integrations/orders', requireApiKey, (req, res) => {
  try {
    const db = getDB();
    const b = req.body || {};

    // ─── Required customer fields ───
    const name = (b.name || b.customerName || b.customer_name || '').trim();
    const phoneRaw = (b.phone || b.customerPhone || b.customer_phone || '').trim();
    if (!name || !phoneRaw) {
      return res.status(400).json({ error: 'name و phone مطلوبين' });
    }
    const phone = normalizePhone(phoneRaw);

    // ─── Optional fields ───
    const region   = (b.region || b.governorate || '').trim();
    const address  = (b.address || '').trim();
    const source   = (b.source || 'موقع خارجي').trim();
    const notes    = (b.notes || '').trim();

    // ─── Order fields (optional) ───
    const productName = (b.productName || b.product_name || b.product || '').trim();
    const qty   = parseInt(b.qty || b.quantity || 1, 10) || 1;
    const price = parseFloat(b.price || 0) || 0;
    const total = parseFloat(b.total || (price * qty)) || 0;

    // ─── Find or create customer ───
    let customer = db.get('SELECT id FROM customers WHERE phone = ?', [phone]);
    let customerId;
    if (customer) {
      customerId = customer.id;
      // update region/address if newly provided
      if (region || address) {
        db.run(`UPDATE customers SET region = COALESCE(NULLIF(?, ''), region), address = COALESCE(NULLIF(?, ''), address) WHERE id = ?`, [region, address, customerId]);
      }
    } else {
      const result = db.run(`
        INSERT INTO customers (name, phone, region, address, source, notes, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'first_attempt', datetime('now'))
      `, [name, phone, region, address, source, notes]);
      customerId = result.lastInsertRowid;
    }

    // ─── Create order if product info provided ───
    let orderId = null;
    if (productName) {
      const orderResult = db.run(`
        INSERT INTO orders (customer_id, product_id, product_name, qty, price, total, status, address, source, created_at)
        VALUES (?, 0, ?, ?, ?, ?, 'جديد', ?, 'website', datetime('now'))
      `, [customerId, productName, qty, price, total, address]);
      orderId = orderResult.lastInsertRowid;

      db.run(`
        INSERT INTO timeline (customer_id, type, text, icon, user_name, created_at)
        VALUES (?, 'order', ?, '🌐', 'الموقع الإلكتروني', datetime('now'))
      `, [customerId, `طلب جديد من الموقع: ${productName} × ${qty} — ${total} جنيه`]);
    }

    // ─── Notify connected CRM users via socket ───
    try {
      io.emit('integration:new_order', {
        customerId, orderId, name, phone, productName, total, source,
      });
    } catch (_) {}

    res.status(201).json({
      ok: true,
      customerId,
      orderId,
      message: orderId ? 'تم إنشاء العميل والطلب' : 'تم إنشاء العميل',
    });
  } catch (err) {
    console.error('Integration order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════ J&T EXPRESS EGYPT ═══════════════
app.get('/api/jt/status', requireAuth, (req, res) => {
  res.json({ configured: jt.isConfigured() });
});

// Ship a CRM order via J&T (creates the waybill)
app.post('/api/jt/ship/:orderId', requireAuth, requirePermission('orders:manage'), async (req, res) => {
  try {
    const db = getDB();
    const orderId = parseInt(req.params.orderId, 10);
    const order = db.get(`
      SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.region, c.address as customer_address
      FROM orders o JOIN customers c ON o.customer_id = c.id WHERE o.id = ?`, [orderId]);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (order.jt_waybill_no) {
      return res.status(409).json({ error: 'الطلب تم شحنه مسبقاً', waybill: order.jt_waybill_no });
    }

    const sender = jt.defaultSender();
    const body = {
      ...sender,
      receiverName: order.customer_name,
      receiverPhone: order.customer_phone,
      receiverProvince: order.region || '',
      receiverCity: order.region || '',
      receiverArea: '',
      receiverStreet: order.address || order.customer_address || '',
      customerOrderId: String(order.id),
      itemName: order.product_name,
      itemType: req.body.itemType || 'PARCEL',
      weight: parseFloat(req.body.weight) || 1.0,
      itemValue: order.total,
      totalCod: req.body.totalCod !== undefined ? req.body.totalCod : order.total,
      remarkInfo: req.body.remarkInfo || `كمية: ${order.qty}`,
    };

    const result = await jt.saveOrder(body);
    const waybill = result?.data?.waybillNo || result?.data?.waybillId || result?.waybillNo || result?.data?.[0]?.waybillNo || '';

    db.run(
      `UPDATE orders SET jt_waybill_no = ?, jt_status = ?, jt_last_sync = datetime('now') WHERE id = ?`,
      [waybill, 'created', orderId]
    );
    res.json({ ok: true, waybill, raw: result });
  } catch (err) {
    console.error('JT ship error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Track a waybill (live from J&T)
app.get('/api/jt/track/:waybill', requireAuth, async (req, res) => {
  try {
    const data = await jt.trackByWaybillNo([req.params.waybill]);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List local CRM orders that have been shipped via J&T
app.get('/api/jt/orders', requireAuth, (req, res) => {
  const db = getDB();
  const rows = db.all(`
    SELECT o.id, o.product_name, o.qty, o.total, o.status, o.address, o.created_at,
           o.jt_waybill_no, o.jt_status, o.jt_last_sync,
           c.name AS customer_name, c.phone AS customer_phone, c.region
    FROM orders o JOIN customers c ON o.customer_id = c.id
    WHERE o.jt_waybill_no IS NOT NULL AND o.jt_waybill_no != ''
    ORDER BY o.id DESC LIMIT 500`);
  res.json(rows);
});

// Refresh tracking for one waybill — saves latest status + raw JSON
app.post('/api/jt/sync/:orderId', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const orderId = parseInt(req.params.orderId, 10);
    const order = db.get(`SELECT id, jt_waybill_no FROM orders WHERE id = ?`, [orderId]);
    if (!order || !order.jt_waybill_no) return res.status(404).json({ error: 'هذا الطلب غير مشحون عبر J&T' });
    const data = await jt.trackByWaybillNo([order.jt_waybill_no]);
    const tracks = data?.data?.[0]?.details || data?.data?.[0]?.tracks || [];
    const latest = tracks[0]?.scanType || tracks[0]?.statusName || data?.data?.[0]?.statusName || 'updated';
    db.run(
      `UPDATE orders SET jt_status = ?, jt_last_sync = datetime('now'), jt_tracking_json = ? WHERE id = ?`,
      [String(latest), JSON.stringify(data), orderId]
    );
    res.json({ ok: true, status: latest, raw: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Complaint types (J&T firstType list)
app.get('/api/jt/complaint-types', requireAuth, async (req, res) => {
  try {
    const data = await jt.workOrderFirstTypes();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create complaint on J&T (and optionally link to a local complaint row)
app.post('/api/jt/complaint', requireAuth, requirePermission('complaints:manage'), async (req, res) => {
  try {
    const { waybillNo, firstTypeId, secondTypeId, description, customerOrderId, localComplaintId } = req.body;
    if (!waybillNo) return res.status(400).json({ error: 'waybillNo مطلوب' });
    const data = await jt.workOrderSave({ waybillNo, firstTypeId, secondTypeId, description, customerOrderId });
    const workOrderNo = data?.data?.workOrderNo || data?.workOrderNo || '';
    if (localComplaintId) {
      const db = getDB();
      db.run(`UPDATE complaints SET jt_work_order_no = ? WHERE id = ?`, [workOrderNo, localComplaintId]);
    }
    res.json({ ok: true, workOrderNo, raw: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════ START ═══════════════
const PORT = process.env.PORT || 3000;

async function start() {
  await initDB();
  console.log('✅ Database initialized');

  initWhatsApp(io).catch(err => {
    console.error('WhatsApp init error:', err);
  });

  server.listen(PORT, () => {
    console.log(`\n🫒 Olive CRM running at http://localhost:${PORT}`);
    console.log('📧 Login: admin@crm.com / 123\n');
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

// ═══════════════ GRACEFUL SHUTDOWN ═══════════════
function shutdown() {
  console.log('\n🛑 Shutting down...');
  const db = getDB();
  db.saveDB();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  const db = getDB();
  db.saveDB();
});
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
