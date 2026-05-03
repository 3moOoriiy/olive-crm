const bcrypt = require('bcryptjs');
const prisma = require('../config/database');
const { logActivity, paginate } = require('../utils/helpers');

exports.getAll = async (req, res, next) => {
  try {
    const { page, limit, role, branchId, search } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (role) where.role = role;
    if (branchId) where.branchId = branchId;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take,
        select: {
          id: true, name: true, email: true, phone: true, role: true,
          permissions: true, isActive: true, createdAt: true,
          branch: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ data: users, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (error) { next(error); }
};

exports.getById = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        permissions: true, isActive: true, createdAt: true, updatedAt: true,
        branch: { select: { id: true, name: true } },
      },
    });
    if (!user) return res.status(404).json({ message: 'المستخدم غير موجود' });
    res.json(user);
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (data.password) {
      data.password = await bcrypt.hash(data.password, 12);
    }
    // Convert permissions array to JSON string for storage
    if (data.permissions !== undefined) {
      data.permissions = Array.isArray(data.permissions) ? JSON.stringify(data.permissions) : data.permissions;
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true, name: true, email: true, phone: true, role: true,
        permissions: true, isActive: true, branchId: true,
      },
    });

    await logActivity(req.user.id, 'UPDATE', 'User', user.id, { ...req.body, password: undefined }, req.ip);
    res.json(user);
  } catch (error) { next(error); }
};

exports.delete = async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ message: 'لا يمكنك حذف حسابك' });
    }

    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    await logActivity(req.user.id, 'DELETE', 'User', req.params.id, null, req.ip);
    res.json({ message: 'تم تعطيل المستخدم بنجاح' });
  } catch (error) { next(error); }
};

exports.getActivityLogs = async (req, res, next) => {
  try {
    const { page, limit, userId, entity, action, from, to } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (userId) where.userId = userId;
    if (entity) where.entity = entity;
    if (action) where.action = action;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59');
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where, skip, take,
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.activityLog.count({ where }),
    ]);

    res.json({ data: logs, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (error) { next(error); }
};
