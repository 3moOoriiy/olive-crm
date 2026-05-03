const prisma = require('../config/database');

exports.getDashboard = async (req, res, next) => {
  try {
    const branchId = req.user.role !== 'ADMIN' ? req.user.branchId : req.query.branchId;
    const where = branchId ? { branchId } : {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    const [
      totalProducts,
      totalUsers,
      todaySales,
      monthSales,
      totalSoldItems,
      recentInvoices,
      lowStockProducts,
      topProducts,
      totalStockValue,
    ] = await Promise.all([
      prisma.product.count({ where: { isActive: true } }),
      prisma.user.count({ where: { isActive: true } }),
      prisma.invoice.aggregate({
        where: { ...where, type: 'SALE', status: 'COMPLETED', createdAt: { gte: today } },
        _sum: { total: true },
        _count: true,
      }),
      prisma.invoice.aggregate({
        where: { ...where, type: 'SALE', status: 'COMPLETED', createdAt: { gte: monthStart } },
        _sum: { total: true },
        _count: true,
      }),
      // Total items sold this month
      prisma.$queryRaw`
        SELECT CAST(COALESCE(SUM(ii.quantity), 0) AS INTEGER) as count
        FROM invoice_items ii
        JOIN invoices i ON ii."invoiceId" = i.id
        WHERE i.type = 'SALE' AND i.status = 'COMPLETED'
        AND i."createdAt" >= ${monthStart.toISOString()}
      `,
      prisma.invoice.findMany({
        where: { ...where, type: 'SALE' },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          user: { select: { name: true } },
          customer: { select: { name: true } },
        },
      }),
      // Low stock products with details
      prisma.$queryRaw`
        SELECT p.id, p.name, p.sku, p."alertQuantity", bp.quantity,
               p.price, p.cost
        FROM products p
        JOIN branch_products bp ON p.id = bp."productId"
        WHERE bp.quantity <= p."alertQuantity" AND p."isActive" = 1
        ORDER BY bp.quantity ASC
      `,
      prisma.$queryRaw`
        SELECT p.id, p.name, p.sku,
               CAST(SUM(ii.quantity) AS INTEGER) as "totalSold",
               CAST(SUM(ii.total) AS REAL) as "totalRevenue"
        FROM invoice_items ii
        JOIN products p ON ii."productId" = p.id
        JOIN invoices i ON ii."invoiceId" = i.id
        WHERE i.type = 'SALE' AND i.status = 'COMPLETED'
        AND i."createdAt" >= ${monthStart.toISOString()}
        GROUP BY p.id, p.name, p.sku
        ORDER BY "totalSold" DESC
        LIMIT 10
      `,
      // Total stock value
      prisma.$queryRaw`
        SELECT CAST(COALESCE(SUM(bp.quantity), 0) AS INTEGER) as "totalQty",
               CAST(COALESCE(SUM(bp.quantity * p.cost), 0) AS REAL) as "totalValue"
        FROM branch_products bp
        JOIN products p ON bp."productId" = p.id
        WHERE p."isActive" = 1
      `,
    ]);

    res.json({
      stats: {
        totalProducts,
        totalUsers,
        totalStockQty: totalStockValue[0]?.totalQty || 0,
        totalStockValue: totalStockValue[0]?.totalValue || 0,
        todaySalesTotal: todaySales._sum.total || 0,
        todaySalesCount: todaySales._count || 0,
        monthSalesTotal: monthSales._sum.total || 0,
        monthSalesCount: monthSales._count || 0,
        monthSoldItems: totalSoldItems[0]?.count || 0,
        lowStockCount: lowStockProducts.length,
      },
      recentInvoices,
      topProducts,
      lowStockProducts,
    });
  } catch (error) { next(error); }
};

exports.getSalesReport = async (req, res, next) => {
  try {
    const { from, to, branchId, groupBy } = req.query;

    const where = { type: 'SALE', status: 'COMPLETED' };
    if (branchId) where.branchId = branchId;
    if (req.user.role !== 'ADMIN' && req.user.branchId) where.branchId = req.user.branchId;
    if (from) where.createdAt = { ...where.createdAt, gte: new Date(from) };
    if (to) where.createdAt = { ...where.createdAt, lte: new Date(to + 'T23:59:59') };

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        branch: { select: { name: true } },
        items: { include: { product: { select: { name: true, cost: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Calculate totals
    let totalRevenue = 0;
    let totalCost = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    invoices.forEach((inv) => {
      totalRevenue += inv.total;
      totalDiscount += inv.discount;
      totalTax += inv.taxAmount;
      inv.items.forEach((item) => {
        totalCost += (item.product.cost || 0) * item.quantity;
      });
    });

    // Group by date
    const dailySales = {};
    invoices.forEach((inv) => {
      const dateKey = inv.createdAt.toISOString().split('T')[0];
      if (!dailySales[dateKey]) {
        dailySales[dateKey] = { date: dateKey, total: 0, count: 0 };
      }
      dailySales[dateKey].total += inv.total;
      dailySales[dateKey].count += 1;
    });

    res.json({
      summary: {
        totalRevenue,
        totalCost,
        grossProfit: totalRevenue - totalCost,
        totalDiscount,
        totalTax,
        invoiceCount: invoices.length,
      },
      dailySales: Object.values(dailySales),
    });
  } catch (error) { next(error); }
};

exports.getProfitReport = async (req, res, next) => {
  try {
    const { from, to, branchId } = req.query;

    const dateFilter = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) dateFilter.lte = new Date(to + 'T23:59:59');

    const where = {
      type: 'SALE',
      status: 'COMPLETED',
      ...(Object.keys(dateFilter).length ? { createdAt: dateFilter } : {}),
    };
    if (branchId) where.branchId = branchId;
    if (req.user.role !== 'ADMIN' && req.user.branchId) where.branchId = req.user.branchId;

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        items: { include: { product: { select: { cost: true } } } },
        branch: { select: { id: true, name: true } },
      },
    });

    const branchProfits = {};
    invoices.forEach((inv) => {
      const bId = inv.branch.id;
      if (!branchProfits[bId]) {
        branchProfits[bId] = { branchName: inv.branch.name, revenue: 0, cost: 0, profit: 0, invoiceCount: 0 };
      }
      branchProfits[bId].revenue += inv.total;
      branchProfits[bId].invoiceCount += 1;
      inv.items.forEach((item) => {
        branchProfits[bId].cost += (item.product.cost || 0) * item.quantity;
      });
      branchProfits[bId].profit = branchProfits[bId].revenue - branchProfits[bId].cost;
    });

    res.json({ branches: Object.values(branchProfits) });
  } catch (error) { next(error); }
};

exports.getTopProducts = async (req, res, next) => {
  try {
    const { from, to, branchId, limit } = req.query;
    const take = parseInt(limit) || 20;

    let dateFilter = '';
    const params = [];
    if (from) { dateFilter += ` AND i."createdAt" >= ?`; params.push(new Date(from).toISOString()); }
    if (to) { dateFilter += ` AND i."createdAt" <= ?`; params.push(new Date(to + 'T23:59:59').toISOString()); }
    if (branchId) { dateFilter += ` AND i."branchId" = ?`; params.push(branchId); }

    const topProducts = await prisma.$queryRawUnsafe(`
      SELECT p.id, p.name, p.sku,
             CAST(SUM(ii.quantity) AS INTEGER) as "totalSold",
             CAST(SUM(ii.total) AS REAL) as "totalRevenue",
             CAST(SUM(ii.quantity * p.cost) AS REAL) as "totalCost",
             CAST(SUM(ii.total) - SUM(ii.quantity * p.cost) AS REAL) as "profit"
      FROM invoice_items ii
      JOIN products p ON ii."productId" = p.id
      JOIN invoices i ON ii."invoiceId" = i.id
      WHERE i.type = 'SALE' AND i.status = 'COMPLETED'
      ${dateFilter}
      GROUP BY p.id, p.name, p.sku
      ORDER BY "totalSold" DESC
      LIMIT ${take}
    `, ...params);

    res.json(topProducts);
  } catch (error) { next(error); }
};

exports.getLowStock = async (req, res, next) => {
  try {
    const { branchId } = req.query;

    let branchFilter = '';
    const params = [];
    if (branchId) { branchFilter = `AND bp."branchId" = ?`; params.push(branchId); }

    const lowStock = await prisma.$queryRawUnsafe(`
      SELECT p.id, p.name, p.sku, p."alertQuantity", bp.quantity,
             b.name as "branchName", b.id as "branchId"
      FROM products p
      JOIN branch_products bp ON p.id = bp."productId"
      JOIN branches b ON bp."branchId" = b.id
      WHERE bp.quantity <= p."alertQuantity" AND p."isActive" = 1
      ${branchFilter}
      ORDER BY bp.quantity ASC
    `, ...params);

    res.json(lowStock);
  } catch (error) { next(error); }
};

exports.getBranchReport = async (req, res, next) => {
  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      include: {
        _count: { select: { users: true, branchProducts: true, invoices: true } },
      },
    });

    const report = await Promise.all(branches.map(async (branch) => {
      const sales = await prisma.invoice.aggregate({
        where: { branchId: branch.id, type: 'SALE', status: 'COMPLETED' },
        _sum: { total: true },
        _count: true,
      });

      const stockValue = await prisma.$queryRaw`
        SELECT CAST(COALESCE(SUM(bp.quantity * p.cost), 0) AS REAL) as value
        FROM branch_products bp
        JOIN products p ON bp."productId" = p.id
        WHERE bp."branchId" = ${branch.id}
      `;

      return {
        id: branch.id,
        name: branch.name,
        users: branch._count.users,
        products: branch._count.branchProducts,
        totalSales: sales._sum.total || 0,
        invoiceCount: sales._count || 0,
        stockValue: stockValue[0]?.value || 0,
      };
    }));

    res.json(report);
  } catch (error) { next(error); }
};
