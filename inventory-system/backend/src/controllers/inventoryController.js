const prisma = require('../config/database');
const { logActivity, paginate } = require('../utils/helpers');

exports.getMovements = async (req, res, next) => {
  try {
    const { page, limit, branchId, productId, type, from, to } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (branchId) where.branchId = branchId;
    if (req.user.role !== 'ADMIN' && req.user.branchId) where.branchId = req.user.branchId;
    if (productId) where.productId = productId;
    if (type) where.type = type;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59');
    }

    const [movements, total] = await Promise.all([
      prisma.inventoryMovement.findMany({
        where, skip, take,
        include: {
          product: { select: { id: true, name: true, sku: true } },
          branch: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryMovement.count({ where }),
    ]);

    res.json({ data: movements, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (error) { next(error); }
};

exports.adjustStock = async (req, res, next) => {
  try {
    const { branchId, productId, quantity, type, notes } = req.body;

    const result = await prisma.$transaction(async (tx) => {
      const bp = await tx.branchProduct.upsert({
        where: { branchId_productId: { branchId, productId } },
        create: { branchId, productId, quantity: type === 'OUT' ? 0 : quantity },
        update: {
          quantity: type === 'OUT'
            ? { decrement: quantity }
            : type === 'IN'
              ? { increment: quantity }
              : undefined,
        },
      });

      if (type === 'ADJUSTMENT') {
        await tx.branchProduct.update({
          where: { branchId_productId: { branchId, productId } },
          data: { quantity },
        });
      }

      const movement = await tx.inventoryMovement.create({
        data: { productId, branchId, type, quantity, notes, userId: req.user.id },
        include: {
          product: { select: { name: true, sku: true } },
          branch: { select: { name: true } },
        },
      });

      return movement;
    });

    await logActivity(req.user.id, 'ADJUST_STOCK', 'Inventory', result.id, req.body, req.ip);
    res.status(201).json(result);
  } catch (error) { next(error); }
};

exports.getBranchStock = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const { search } = req.query;

    const where = { branchId, product: { isActive: true } };
    if (search) {
      where.product = {
        isActive: true,
        OR: [
          { name: { contains: search } },
          { sku: { contains: search } },
          { barcode: { contains: search } },
        ],
      };
    }

    const stock = await prisma.branchProduct.findMany({
      where,
      include: {
        product: { include: { category: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });

    res.json(stock);
  } catch (error) { next(error); }
};

exports.createCount = async (req, res, next) => {
  try {
    const { branchId, notes, items } = req.body;

    const count = await prisma.$transaction(async (tx) => {
      const processedItems = [];
      for (const item of items) {
        const bp = await tx.branchProduct.findUnique({
          where: { branchId_productId: { branchId, productId: item.productId } },
        });
        processedItems.push({
          productId: item.productId,
          systemQuantity: bp?.quantity || 0,
          actualQuantity: item.actualQuantity,
          difference: item.actualQuantity - (bp?.quantity || 0),
        });
      }

      return tx.inventoryCount.create({
        data: {
          branchId,
          userId: req.user.id,
          notes,
          items: { create: processedItems },
        },
        include: {
          items: { include: { product: { select: { id: true, name: true, sku: true } } } },
          branch: { select: { name: true } },
          user: { select: { name: true } },
        },
      });
    });

    await logActivity(req.user.id, 'CREATE_COUNT', 'InventoryCount', count.id, { branchId, itemCount: items.length }, req.ip);
    res.status(201).json(count);
  } catch (error) { next(error); }
};

exports.completeCount = async (req, res, next) => {
  try {
    const { id } = req.params;

    const count = await prisma.inventoryCount.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!count) return res.status(404).json({ message: 'الجرد غير موجود' });
    if (count.status !== 'DRAFT') return res.status(400).json({ message: 'الجرد مكتمل بالفعل' });

    await prisma.$transaction(async (tx) => {
      for (const item of count.items) {
        if (item.difference !== 0) {
          await tx.branchProduct.update({
            where: { branchId_productId: { branchId: count.branchId, productId: item.productId } },
            data: { quantity: item.actualQuantity },
          });

          await tx.inventoryMovement.create({
            data: {
              productId: item.productId,
              branchId: count.branchId,
              type: 'ADJUSTMENT',
              quantity: Math.abs(item.difference),
              reference: `COUNT-${count.id}`,
              notes: `تسوية جرد: الفرق ${item.difference}`,
              userId: req.user.id,
            },
          });
        }
      }

      await tx.inventoryCount.update({
        where: { id },
        data: { status: 'COMPLETED' },
      });
    });

    await logActivity(req.user.id, 'COMPLETE_COUNT', 'InventoryCount', id, null, req.ip);
    res.json({ message: 'تم إتمام الجرد وتسوية المخزون بنجاح' });
  } catch (error) { next(error); }
};

exports.getCounts = async (req, res, next) => {
  try {
    const { page, limit, branchId } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (branchId) where.branchId = branchId;
    if (req.user.role !== 'ADMIN' && req.user.branchId) where.branchId = req.user.branchId;

    const [counts, total] = await Promise.all([
      prisma.inventoryCount.findMany({
        where, skip, take,
        include: {
          branch: { select: { name: true } },
          user: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryCount.count({ where }),
    ]);

    res.json({ data: counts, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (error) { next(error); }
};
