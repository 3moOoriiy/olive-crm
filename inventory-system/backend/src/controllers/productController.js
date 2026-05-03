const prisma = require('../config/database');
const QRCode = require('qrcode');
const { logActivity, paginate } = require('../utils/helpers');

exports.getAll = async (req, res, next) => {
  try {
    const { page, limit, search, categoryId, branchId } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = { isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { sku: { contains: search } },
        { barcode: { contains: search } },
      ];
    }
    if (categoryId) where.categoryId = categoryId;

    const include = { category: true };
    if (branchId) {
      include.branchProducts = { where: { branchId } };
    } else {
      include.branchProducts = { include: { branch: { select: { id: true, name: true } } } };
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, skip, take, include, orderBy: { createdAt: 'desc' } }),
      prisma.product.count({ where }),
    ]);

    res.json({ data: products, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (error) { next(error); }
};

exports.getById = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        branchProducts: { include: { branch: { select: { id: true, name: true } } } },
      },
    });
    if (!product) return res.status(404).json({ message: 'المنتج غير موجود' });
    res.json(product);
  } catch (error) { next(error); }
};

exports.getByBarcode = async (req, res, next) => {
  try {
    const product = await prisma.product.findFirst({
      where: { OR: [{ barcode: req.params.code }, { sku: req.params.code }], isActive: true },
      include: {
        category: true,
        branchProducts: { include: { branch: { select: { id: true, name: true } } } },
      },
    });
    if (!product) return res.status(404).json({ message: 'المنتج غير موجود' });
    res.json(product);
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (req.file) data.image = `/uploads/${req.file.filename}`;

    const product = await prisma.product.create({ data, include: { category: true } });

    // Add product to all branches with 0 stock
    const branches = await prisma.branch.findMany({ select: { id: true } });
    for (const branch of branches) {
      await prisma.branchProduct.upsert({
        where: { branchId_productId: { branchId: branch.id, productId: product.id } },
        create: { branchId: branch.id, productId: product.id, quantity: 0 },
        update: {},
      });
    }

    // Generate QR Code
    const qrData = JSON.stringify({ id: product.id, sku: product.sku, name: product.name });
    const qrCode = await QRCode.toDataURL(qrData);
    await prisma.product.update({ where: { id: product.id }, data: { qrCode } });

    await logActivity(req.user.id, 'CREATE', 'Product', product.id, { name: data.name, sku: data.sku }, req.ip);
    res.status(201).json({ ...product, qrCode });
  } catch (error) { next(error); }
};

exports.update = async (req, res, next) => {
  try {
    const data = { ...req.body };
    if (req.file) data.image = `/uploads/${req.file.filename}`;

    const product = await prisma.product.update({
      where: { id: req.params.id },
      data,
      include: { category: true },
    });
    await logActivity(req.user.id, 'UPDATE', 'Product', product.id, data, req.ip);
    res.json(product);
  } catch (error) { next(error); }
};

exports.delete = async (req, res, next) => {
  try {
    await prisma.product.update({ where: { id: req.params.id }, data: { isActive: false } });
    await logActivity(req.user.id, 'DELETE', 'Product', req.params.id, null, req.ip);
    res.json({ message: 'تم حذف المنتج بنجاح' });
  } catch (error) { next(error); }
};

exports.getQRCode = async (req, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) return res.status(404).json({ message: 'المنتج غير موجود' });

    if (!product.qrCode) {
      const qrData = JSON.stringify({ id: product.id, sku: product.sku, name: product.name });
      const qrCode = await QRCode.toDataURL(qrData);
      await prisma.product.update({ where: { id: product.id }, data: { qrCode } });
      return res.json({ qrCode });
    }

    res.json({ qrCode: product.qrCode });
  } catch (error) { next(error); }
};

exports.getLowStock = async (req, res, next) => {
  try {
    const { branchId } = req.query;
    const where = {};
    if (branchId) where.branchId = branchId;

    let lowStock;
    if (branchId) {
      lowStock = await prisma.$queryRaw`
        SELECT p.id, p.name, p.sku, p."alertQuantity", bp.quantity, b.name as "branchName", b.id as "branchId"
        FROM products p
        JOIN branch_products bp ON p.id = bp."productId"
        JOIN branches b ON bp."branchId" = b.id
        WHERE bp.quantity <= p."alertQuantity" AND p."isActive" = 1
        AND bp."branchId" = ${branchId}
        ORDER BY bp.quantity ASC
      `;
    } else {
      lowStock = await prisma.$queryRaw`
        SELECT p.id, p.name, p.sku, p."alertQuantity", bp.quantity, b.name as "branchName", b.id as "branchId"
        FROM products p
        JOIN branch_products bp ON p.id = bp."productId"
        JOIN branches b ON bp."branchId" = b.id
        WHERE bp.quantity <= p."alertQuantity" AND p."isActive" = 1
        ORDER BY bp.quantity ASC
      `;
    }

    res.json(lowStock);
  } catch (error) { next(error); }
};
