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
const crypto = require('crypto');
const multer = require('multer');
const pickup = require('./pickup');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// ═══════════════ CONSTANTS ═══════════════
const VALID_STATUSES = ['new', 'first_attempt', 'second_attempt', 'third_attempt', 'confirmed', 'rejected', 'waiting_transfer', 'postponed', 'shipped', 'duplicate'];

// ═══════════════ SERVER SETUP ═══════════════
const app = express();

// ✅ مهم على Render/Proxy عشان req.ip يبقى IP الحقيقي
app.set('trust proxy', 1);
const server = http.createServer(app);
const io = new Server(server);

// Shopify webhook needs the RAW body to verify HMAC — register BEFORE express.json
app.use('/api/shopify/webhook', express.raw({ type: '*/*', limit: '5mb' }));
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
// Round-robin pointer for fair distribution among call center users.
// Persists across requests via the DB so it survives server restarts.
function pickNextCallCenterAgent() {
  const db = getDB();
  // Get active call_center agents ordered by ID
  const agents = db.all(`SELECT id FROM users WHERE role = 'call_center' AND is_active = 1 ORDER BY id`);
  if (!agents.length) return null;

  // Find the agent who currently has the FEWEST customers — fair distribution
  // (Equal-split: ties broken by lowest agent ID so the same agent always
  //  gets the 'extra' first, but next one balances it.)
  const counts = db.all(`
    SELECT u.id, COALESCE(c.cnt, 0) AS cnt
    FROM users u
    LEFT JOIN (SELECT assigned_to, COUNT(*) AS cnt FROM customers WHERE assigned_to IS NOT NULL GROUP BY assigned_to) c
      ON c.assigned_to = u.id
    WHERE u.role = 'call_center' AND u.is_active = 1
    ORDER BY cnt ASC, u.id ASC
  `);
  return counts[0]?.id || agents[0].id;
}

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

  // If no explicit assignee, auto-balance to next least-loaded call center agent
  const resolvedAssignee = assignedTo
    || (req.user.role === 'call_center' ? req.user.id : pickNextCallCenterAgent())
    || req.user.id;
  const result = db.run(`
    INSERT INTO customers (name, phone, phone2, region, source, assigned_to, notes, address, status, last_contact, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'), datetime('now'))
  `, [name, normalized, normalizePhone(phone2) || '', region || '', source || '', resolvedAssignee, notes || '', address || '']);

  // Add timeline entry
  db.run(`
    INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
    VALUES (?, 'created', 'تم إضافة العميل', '➕', ?, ?, datetime('now'))
  `, [result.lastInsertRowid, req.user.name, req.user.id]);

  const customer = db.get('SELECT * FROM customers WHERE id = ?', [result.lastInsertRowid]);
  res.status(201).json(customer);
});

// ═══════════════ REDISTRIBUTE: balance customers across call center agents ═══════════════
app.post('/api/customers/redistribute', requireAuth, requirePermission('users:manage'), (req, res) => {
  const db = getDB();
  const onlyUnassigned = !!req.body.onlyUnassigned;
  const onlyStatuses = Array.isArray(req.body.statuses) && req.body.statuses.length
    ? req.body.statuses
    : ['first_attempt', 'second_attempt', 'third_attempt']; // never reshuffle confirmed/shipped

  const agents = db.all(`SELECT id FROM users WHERE role = 'call_center' AND is_active = 1 ORDER BY id`);
  if (!agents.length) return res.status(400).json({ error: 'لا يوجد موظفين كول سنتر نشطين' });

  const placeholders = onlyStatuses.map(() => '?').join(',');
  const whereExtra = onlyUnassigned ? 'AND assigned_to IS NULL' : '';
  const customers = db.all(
    `SELECT id FROM customers WHERE status IN (${placeholders}) ${whereExtra} ORDER BY id`,
    onlyStatuses
  );
  if (!customers.length) return res.json({ updated: 0, message: 'مفيش عملاء يحتاجوا توزيع' });

  // Round-robin distribute equally; the 'extra' (odd count) goes to the first agent
  let updated = 0;
  customers.forEach((c, i) => {
    const target = agents[i % agents.length].id;
    db.run('UPDATE customers SET assigned_to = ? WHERE id = ?', [target, c.id]);
    updated++;
  });

  res.json({
    updated,
    agentsCount: agents.length,
    perAgent: Math.floor(customers.length / agents.length),
    extras: customers.length % agents.length,
    message: `تم توزيع ${updated} عميل على ${agents.length} موظف كول سنتر`,
  });
});

// ═══════════════ BULK ACTIONS ═══════════════
app.post('/api/customers/bulk-status', requireAuth, requirePermission('customers:manage'), (req, res) => {
  const db = getDB();
  const { ids, status, assignedTo } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids مطلوبة' });
  if (!status && !assignedTo) return res.status(400).json({ error: 'حدد حالة أو موظف' });
  if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'حالة غير صالحة' });

  const placeholders = ids.map(() => '?').join(',');
  // Ownership: limited roles can only update their own customers
  let where = `id IN (${placeholders})`;
  const params = [...ids];
  if (['moderator', 'call_center'].includes(req.user.role)) {
    where += ' AND assigned_to = ?';
    params.push(req.user.id);
  }

  const updates = [];
  if (status) updates.push('status = ?');
  if (assignedTo) updates.push('assigned_to = ?');
  updates.push("last_contact = datetime('now')");
  updates.push("updated_at = datetime('now')");
  updates.push(`updated_by = ${req.user.id}`);
  updates.push(`updated_by_name = ?`);

  const sqlParams = [];
  if (status) sqlParams.push(status);
  if (assignedTo) sqlParams.push(assignedTo);
  sqlParams.push(req.user.name);

  const sql = `UPDATE customers SET ${updates.join(', ')} WHERE ${where}`;
  db.run(sql, [...sqlParams, ...params]);

  // Get affected count
  const affected = db.get(`SELECT COUNT(*) as c FROM customers WHERE ${where}`, params).c;

  // Timeline entries
  const label = status ? `تغيير الحالة إلى: ${status}` : `تغيير الموظف`;
  ids.forEach(id => {
    try {
      db.run(`INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
        VALUES (?, 'bulk', ?, '📋', ?, ?, datetime('now'))`,
        [id, `إجراء جماعي: ${label}`, req.user.name, req.user.id]);
    } catch(_) {}
  });

  res.json({ updated: affected, message: `تم تحديث ${affected} عميل` });
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

  const items = Array.isArray(req.body.items) && req.body.items.length
    ? req.body.items
    : [{ productId: req.body.productId, qty: req.body.qty }];
  const address = req.body.address || customer.region;

  // Resolve all items first + compute totals
  const resolved = [];
  let grandTotal = 0;
  let totalQty = 0;
  for (const it of items) {
    const product = db.get('SELECT * FROM products WHERE id = ?', [it.productId]);
    if (!product) return res.status(400).json({ error: `المنتج ID ${it.productId} غير موجود` });
    const q = parseInt(it.qty) || 1;
    const total = product.price * q;
    grandTotal += total;
    totalQty += q;
    resolved.push({ productId: product.id, productName: product.name, qty: q, price: product.price, total });
  }

  // Insert as ONE order row. items_json holds the full breakdown.
  const first = resolved[0];
  const productNameSummary = resolved.length === 1
    ? first.productName
    : `${first.productName} +${resolved.length - 1} منتجات`;
  const itemsJson = resolved.length > 1 ? JSON.stringify(resolved) : '';

  const result = db.run(`
    INSERT INTO orders (customer_id, product_id, product_name, qty, price, total, status, address, source, items_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'جديد', ?, 'manual', ?, datetime('now'))
  `, [customerId, first.productId, productNameSummary, totalQty, first.price, grandTotal, address, itemsJson]);

  const order = db.get('SELECT * FROM orders WHERE id = ?', [result.lastInsertRowid]);

  // Don't auto-change customer status — agent must take the action explicitly.
  // Only refresh last_contact so the "آخر تواصل" badge updates.
  db.run('UPDATE customers SET last_contact = datetime("now") WHERE id = ?', [customerId]);
  const tlLabels = resolved.map(r => `${r.productName} × ${r.qty}`).join(' • ');
  db.run(`
    INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
    VALUES (?, 'order', ?, '🛍️', ?, ?, datetime('now'))
  `, [customerId, `طلب جديد: ${tlLabels} — إجمالي ${grandTotal} جنيه`, req.user.name, req.user.id]);

  io.emit('customer:updated', { customer: db.get('SELECT * FROM customers WHERE id = ?', [customerId]) });
  res.status(201).json(order);
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

  // Find or create customer (default to 'new' — no auto-action)
  let customer = db.get('SELECT * FROM customers WHERE phone = ?', [normalized]);
  if (!customer) {
    const custResult = db.run(`
      INSERT INTO customers (name, phone, phone2, address, source, status, assigned_to, last_contact, created_at)
      VALUES (?, ?, ?, ?, 'مودوريتور', 'new', ?, datetime('now'), datetime('now'))
    `, [customerName, normalized, normalizePhone(phone2) || '', address || '', req.user.id]);
    customer = db.get('SELECT * FROM customers WHERE id = ?', [custResult.lastInsertRowid]);
    db.run(`INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
      VALUES (?, 'created', 'تم إضافة العميل من فورم المودوريتور', '📋', ?, ?, datetime('now'))`,
      [customer.id, req.user.name, req.user.id]);
  }

  // Compute items + totals
  const resolved = [];
  let grand = 0;
  let totalQty = 0;
  for (const it of items) {
    const q = parseInt(it.qty) || 1;
    const p = parseFloat(it.price) || 0;
    const t = p * q;
    grand += t;
    totalQty += q;
    resolved.push({
      productId: parseInt(it.product_id) || 0,
      productName: it.product_name,
      qty: q,
      price: p,
      total: t,
    });
  }

  // Insert as ONE order row with items_json
  const first = resolved[0];
  const productNameSummary = resolved.length === 1
    ? first.productName
    : `${first.productName} +${resolved.length - 1} منتجات`;
  const itemsJson = resolved.length > 1 ? JSON.stringify(resolved) : '';

  const r = db.run(`
    INSERT INTO orders (customer_id, product_id, product_name, qty, price, total, status, address, moderator_code, moderator_name, instapay_image, created_by, source, items_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'جديد', ?, ?, ?, ?, ?, 'moderator', ?, datetime('now'))
  `, [customer.id, first.productId, productNameSummary, totalQty, first.price, grand, address || '', moderatorCode || '', moderatorName || req.user.name, instapayImage || '', req.user.id, itemsJson]);

  const order = db.get('SELECT * FROM orders WHERE id = ?', [r.lastInsertRowid]);

  const tlLabels = resolved.map(it => `${it.productName} × ${it.qty}`).join(' • ');
  db.run(`INSERT INTO timeline (customer_id, type, text, icon, user_name, user_id, created_at)
    VALUES (?, 'order', ?, '🛍️', ?, ?, datetime('now'))`,
    [customer.id, `طلب مودوريتور: ${tlLabels} — إجمالي ${grand} جنيه`, req.user.name, req.user.id]);

  res.status(201).json({ order, customer });
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

    // ─── Order fields ───
    // Accept either:
    //   items: [{productName, qty, price}, ...]  (multi-product)
    //   OR legacy single: productName, qty, price
    let items = [];
    if (Array.isArray(b.items) && b.items.length) {
      items = b.items.map(it => ({
        productName: (it.productName || it.product_name || it.product || '').trim(),
        qty: parseInt(it.qty || it.quantity || 1, 10) || 1,
        price: parseFloat(it.price || 0) || 0,
      })).filter(it => it.productName);
    } else {
      const singleName = (b.productName || b.product_name || b.product || '').trim();
      if (singleName) {
        items = [{
          productName: singleName,
          qty: parseInt(b.qty || b.quantity || 1, 10) || 1,
          price: parseFloat(b.price || 0) || 0,
        }];
      }
    }

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
      // Auto-assign to next call center agent (round-robin / least-loaded)
      const assignedTo = pickNextCallCenterAgent();
      const result = db.run(`
        INSERT INTO customers (name, phone, region, address, source, notes, status, assigned_to, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'new', ?, datetime('now'))
      `, [name, phone, region, address, source, notes, assignedTo]);
      customerId = result.lastInsertRowid;
    }

    // ─── Build resolved items ───
    let orderId = null;
    let merged = false;
    if (items.length) {
      const newItems = items.map(it => ({
        productId: 0,
        productName: it.productName,
        qty: it.qty,
        price: it.price,
        total: it.price * it.qty,
      }));

      // Auto-merge: only within the SAME checkout session (2 minutes).
      // Orders posted at different times become separate orders (new profile/
      // order entry) — even from the same phone.
      const MERGE_WINDOW_MIN = 2;
      const recent = db.get(`
        SELECT * FROM orders
        WHERE customer_id = ?
          AND source = 'website'
          AND status = 'جديد'
          AND created_at >= datetime('now', '-${MERGE_WINDOW_MIN} minutes')
        ORDER BY id DESC LIMIT 1
      `, [customerId]);

      if (recent) {
        // Parse existing items (fall back to legacy single-row)
        let existingItems = [];
        if (recent.items_json) {
          try { existingItems = JSON.parse(recent.items_json) || []; } catch (_) {}
        }
        if (!existingItems.length) {
          existingItems = [{
            productId: recent.product_id || 0,
            productName: recent.product_name,
            qty: recent.qty,
            price: recent.price,
            total: recent.total,
          }];
        }
        const allItems = [...existingItems, ...newItems];
        const grand = allItems.reduce((s, it) => s + it.total, 0);
        const totalQty = allItems.reduce((s, it) => s + it.qty, 0);
        const first = allItems[0];
        const productNameSummary = allItems.length === 1
          ? first.productName
          : `${first.productName} +${allItems.length - 1} منتجات`;

        db.run(`
          UPDATE orders SET product_name = ?, qty = ?, price = ?, total = ?, items_json = ?
          WHERE id = ?
        `, [productNameSummary, totalQty, first.price, grand, JSON.stringify(allItems), recent.id]);

        orderId = recent.id;
        merged = true;

        const tlLabels = newItems.map(it => `${it.productName} × ${it.qty}`).join(' • ');
        db.run(`
          INSERT INTO timeline (customer_id, type, text, icon, user_name, created_at)
          VALUES (?, 'order', ?, '🌐', 'الموقع الإلكتروني', datetime('now'))
        `, [customerId, `إضافة لطلب موجود: ${tlLabels} — إجمالي جديد ${grand} جنيه`]);
      } else {
        // Fresh order
        const grand = newItems.reduce((s, it) => s + it.total, 0);
        const totalQty = newItems.reduce((s, it) => s + it.qty, 0);
        const first = newItems[0];
        const productNameSummary = newItems.length === 1
          ? first.productName
          : `${first.productName} +${newItems.length - 1} منتجات`;
        const itemsJson = newItems.length > 1 ? JSON.stringify(newItems) : '';

        const orderResult = db.run(`
          INSERT INTO orders (customer_id, product_id, product_name, qty, price, total, status, address, source, items_json, created_at)
          VALUES (?, 0, ?, ?, ?, ?, 'جديد', ?, 'website', ?, datetime('now'))
        `, [customerId, productNameSummary, totalQty, first.price, grand, address, itemsJson]);
        orderId = orderResult.lastInsertRowid;

        const tlLabels = newItems.map(it => `${it.productName} × ${it.qty}`).join(' • ');
        db.run(`
          INSERT INTO timeline (customer_id, type, text, icon, user_name, created_at)
          VALUES (?, 'order', ?, '🌐', 'الموقع الإلكتروني', datetime('now'))
        `, [customerId, `طلب جديد من الموقع: ${tlLabels} — إجمالي ${grand} جنيه`]);
      }
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
      merged,
      message: !orderId ? 'تم إنشاء العميل'
        : merged ? 'تم إضافة المنتج لطلب موجود'
        : 'تم إنشاء العميل والطلب',
    });
  } catch (err) {
    console.error('Integration order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════ SHOPIFY ADMIN API (webhook auto-registration) ═══════════════
// Config (set on Render → Environment):
//   SHOPIFY_SHOP_DOMAIN     e.g. ziwi-olive-oil.myshopify.com
//   SHOPIFY_ADMIN_TOKEN     e.g. shpss_xxx (Admin API access token)
//   SHOPIFY_API_VERSION     optional, defaults to 2026-04
//   SHOPIFY_WEBHOOK_TARGET  optional, defaults to https://olive-crm.onrender.com/api/shopify/webhook/orders

function shopifyAdmin(path, options = {}) {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  const version = process.env.SHOPIFY_API_VERSION || '2026-04';
  if (!domain || !token) {
    return Promise.reject(new Error('SHOPIFY_SHOP_DOMAIN و SHOPIFY_ADMIN_TOKEN لازم يكونوا متعرّفين في Environment'));
  }
  const url = `https://${domain}/admin/api/${version}${path}`;
  return fetch(url, {
    method: options.method || 'GET',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  }).then(async (r) => {
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
    if (!r.ok) {
      const msg = data?.errors ? JSON.stringify(data.errors) : `HTTP ${r.status}`;
      throw new Error('Shopify Admin: ' + msg);
    }
    return data;
  });
}

// List currently registered webhooks on the shop
app.get('/api/shopify/webhook/list', requireAuth, requirePermission('users:manage'), async (req, res) => {
  try {
    const data = await shopifyAdmin('/webhooks.json');
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Register the orders/create webhook (idempotent — won't double-register)
app.post('/api/shopify/webhook/register', requireAuth, requirePermission('users:manage'), async (req, res) => {
  try {
    const target =
      process.env.SHOPIFY_WEBHOOK_TARGET ||
      'https://olive-crm.onrender.com/api/shopify/webhook/orders';

    // Check existing webhooks for this address+topic
    const existing = await shopifyAdmin('/webhooks.json');
    const already = (existing.webhooks || []).find(
      (w) => w.topic === 'orders/create' && w.address === target
    );
    if (already) {
      return res.json({
        ok: true,
        already: true,
        webhook: already,
        message: 'الـ Webhook متسجل مسبقاً',
      });
    }

    // Create it
    const created = await shopifyAdmin('/webhooks.json', {
      method: 'POST',
      body: {
        webhook: {
          topic: 'orders/create',
          address: target,
          format: 'json',
        },
      },
    });
    res.status(201).json({ ok: true, webhook: created.webhook, message: 'تم تسجيل الـ Webhook بنجاح' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Remove a webhook by ID
app.delete('/api/shopify/webhook/:id', requireAuth, requirePermission('users:manage'), async (req, res) => {
  try {
    await shopifyAdmin(`/webhooks/${req.params.id}.json`, { method: 'DELETE' });
    res.json({ ok: true, message: 'تم حذف الـ Webhook' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════ SHOPIFY WEBHOOK ═══════════════
// Shopify sends orders here when 'orders/create' webhook fires.
// Configure on Shopify Dashboard → Notifications → Webhooks.
// Set SHOPIFY_WEBHOOK_SECRET on the server to enable HMAC verification.

// Helper: extract a usable Egyptian phone from a Shopify order
function pickShopifyPhone(order) {
  return (
    order.shipping_address?.phone ||
    order.billing_address?.phone ||
    order.phone ||
    order.customer?.phone ||
    ''
  );
}

app.post('/api/shopify/webhook/orders', (req, res) => {
    try {
      // ─── HMAC verification (skip only if secret intentionally blank for testing) ───
      const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
      const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
      if (secret) {
        if (!hmacHeader) return res.status(401).send('Missing HMAC');
        const computed = crypto
          .createHmac('sha256', secret)
          .update(req.body)
          .digest('base64');
        const a = Buffer.from(computed);
        const b = Buffer.from(hmacHeader);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
          return res.status(401).send('HMAC mismatch');
        }
      }

      // ─── Parse payload ───
      let order;
      try { order = JSON.parse(req.body.toString('utf8')); }
      catch (e) { return res.status(400).send('Bad JSON'); }

      const db = getDB();
      const shop = req.get('X-Shopify-Shop-Domain') || '';
      const shopifyOrderId = String(order.id || order.name || '');

      // ─── Skip duplicates ───
      if (shopifyOrderId) {
        const dup = db.get(
          'SELECT id FROM orders WHERE external_order_id = ? AND source = ? LIMIT 1',
          [shopifyOrderId, 'shopify']
        );
        if (dup) return res.status(200).json({ ok: true, deduped: true, orderId: dup.id });
      }

      // ─── Customer info ───
      const ship = order.shipping_address || order.billing_address || {};
      const customerFullName = `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim();
      const name = ship.name || customerFullName || 'عميل Shopify';
      const rawPhone = pickShopifyPhone(order);
      const phone = normalizePhone(rawPhone || '');
      if (!phone) return res.status(400).send('Missing customer phone');

      const region = ship.province || ship.city || '';
      const address = [ship.address1, ship.address2, ship.city].filter(Boolean).join(' — ');

      // ─── Find or create customer (default 'new', round-robin assign) ───
      let customer = db.get('SELECT id FROM customers WHERE phone = ?', [phone]);
      let customerId;
      if (customer) {
        customerId = customer.id;
        if (region || address) {
          db.run(
            `UPDATE customers SET region = COALESCE(NULLIF(?, ''), region), address = COALESCE(NULLIF(?, ''), address) WHERE id = ?`,
            [region, address, customerId]
          );
        }
      } else {
        const assignedTo = pickNextCallCenterAgent();
        const result = db.run(
          `INSERT INTO customers (name, phone, region, address, source, status, assigned_to, created_at)
           VALUES (?, ?, ?, ?, 'Shopify', 'new', ?, datetime('now'))`,
          [name, phone, region, address, assignedTo]
        );
        customerId = result.lastInsertRowid;
      }

      // ─── Build line items ───
      const items = (order.line_items || []).map(li => {
        const qty = parseInt(li.quantity, 10) || 1;
        const price = parseFloat(li.price) || 0;
        return {
          productId: 0,
          productName: li.title || li.name || 'منتج',
          qty,
          price,
          total: price * qty,
        };
      });
      if (!items.length) {
        items.push({
          productId: 0,
          productName: order.name || 'طلب Shopify',
          qty: 1,
          price: parseFloat(order.total_price) || 0,
          total: parseFloat(order.total_price) || 0,
        });
      }

      const grand = items.reduce((s, it) => s + it.total, 0);
      const totalQty = items.reduce((s, it) => s + it.qty, 0);
      const first = items[0];
      const summary = items.length === 1
        ? first.productName
        : `${first.productName} +${items.length - 1} منتجات`;
      const itemsJson = items.length > 1 ? JSON.stringify(items) : '';

      const orderResult = db.run(
        `INSERT INTO orders (customer_id, product_id, product_name, qty, price, total, status, address, source, items_json, external_order_id, created_at)
         VALUES (?, 0, ?, ?, ?, ?, 'جديد', ?, 'shopify', ?, ?, datetime('now'))`,
        [customerId, summary, totalQty, first.price, grand, address, itemsJson, shopifyOrderId]
      );
      const orderId = orderResult.lastInsertRowid;

      // Timeline
      const tlLabels = items.map(it => `${it.productName} × ${it.qty}`).join(' • ');
      db.run(
        `INSERT INTO timeline (customer_id, type, text, icon, user_name, created_at)
         VALUES (?, 'order', ?, '🛒', 'Shopify', datetime('now'))`,
        [customerId, `طلب Shopify (#${shopifyOrderId}): ${tlLabels} — إجمالي ${grand} ج`]
      );

      // Live notification to connected CRM users
      try {
        io.emit('integration:new_order', {
          customerId, orderId, name, phone, source: 'shopify',
          shopName: shop, shopifyOrderId, total: grand,
        });
      } catch (_) {}

      // Respond fast (Shopify times out at 5s)
      res.status(200).json({ ok: true, customerId, orderId });
  } catch (err) {
    console.error('Shopify webhook error:', err);
    // Return 200 anyway so Shopify doesn't keep retrying for unrecoverable errors
    res.status(200).json({ ok: false, error: err.message });
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

// ═══════════════ PICK UP (Excel automation, ports jt_automation.py) ═══════════════
function sendXlsxBuffer(res, buf, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  res.setHeader('X-Pickup-Result', 'success');
  res.send(buf);
}

// Op 1 — merge My Order + My Waybill + Pickup (3 files)
app.post('/api/pickup/merge-three', requireAuth, requirePermission('view:pickup'),
  upload.fields([{ name: 'order', maxCount: 1 }, { name: 'waybill', maxCount: 1 }, { name: 'pickup', maxCount: 1 }]),
  (req, res) => {
    try {
      const order = req.files?.order?.[0];
      const waybill = req.files?.waybill?.[0];
      const pickupFile = req.files?.pickup?.[0];
      if (!order || !waybill || !pickupFile) {
        return res.status(400).json({ error: 'لازم ترفع 3 ملفات: My Order و My Waybill و البيك اب' });
      }
      const result = pickup.mergeThree({
        orderBuf: order.buffer,
        waybillBuf: waybill.buffer,
        pickupBuf: pickupFile.buffer,
      });
      res.setHeader('X-Pickup-Total', result.total);
      res.setHeader('X-Pickup-Added', result.added);
      res.setHeader('X-Pickup-Stats', encodeURIComponent(JSON.stringify(result.stats)));
      sendXlsxBuffer(res, result.buffer, 'شيت_البيك_اب_النسخة_النهائية.xlsx');
    } catch (err) {
      console.error('pickup merge-three error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Op 2 — transfer from My Order only
app.post('/api/pickup/transfer-order', requireAuth, requirePermission('view:pickup'),
  upload.fields([{ name: 'source', maxCount: 1 }, { name: 'pickup', maxCount: 1 }]),
  (req, res) => {
    try {
      const src = req.files?.source?.[0];
      const pickupFile = req.files?.pickup?.[0];
      if (!src || !pickupFile) return res.status(400).json({ error: 'ارفع ملف My Order وملف البيك اب' });
      const result = pickup.transferSingle({
        srcBuf: src.buffer,
        pickupBuf: pickupFile.buffer,
        preferredSheet: 'My Order',
      });
      res.setHeader('X-Pickup-Total', result.total);
      res.setHeader('X-Pickup-Added', result.added);
      res.setHeader('X-Pickup-Matched', result.matched);
      res.setHeader('X-Pickup-Stats', encodeURIComponent(JSON.stringify(result.stats)));
      sendXlsxBuffer(res, result.buffer, 'البيك_اب_محدث_My_Order.xlsx');
    } catch (err) {
      console.error('pickup transfer-order error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Op 3 — transfer from My Waybill only
app.post('/api/pickup/transfer-waybill', requireAuth, requirePermission('view:pickup'),
  upload.fields([{ name: 'source', maxCount: 1 }, { name: 'pickup', maxCount: 1 }]),
  (req, res) => {
    try {
      const src = req.files?.source?.[0];
      const pickupFile = req.files?.pickup?.[0];
      if (!src || !pickupFile) return res.status(400).json({ error: 'ارفع ملف My Waybill وملف البيك اب' });
      const result = pickup.transferSingle({
        srcBuf: src.buffer,
        pickupBuf: pickupFile.buffer,
        preferredSheet: 'My Waybill',
      });
      res.setHeader('X-Pickup-Total', result.total);
      res.setHeader('X-Pickup-Added', result.added);
      res.setHeader('X-Pickup-Matched', result.matched);
      res.setHeader('X-Pickup-Stats', encodeURIComponent(JSON.stringify(result.stats)));
      sendXlsxBuffer(res, result.buffer, 'البيك_اب_محدث_My_Waybill.xlsx');
    } catch (err) {
      console.error('pickup transfer-waybill error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

// Op 4 — shipping costs
app.post('/api/pickup/shipping-costs', requireAuth, requirePermission('view:pickup'),
  upload.fields([{ name: 'pickup', maxCount: 1 }, { name: 'shipping', maxCount: 1 }]),
  (req, res) => {
    try {
      const pickupFile = req.files?.pickup?.[0];
      const shipping = req.files?.shipping?.[0];
      if (!pickupFile || !shipping) return res.status(400).json({ error: 'ارفع ملف البيك اب وملف مصاريف الشحن' });
      const result = pickup.shippingCosts({
        pickupBuf: pickupFile.buffer,
        shippingBuf: shipping.buffer,
      });
      res.setHeader('X-Pickup-Total', result.total);
      res.setHeader('X-Pickup-Updated', result.updated);
      sendXlsxBuffer(res, result.buffer, 'البيك_اب_مصاريف_الشحن.xlsx');
    } catch (err) {
      console.error('pickup shipping-costs error:', err);
      res.status(500).json({ error: err.message });
    }
  }
);

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
