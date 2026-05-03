const DEFAULT_PERMISSIONS = {
  ADMIN: [
    'users:read', 'users:create', 'users:update', 'users:delete',
    'branches:read', 'branches:create', 'branches:update', 'branches:delete',
    'products:read', 'products:create', 'products:update', 'products:delete',
    'invoices:read', 'invoices:create', 'invoices:refund', 'invoices:delete',
    'inventory:read', 'inventory:adjust', 'inventory:count',
    'transfers:read', 'transfers:create', 'transfers:approve',
    'reports:read', 'reports:export',
    'activity:read',
    'customers:read', 'customers:create', 'customers:update', 'customers:delete',
    'categories:read', 'categories:create', 'categories:update', 'categories:delete',
  ],
  BRANCH_MANAGER: [
    'users:read',
    'branches:read',
    'products:read', 'products:create', 'products:update',
    'invoices:read', 'invoices:create', 'invoices:refund',
    'inventory:read', 'inventory:adjust', 'inventory:count',
    'transfers:read', 'transfers:create', 'transfers:approve',
    'reports:read', 'reports:export',
    'activity:read',
    'customers:read', 'customers:create', 'customers:update',
    'categories:read',
  ],
  CASHIER: [
    'products:read',
    'invoices:read', 'invoices:create',
    'inventory:read',
    'customers:read', 'customers:create',
    'categories:read',
  ],
  WAREHOUSE: [
    'products:read', 'products:create', 'products:update',
    'inventory:read', 'inventory:adjust', 'inventory:count',
    'transfers:read', 'transfers:create',
    'categories:read',
  ],
  VIEWER: [
    'products:read',
    'invoices:read',
    'inventory:read',
    'branches:read',
    'reports:read',
    'categories:read',
  ],
};

// All available permissions grouped by category (for UI)
const ALL_PERMISSIONS = [
  { group: 'المستخدمين', permissions: ['users:read', 'users:create', 'users:update', 'users:delete'] },
  { group: 'الفروع', permissions: ['branches:read', 'branches:create', 'branches:update', 'branches:delete'] },
  { group: 'المنتجات', permissions: ['products:read', 'products:create', 'products:update', 'products:delete'] },
  { group: 'الفواتير', permissions: ['invoices:read', 'invoices:create', 'invoices:refund', 'invoices:delete'] },
  { group: 'المخزون', permissions: ['inventory:read', 'inventory:adjust', 'inventory:count'] },
  { group: 'التحويلات', permissions: ['transfers:read', 'transfers:create', 'transfers:approve'] },
  { group: 'التقارير', permissions: ['reports:read', 'reports:export'] },
  { group: 'العملاء', permissions: ['customers:read', 'customers:create', 'customers:update', 'customers:delete'] },
  { group: 'التصنيفات', permissions: ['categories:read', 'categories:create', 'categories:update', 'categories:delete'] },
  { group: 'النشاطات', permissions: ['activity:read'] },
];

const PERMISSION_LABELS = {
  'users:read': 'عرض', 'users:create': 'إنشاء', 'users:update': 'تعديل', 'users:delete': 'حذف',
  'branches:read': 'عرض', 'branches:create': 'إنشاء', 'branches:update': 'تعديل', 'branches:delete': 'حذف',
  'products:read': 'عرض', 'products:create': 'إنشاء', 'products:update': 'تعديل', 'products:delete': 'حذف',
  'invoices:read': 'عرض', 'invoices:create': 'إنشاء', 'invoices:refund': 'إرجاع', 'invoices:delete': 'حذف',
  'inventory:read': 'عرض', 'inventory:adjust': 'تعديل', 'inventory:count': 'جرد',
  'transfers:read': 'عرض', 'transfers:create': 'إنشاء', 'transfers:approve': 'موافقة',
  'reports:read': 'عرض', 'reports:export': 'تصدير',
  'customers:read': 'عرض', 'customers:create': 'إنشاء', 'customers:update': 'تعديل', 'customers:delete': 'حذف',
  'categories:read': 'عرض', 'categories:create': 'إنشاء', 'categories:update': 'تعديل', 'categories:delete': 'حذف',
  'activity:read': 'عرض',
};

const getUserPermissions = (user) => {
  // If user has custom permissions set, use them
  if (user.permissions) {
    try {
      const custom = JSON.parse(user.permissions);
      if (Array.isArray(custom)) return custom;
    } catch (_) {}
  }
  // Fall back to role-based defaults
  return DEFAULT_PERMISSIONS[user.role] || [];
};

const authorize = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'غير مصرح' });
    }

    const userPermissions = getUserPermissions(req.user);
    const hasPermission = requiredPermissions.every((perm) =>
      userPermissions.includes(perm)
    );

    if (!hasPermission) {
      return res.status(403).json({ message: 'ليس لديك صلاحية لتنفيذ هذا الإجراء' });
    }

    next();
  };
};

const branchAccess = (req, res, next) => {
  if (req.user.role === 'ADMIN') return next();

  const branchId = req.params.branchId || req.body.branchId || req.query.branchId;
  if (branchId && req.user.branchId && branchId !== req.user.branchId) {
    return res.status(403).json({ message: 'ليس لديك صلاحية الوصول لهذا الفرع' });
  }

  next();
};

module.exports = { authorize, branchAccess, DEFAULT_PERMISSIONS, ALL_PERMISSIONS, PERMISSION_LABELS, getUserPermissions };
