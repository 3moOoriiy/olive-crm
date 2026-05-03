const prisma = require('../config/database');
const { logActivity, paginate } = require('../utils/helpers');

exports.getAll = async (req, res, next) => {
  try {
    const { page, limit, status, branchId } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (status) where.status = status;
    if (branchId) {
      where.OR = [{ fromBranchId: branchId }, { toBranchId: branchId }];
    }
    if (req.user.role !== 'ADMIN' && req.user.branchId) {
      where.OR = [{ fromBranchId: req.user.branchId }, { toBranchId: req.user.branchId }];
    }

    const [transfers, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        where, skip, take,
        include: {
          fromBranch: { select: { id: true, name: true } },
          toBranch: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true } },
          approvedBy: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockTransfer.count({ where }),
    ]);

    res.json({ data: transfers, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (error) { next(error); }
};

exports.getById = async (req, res, next) => {
  try {
    const transfer = await prisma.stockTransfer.findUnique({
      where: { id: req.params.id },
      include: {
        fromBranch: true,
        toBranch: true,
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true } } } },
      },
    });
    if (!transfer) return res.status(404).json({ message: 'التحويل غير موجود' });
    res.json(transfer);
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const { fromBranchId, toBranchId, notes, items } = req.body;

    if (fromBranchId === toBranchId) {
      return res.status(400).json({ message: 'لا يمكن التحويل لنفس الفرع' });
    }

    // Verify stock
    for (const item of items) {
      const bp = await prisma.branchProduct.findUnique({
        where: { branchId_productId: { branchId: fromBranchId, productId: item.productId } },
      });
      if (!bp || bp.quantity < item.quantity) {
        const product = await prisma.product.findUnique({ where: { id: item.productId } });
        return res.status(400).json({
          message: `الكمية غير كافية للمنتج: ${product?.name}. المتوفر: ${bp?.quantity || 0}`,
        });
      }
    }

    const transfer = await prisma.stockTransfer.create({
      data: {
        fromBranchId,
        toBranchId,
        userId: req.user.id,
        notes,
        items: { create: items },
      },
      include: {
        fromBranch: { select: { name: true } },
        toBranch: { select: { name: true } },
        items: { include: { product: { select: { name: true, sku: true } } } },
      },
    });

    await logActivity(req.user.id, 'CREATE', 'StockTransfer', transfer.id, { fromBranchId, toBranchId, itemCount: items.length }, req.ip);
    res.status(201).json(transfer);
  } catch (error) { next(error); }
};

exports.approve = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'approve' or 'reject'

    const transfer = await prisma.stockTransfer.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!transfer) return res.status(404).json({ message: 'التحويل غير موجود' });
    if (transfer.status !== 'PENDING') return res.status(400).json({ message: 'التحويل غير قابل للتعديل' });

    if (action === 'reject') {
      await prisma.stockTransfer.update({
        where: { id },
        data: { status: 'REJECTED', approvedById: req.user.id },
      });
      await logActivity(req.user.id, 'REJECT_TRANSFER', 'StockTransfer', id, null, req.ip);
      return res.json({ message: 'تم رفض التحويل' });
    }

    await prisma.$transaction(async (tx) => {
      for (const item of transfer.items) {
        // Deduct from source branch
        await tx.branchProduct.update({
          where: { branchId_productId: { branchId: transfer.fromBranchId, productId: item.productId } },
          data: { quantity: { decrement: item.quantity } },
        });

        // Add to destination branch
        await tx.branchProduct.upsert({
          where: { branchId_productId: { branchId: transfer.toBranchId, productId: item.productId } },
          create: { branchId: transfer.toBranchId, productId: item.productId, quantity: item.quantity },
          update: { quantity: { increment: item.quantity } },
        });

        // Log movements
        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            branchId: transfer.fromBranchId,
            type: 'TRANSFER_OUT',
            quantity: item.quantity,
            reference: `TRANSFER-${id}`,
            userId: req.user.id,
          },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            branchId: transfer.toBranchId,
            type: 'TRANSFER_IN',
            quantity: item.quantity,
            reference: `TRANSFER-${id}`,
            userId: req.user.id,
          },
        });
      }

      await tx.stockTransfer.update({
        where: { id },
        data: { status: 'COMPLETED', approvedById: req.user.id },
      });
    });

    await logActivity(req.user.id, 'APPROVE_TRANSFER', 'StockTransfer', id, null, req.ip);
    res.json({ message: 'تم الموافقة على التحويل وتنفيذه بنجاح' });
  } catch (error) { next(error); }
};
