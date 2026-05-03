const prisma = require('../config/database');

const generateInvoiceNumber = async () => {
  const today = new Date();
  const prefix = `INV-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

  const lastInvoice = await prisma.invoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
  });

  let seq = 1;
  if (lastInvoice) {
    const lastSeq = parseInt(lastInvoice.invoiceNumber.split('-').pop(), 10);
    seq = lastSeq + 1;
  }

  return `${prefix}-${String(seq).padStart(4, '0')}`;
};

const logActivity = async (userId, action, entity, entityId, details, ipAddress) => {
  await prisma.activityLog.create({
    data: {
      userId,
      action,
      entity,
      entityId,
      details: typeof details === 'object' ? JSON.stringify(details) : details,
      ipAddress,
    },
  });
};

const paginate = (page = 1, limit = 20) => {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  return { skip: (p - 1) * l, take: l, page: p, limit: l };
};

module.exports = { generateInvoiceNumber, logActivity, paginate };
