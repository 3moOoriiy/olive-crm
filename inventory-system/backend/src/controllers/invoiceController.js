const prisma = require('../config/database');
const { generateInvoiceNumber, logActivity, paginate } = require('../utils/helpers');

exports.getAll = async (req, res, next) => {
  try {
    const { page, limit, branchId, type, status, from, to } = req.query;
    const { skip, take } = paginate(page, limit);

    const where = {};
    if (branchId) where.branchId = branchId;
    if (req.user.role !== 'ADMIN' && req.user.branchId) where.branchId = req.user.branchId;
    if (type) where.type = type;
    if (status) where.status = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59');
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where, skip, take,
        include: {
          branch: { select: { id: true, name: true } },
          user: { select: { id: true, name: true } },
          customer: true,
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.invoice.count({ where }),
    ]);

    res.json({ data: invoices, total, page: parseInt(page) || 1, totalPages: Math.ceil(total / take) });
  } catch (error) { next(error); }
};

exports.getById = async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: {
        branch: true,
        user: { select: { id: true, name: true, email: true } },
        customer: true,
        items: { include: { product: { select: { id: true, name: true, sku: true, barcode: true } } } },
        refunds: true,
      },
    });
    if (!invoice) return res.status(404).json({ message: 'الفاتورة غير موجودة' });
    res.json(invoice);
  } catch (error) { next(error); }
};

exports.create = async (req, res, next) => {
  try {
    const { branchId, customerId, discount, paymentMethod, notes, items } = req.body;
    const userId = req.user.id;

    // Verify stock & calculate totals
    let subtotal = 0;
    let totalTax = 0;
    const processedItems = [];

    for (const item of items) {
      const product = await prisma.product.findUnique({ where: { id: item.productId } });
      if (!product || !product.isActive) {
        return res.status(400).json({ message: `المنتج غير موجود: ${item.productId}` });
      }

      const branchProduct = await prisma.branchProduct.findUnique({
        where: { branchId_productId: { branchId, productId: item.productId } },
      });

      if (!branchProduct || branchProduct.quantity < item.quantity) {
        return res.status(400).json({
          message: `الكمية غير كافية للمنتج: ${product.name}. المتوفر: ${branchProduct?.quantity || 0}`,
        });
      }

      const itemTotal = item.price * item.quantity;
      const itemTax = (itemTotal - (item.discount || 0)) * (product.taxRate / 100);
      subtotal += itemTotal;
      totalTax += itemTax;

      processedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
        discount: item.discount || 0,
        tax: itemTax,
        total: itemTotal - (item.discount || 0) + itemTax,
      });
    }

    const total = subtotal - discount + totalTax;
    const invoiceNumber = await generateInvoiceNumber();

    const invoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: 'SALE',
          branchId,
          userId,
          customerId,
          subtotal,
          taxAmount: totalTax,
          discount,
          total,
          paymentMethod,
          notes,
          items: { create: processedItems },
        },
        include: {
          items: { include: { product: true } },
          branch: true,
          user: { select: { id: true, name: true } },
          customer: true,
        },
      });

      // Deduct stock + components (BOM)
      for (const item of items) {
        await tx.branchProduct.update({
          where: { branchId_productId: { branchId, productId: item.productId } },
          data: { quantity: { decrement: item.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            branchId,
            type: 'SALE',
            quantity: item.quantity,
            reference: inv.invoiceNumber,
            userId,
          },
        });

        // Deduct components (BOM)
        const components = await tx.productComponent.findMany({
          where: { productId: item.productId },
        });

        for (const comp of components) {
          const compQty = Math.ceil(comp.quantity * item.quantity);

          await tx.branchProduct.upsert({
            where: { branchId_productId: { branchId, productId: comp.componentId } },
            create: { branchId, productId: comp.componentId, quantity: -compQty },
            update: { quantity: { decrement: compQty } },
          });

          await tx.inventoryMovement.create({
            data: {
              productId: comp.componentId,
              branchId,
              type: 'SALE',
              quantity: compQty,
              reference: inv.invoiceNumber,
              notes: `مكون من: ${item.productId}`,
              userId,
            },
          });
        }
      }

      return inv;
    });

    await logActivity(userId, 'CREATE', 'Invoice', invoice.id, { invoiceNumber, total }, req.ip);
    res.status(201).json(invoice);
  } catch (error) { next(error); }
};

exports.delete = async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });

    if (!invoice) return res.status(404).json({ message: 'الفاتورة غير موجودة' });

    await prisma.$transaction(async (tx) => {
      // Restore stock for SALE invoices
      if (invoice.type === 'SALE' && invoice.status !== 'CANCELLED') {
        for (const item of invoice.items) {
          await tx.branchProduct.update({
            where: { branchId_productId: { branchId: invoice.branchId, productId: item.productId } },
            data: { quantity: { increment: item.quantity } },
          });
        }
      }

      // Delete related records
      await tx.invoiceItem.deleteMany({ where: { invoiceId: invoice.id } });
      await tx.inventoryMovement.deleteMany({ where: { reference: invoice.invoiceNumber } });
      // Delete refund invoices linked to this one
      await tx.invoiceItem.deleteMany({ where: { invoice: { refundOfId: invoice.id } } });
      await tx.invoice.deleteMany({ where: { refundOfId: invoice.id } });
      await tx.invoice.delete({ where: { id: invoice.id } });
    });

    await logActivity(req.user.id, 'DELETE', 'Invoice', invoice.id, { invoiceNumber: invoice.invoiceNumber }, req.ip);
    res.json({ message: 'تم حذف الفاتورة بنجاح' });
  } catch (error) { next(error); }
};

exports.refund = async (req, res, next) => {
  try {
    const originalInvoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { items: true },
    });

    if (!originalInvoice) return res.status(404).json({ message: 'الفاتورة غير موجودة' });
    if (originalInvoice.type === 'REFUND') return res.status(400).json({ message: 'لا يمكن إرجاع فاتورة إرجاع' });
    if (originalInvoice.status === 'CANCELLED') return res.status(400).json({ message: 'الفاتورة ملغاة' });

    const invoiceNumber = await generateInvoiceNumber();

    const refund = await prisma.$transaction(async (tx) => {
      const ref = await tx.invoice.create({
        data: {
          invoiceNumber,
          type: 'REFUND',
          branchId: originalInvoice.branchId,
          userId: req.user.id,
          customerId: originalInvoice.customerId,
          subtotal: -originalInvoice.subtotal,
          taxAmount: -originalInvoice.taxAmount,
          discount: originalInvoice.discount,
          total: -originalInvoice.total,
          paymentMethod: originalInvoice.paymentMethod,
          refundOfId: originalInvoice.id,
          notes: `إرجاع للفاتورة ${originalInvoice.invoiceNumber}`,
          items: {
            create: originalInvoice.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              price: item.price,
              discount: item.discount,
              tax: item.tax,
              total: -item.total,
            })),
          },
        },
        include: { items: true, branch: true },
      });

      // Restore stock + components (BOM)
      for (const item of originalInvoice.items) {
        await tx.branchProduct.update({
          where: { branchId_productId: { branchId: originalInvoice.branchId, productId: item.productId } },
          data: { quantity: { increment: item.quantity } },
        });

        await tx.inventoryMovement.create({
          data: {
            productId: item.productId,
            branchId: originalInvoice.branchId,
            type: 'REFUND',
            quantity: item.quantity,
            reference: ref.invoiceNumber,
            userId: req.user.id,
          },
        });

        // Restore components (BOM)
        const components = await tx.productComponent.findMany({
          where: { productId: item.productId },
        });

        for (const comp of components) {
          const compQty = Math.ceil(comp.quantity * item.quantity);

          await tx.branchProduct.upsert({
            where: { branchId_productId: { branchId: originalInvoice.branchId, productId: comp.componentId } },
            create: { branchId: originalInvoice.branchId, productId: comp.componentId, quantity: compQty },
            update: { quantity: { increment: compQty } },
          });

          await tx.inventoryMovement.create({
            data: {
              productId: comp.componentId,
              branchId: originalInvoice.branchId,
              type: 'REFUND',
              quantity: compQty,
              reference: ref.invoiceNumber,
              notes: `إرجاع مكون من: ${item.productId}`,
              userId: req.user.id,
            },
          });
        }
      }

      await tx.invoice.update({
        where: { id: originalInvoice.id },
        data: { status: 'CANCELLED' },
      });

      return ref;
    });

    await logActivity(req.user.id, 'REFUND', 'Invoice', refund.id, { original: originalInvoice.invoiceNumber }, req.ip);
    res.status(201).json(refund);
  } catch (error) { next(error); }
};
