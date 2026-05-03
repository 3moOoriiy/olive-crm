const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Adding new categories and products...');

  // Get the main branch
  const branch = await prisma.branch.findFirst();
  if (!branch) { console.error('No branch found!'); return; }

  // Create new categories
  const catPackaging = await prisma.category.upsert({
    where: { name: 'عبوات' },
    update: {},
    create: { name: 'عبوات', description: 'عبوات بلاستيك وصفيح' },
  });

  const catStickers = await prisma.category.upsert({
    where: { name: 'استيكرات' },
    update: {},
    create: { name: 'استيكرات', description: 'استيكرات للعبوات' },
  });

  const catSupplies = await prisma.category.upsert({
    where: { name: 'مستلزمات تغليف' },
    update: {},
    create: { name: 'مستلزمات تغليف', description: 'شرينك وكراتين ودوباره وقماش' },
  });

  console.log('Categories created');

  // All products
  const products = [
    // عبوات بلاستيك زيت
    { name: 'بلاستيك ربع لتر', sku: 'PKG-PL-250', price: 0, cost: 0, categoryId: catPackaging.id, unit: 'piece', alertQuantity: 50 },
    { name: 'بلاستيك نص لتر', sku: 'PKG-PL-500', price: 0, cost: 0, categoryId: catPackaging.id, unit: 'piece', alertQuantity: 50 },
    { name: 'بلاستيك لتر', sku: 'PKG-PL-1000', price: 0, cost: 0, categoryId: catPackaging.id, unit: 'piece', alertQuantity: 50 },
    // صفيح
    { name: 'صفيح نص لتر', sku: 'PKG-TN-500', price: 0, cost: 0, categoryId: catPackaging.id, unit: 'piece', alertQuantity: 50 },
    { name: 'صفيح لتر', sku: 'PKG-TN-1000', price: 0, cost: 0, categoryId: catPackaging.id, unit: 'piece', alertQuantity: 50 },
    // عبوات عسل
    { name: 'بلاستيك عسل كيلو', sku: 'PKG-HN-1000', price: 0, cost: 0, categoryId: catPackaging.id, unit: 'piece', alertQuantity: 30 },
    { name: 'بلاستيك عسل نص كيلو', sku: 'PKG-HN-500', price: 0, cost: 0, categoryId: catPackaging.id, unit: 'piece', alertQuantity: 30 },

    // استيكرات بلاستيك زيت
    { name: 'استيكر بلاستيك ربع لتر', sku: 'STK-PL-250', price: 0, cost: 0, categoryId: catStickers.id, unit: 'piece', alertQuantity: 50 },
    { name: 'استيكر بلاستيك نص لتر', sku: 'STK-PL-500', price: 0, cost: 0, categoryId: catStickers.id, unit: 'piece', alertQuantity: 50 },
    { name: 'استيكر بلاستيك لتر', sku: 'STK-PL-1000', price: 0, cost: 0, categoryId: catStickers.id, unit: 'piece', alertQuantity: 50 },
    // استيكرات صفيح
    { name: 'استيكر صفيح نص لتر', sku: 'STK-TN-500', price: 0, cost: 0, categoryId: catStickers.id, unit: 'piece', alertQuantity: 50 },
    { name: 'استيكر صفيح لتر', sku: 'STK-TN-1000', price: 0, cost: 0, categoryId: catStickers.id, unit: 'piece', alertQuantity: 50 },
    // استيكرات عسل
    { name: 'استيكر عسل نص كيلو', sku: 'STK-HN-500', price: 0, cost: 0, categoryId: catStickers.id, unit: 'piece', alertQuantity: 30 },
    { name: 'استيكر عسل كيلو', sku: 'STK-HN-1000', price: 0, cost: 0, categoryId: catStickers.id, unit: 'piece', alertQuantity: 30 },

    // شرينك
    { name: 'شرينك ربع لتر', sku: 'SHR-250', price: 0, cost: 0, categoryId: catSupplies.id, unit: 'piece', alertQuantity: 50 },
    { name: 'شرينك نص لتر', sku: 'SHR-500', price: 0, cost: 0, categoryId: catSupplies.id, unit: 'piece', alertQuantity: 50 },
    { name: 'شرينك لتر', sku: 'SHR-1000', price: 0, cost: 0, categoryId: catSupplies.id, unit: 'piece', alertQuantity: 50 },

    // كراتين
    { name: 'كراتين ربع لتر', sku: 'CRT-250', price: 0, cost: 0, categoryId: catSupplies.id, unit: 'piece', alertQuantity: 30 },
    { name: 'كراتين نص لتر', sku: 'CRT-500', price: 0, cost: 0, categoryId: catSupplies.id, unit: 'piece', alertQuantity: 30 },
    { name: 'كراتين لتر', sku: 'CRT-1000', price: 0, cost: 0, categoryId: catSupplies.id, unit: 'piece', alertQuantity: 30 },

    // مستلزمات أخرى
    { name: 'دوباره', sku: 'SUP-ROPE', price: 0, cost: 0, categoryId: catSupplies.id, unit: 'piece', alertQuantity: 20 },
    { name: 'قماشه لتغطيه العسل', sku: 'SUP-CLOTH', price: 0, cost: 0, categoryId: catSupplies.id, unit: 'piece', alertQuantity: 20 },
  ];

  for (const p of products) {
    const product = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: p,
    });

    // Add initial stock (0) to the branch
    await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId: branch.id, productId: product.id } },
      update: {},
      create: { branchId: branch.id, productId: product.id, quantity: 0 },
    });

    console.log(`  + ${p.name}`);
  }

  console.log(`\nDone! ${products.length} products added.`);
}

main()
  .catch((e) => { console.error('Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
