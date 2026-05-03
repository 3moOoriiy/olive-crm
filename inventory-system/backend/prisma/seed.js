const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create single main branch
  const mainBranch = await prisma.branch.upsert({
    where: { name: 'المخزن الرئيسي' },
    update: {},
    create: { name: 'المخزن الرئيسي', address: 'المقر الرئيسي', phone: '01000000001' },
  });

  console.log('✅ Branch created');

  // Create admin user (assigned to main branch)
  const hashedPassword = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@inventory.com' },
    update: { branchId: mainBranch.id },
    create: {
      name: 'مدير النظام',
      email: 'admin@inventory.com',
      password: hashedPassword,
      role: 'ADMIN',
      phone: '01000000000',
      branchId: mainBranch.id,
    },
  });

  // Create cashier
  const cashierPassword = await bcrypt.hash('cashier123', 12);
  await prisma.user.upsert({
    where: { email: 'cashier@inventory.com' },
    update: { branchId: mainBranch.id },
    create: {
      name: 'كاشير',
      email: 'cashier@inventory.com',
      password: cashierPassword,
      role: 'CASHIER',
      branchId: mainBranch.id,
    },
  });

  console.log('✅ Users created');

  // Create categories
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

  console.log('✅ Categories created');

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

    // Add stock to main branch
    await prisma.branchProduct.upsert({
      where: { branchId_productId: { branchId: mainBranch.id, productId: product.id } },
      update: {},
      create: { branchId: mainBranch.id, productId: product.id, quantity: 0 },
    });
  }

  console.log(`✅ ${products.length} products created`);

  // Create sample customer
  await prisma.customer.upsert({
    where: { id: 'seed-customer-1' },
    update: {},
    create: { id: 'seed-customer-1', name: 'عميل تجريبي', phone: '01000000099', email: 'customer@test.com' },
  });

  console.log('✅ Sample customer created');
  console.log('\n🎉 Seed completed!\n');
  console.log('📧 Admin login: admin@inventory.com / admin123');
  console.log('📧 Cashier login: cashier@inventory.com / cashier123\n');
}

main()
  .catch((e) => { console.error('❌ Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
