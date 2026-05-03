const prisma = require('../config/database');
const { logActivity, paginate } = require('../utils/helpers');

exports.getAll = async (req, res, next) => {
  try {
    const { page, limit, search } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } },
      ];
    }

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where, skip, take,
        include: { _count: { select: { invoices: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({ data: customers, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (error) { next(error); }
};

exports.getById = async (req, res, next) => {
  try {
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        invoices: { take: 20, orderBy: { createdAt: 'desc' }, include: { branch: { select: { name: true } } } },
      },
    });
    if (!customer) return res.status(404).json({ message: 'العميل غير موجود' });
    res.json(customer);
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const customer = await prisma.customer.create({ data: req.body });
    await logActivity(req.user.id, 'CREATE', 'Customer', customer.id, req.body, req.ip);
    res.status(201).json(customer);
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const customer = await prisma.customer.update({ where: { id: req.params.id }, data: req.body });
    await logActivity(req.user.id, 'UPDATE', 'Customer', customer.id, req.body, req.ip);
    res.json(customer);
  } catch (error) { next(error); }
};

exports.delete = async (req, res, next) => {
  try {
    await prisma.customer.delete({ where: { id: req.params.id } });
    await logActivity(req.user.id, 'DELETE', 'Customer', req.params.id, null, req.ip);
    res.json({ message: 'تم حذف العميل بنجاح' });
  } catch (error) { next(error); }
};
