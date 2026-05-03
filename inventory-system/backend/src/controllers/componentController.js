const prisma = require('../config/database');
const { logActivity } = require('../utils/helpers');

// Get components for a product
exports.getComponents = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const components = await prisma.productComponent.findMany({
      where: { productId },
      include: {
        component: { select: { id: true, name: true, sku: true, unit: true } },
      },
    });
    res.json(components);
  } catch (error) { next(error); }
};

// Set components for a product (replace all)
exports.setComponents = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const { components } = req.body; // [{ componentId, quantity }]

    // Validate product exists
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) return res.status(404).json({ message: 'المنتج غير موجود' });

    // Prevent self-reference
    const selfRef = components?.find(c => c.componentId === productId);
    if (selfRef) return res.status(400).json({ message: 'لا يمكن إضافة المنتج كمكون لنفسه' });

    await prisma.$transaction(async (tx) => {
      // Delete existing components
      await tx.productComponent.deleteMany({ where: { productId } });

      // Create new ones
      if (components && components.length > 0) {
        await tx.productComponent.createMany({
          data: components.map(c => ({
            productId,
            componentId: c.componentId,
            quantity: c.quantity || 1,
          })),
        });
      }
    });

    await logActivity(req.user.id, 'SET_COMPONENTS', 'Product', productId, { count: components?.length || 0 }, req.ip);

    // Return updated components
    const updated = await prisma.productComponent.findMany({
      where: { productId },
      include: {
        component: { select: { id: true, name: true, sku: true, unit: true } },
      },
    });
    res.json(updated);
  } catch (error) { next(error); }
};

// Get all products that have components (for overview)
exports.getProductsWithComponents = async (req, res, next) => {
  try {
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        components: { some: {} },
      },
      include: {
        components: {
          include: {
            component: { select: { id: true, name: true, sku: true, unit: true } },
          },
        },
        category: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
    res.json(products);
  } catch (error) { next(error); }
};
