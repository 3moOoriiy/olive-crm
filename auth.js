const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDB } = require('./db');

const DEFAULT_SECRET = 'olive-crm-default-secret';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_SECRET;
const JWT_EXPIRY = '7d';

// Warn if using default secret
if (JWT_SECRET === DEFAULT_SECRET) {
  console.warn('⚠️  WARNING: Using default JWT secret! Set JWT_SECRET in .env for production.');
}

// ═══════════════ RATE LIMITER ═══════════════
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000; // 15 min
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX) || 5;

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
    return true;
  }
  record.count++;
  return record.count <= RATE_LIMIT_MAX;
}

// Clean up old entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
      loginAttempts.delete(ip);
    }
  }
}, 30 * 60 * 1000);

function generateToken(user) {
  return jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

function loginHandler(req, res) {
  const ip =
    (req.headers['x-forwarded-for']?.split(',')[0]?.trim()) ||
    req.ip ||
    req.connection?.remoteAddress ||
    'unknown';

  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبين' });
  }

  const db = getDB();
  const user = db.get('SELECT * FROM users WHERE email = ? AND is_active = 1', [email]);

  // ✅ Rate limit فقط عند الفشل
  if (!user) {
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'محاولات كثيرة. حاول بعد 15 دقيقة' });
    }
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }

  const valid = bcrypt.compareSync(password, user.password_hash);
  if (!valid) {
    if (!checkRateLimit(ip)) {
      return res.status(429).json({ error: 'محاولات كثيرة. حاول بعد 15 دقيقة' });
    }
    return res.status(401).json({ error: 'بيانات الدخول غير صحيحة' });
  }

  // ✅ نجاح: صفّر المحاولات
  loginAttempts.delete(ip);

  const token = generateToken(user);
  const { password_hash, ...safeUser } = user;
  return res.json({ token, user: safeUser });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'غير مصرح' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const db = getDB();
    const user = db.get('SELECT id, name, email, role, avatar_initials, color FROM users WHERE id = ? AND is_active = 1', [decoded.userId]);
    if (!user) {
      return res.status(401).json({ error: 'المستخدم غير موجود' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'جلسة منتهية، سجل دخول مرة أخرى' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'غير مصرح لك بهذا الإجراء' });
    }
    next();
  };
}

// ═══════════════ PERMISSIONS MAP ═══════════════
const PERMISSIONS = {
  moderator:   ['view:dashboard', 'view:moderator_form', 'view:staff_chat', 'orders:create'],
  call_center: ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:staff_chat', 'customers:manage', 'orders:create', 'calls:log', 'whatsapp:send'],
  complaints:  ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:complaints', 'view:staff_chat', 'customers:manage', 'orders:create', 'calls:log', 'whatsapp:send', 'complaints:manage'],
  supervisor:  ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:complaints', 'view:performance', 'view:reports', 'view:moderator_form', 'view:staff_chat', 'customers:manage', 'orders:create', 'calls:log', 'whatsapp:send', 'complaints:manage'],
  operations:  ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:complaints', 'view:performance', 'view:reports', 'view:settings', 'view:moderator_form', 'view:staff_chat', 'customers:manage', 'orders:create', 'orders:manage', 'calls:log', 'whatsapp:send', 'complaints:manage', 'users:manage', 'users:delete', 'products:manage', 'templates:manage', 'customers:delete_all'],
  admin:       ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:complaints', 'view:performance', 'view:reports', 'view:settings', 'view:moderator_form', 'view:staff_chat', 'customers:manage', 'orders:create', 'orders:manage', 'calls:log', 'whatsapp:send', 'complaints:manage', 'users:manage', 'users:delete', 'products:manage', 'templates:manage', 'customers:delete_all'],
};

function canAccess(role, permission) {
  const perms = PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes(permission);
}

function requirePermission(...permissions) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ error: 'غير مصرح' });
    const hasAny = permissions.some(p => canAccess(role, p));
    if (!hasAny) return res.status(403).json({ error: 'غير مصرح لك بهذا الإجراء' });
    next();
  };
}

module.exports = { loginHandler, requireAuth, requireRole, requirePermission, canAccess, generateToken, PERMISSIONS, JWT_SECRET };
