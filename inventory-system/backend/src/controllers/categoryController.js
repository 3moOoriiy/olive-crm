const prisma = require('../config/database');
const { logActivity } = require('../utils/helpers');

exports.getAll = async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(categories);
  } catch (error) { next(error); }
};

exports.getById = async (req, res, next) => {
  try {
    const category = await prisma.category.findUnique({
      where: { id: req.params.id },
      include: { products: { where: { isActive: true }, take: 50 } },
    });
    if (!category) return res.status(404).json({ message: 'التصنيف غير موجود' });
    res.json(category);
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const category = await prisma.category.create({ data: req.body });
    await logActivity(req.user.id, 'CREATE', 'Category', category.id, req.body, req.ip);
    res.status(201).json(category);
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const category = await prisma.category.update({ where: { id: req.params.id }, data: req.body });
    await logActivity(req.user.id, 'UPDATE', 'Category', category.id, req.body, req.ip);
    res.json(category);
  } catch (error) { next(error); }
};

exports.delete = async (req, res, next) => {
  try {
    await prisma.category.delete({ where: { id: req.params.id } });
    await logActivity(req.user.id, 'DELETE', 'Category', req.params.id, null, req.ip);
    res.json({ message: 'تم حذف التصنيف بنجاح' });
  } catch (error) { next(error); }
};
