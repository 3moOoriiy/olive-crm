const prisma = require('../config/database');
const { logActivity, paginate } = require('../utils/helpers');

exports.getAll = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const { skip, take } = paginate(page, limit);

    const [branches, total] = await Promise.all([
      prisma.branch.findMany({
        skip, take,
        include: { _count: { select: { users: true, branchProducts: true, invoices: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.branch.count(),
    ]);

    res.json({ data: branches, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (error) { next(error); }
};

exports.getById = async (req, res, next) => {
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true, branchProducts: true, invoices: true } } },
    });
    if (!branch) return res.status(404).json({ message: 'الفرع غير موجود' });
    res.json(branch);
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const branch = await prisma.branch.create({ data: req.body });
    await logActivity(req.user.id, 'CREATE', 'Branch', branch.id, req.body, req.ip);
    res.status(201).json(branch);
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const branch = await prisma.branch.update({ where: { id: req.params.id }, data: req.body });
    await logActivity(req.user.id, 'UPDATE', 'Branch', branch.id, req.body, req.ip);
    res.json(branch);
  } catch (error) { next(error); }
};

exports.delete = async (req, res, next) => {
  try {
    await prisma.branch.delete({ where: { id: req.params.id } });
    await logActivity(req.user.id, 'DELETE', 'Branch', req.params.id, null, req.ip);
    res.json({ message: 'تم حذف الفرع بنجاح' });
  } catch (error) { next(error); }
};
