require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDB, getDB } = require('./db');

async function seed() {
  await initDB();
  const db = getDB();

  console.log('🌱 Seeding database...');

  // Check if already seeded
  const userCount = db.get('SELECT COUNT(*) as c FROM users');
  if (userCount && userCount.c > 0) {
    console.log('⚠️  Database already has data. Skipping seed.');
    process.exit(0);
  }

  const hash = bcrypt.hashSync('123', 10);

  // ═══════════════ USERS ═══════════════
  const users = [
    ['أحمد محمد', 'admin@crm.com', hash, 'admin', 'أح', '#6366f1'],
    ['سارة علي', 'sup@crm.com', hash, 'supervisor', 'سع', '#0ea5e9'],
    ['محمد خالد', 'agent1@crm.com', hash, 'agent', 'مخ', '#10b981'],
    ['فاطمة حسن', 'agent2@crm.com', hash, 'agent', 'فح', '#f59e0b'],
    ['عمر إبراهيم', 'agent3@crm.com', hash, 'agent', 'عإ', '#8b5cf6'],
    ['نور عبدالله', 'agent4@crm.com', hash, 'agent', 'نع', '#ef4444'],
  ];

  for (const u of users) {
    db.run(`INSERT INTO users (name, email, password_hash, role, avatar_initials, color) VALUES (?, ?, ?, ?, ?, ?)`, u);
  }
  console.log(`✅ ${users.length} users created`);

  // ═══════════════ PRODUCTS ═══════════════
  const products = [
    ['زيت زيتون بكر ممتاز 250مل', 45],
    ['زيت زيتون بكر ممتاز 500مل', 80],
    ['زيت زيتون بكر ممتاز 750مل', 115],
    ['زيت زيتون بكر ممتاز 1 لتر', 140],
    ['زيت زيتون بكر ممتاز 2 لتر', 260],
    ['زيت زيتون بكر ممتاز 5 لتر', 600],
  ];

  for (const p of products) {
    db.run('INSERT INTO products (name, price) VALUES (?, ?)', p);
  }
  console.log(`✅ ${products.length} products created`);

  // ═══════════════ WA TEMPLATES ═══════════════
  const templates = [
    ['ترحيب', 'مرحباً بكم 🫒 نحن سعداء بتواصلكم معنا. كيف يمكنني مساعدتكم اليوم؟'],
    ['متابعة طلب', 'نود الاطمئنان على طلبكم الكريم. هل تم وصول المنتج بشكل سليم؟ يسعدنا معرفة تجربتكم 😊'],
    ['عرض خاص', '🌿 عرض حصري! خصم 20% على زيت الزيتون البكر الممتاز لفترة محدودة. لا تفوتوا الفرصة! 🫒'],
    ['تأكيد طلب', 'تم استلام طلبكم بنجاح ✅ وسيتم شحنه خلال 24-48 ساعة. شكراً لثقتكم بنا!'],
    ['حاولنا التواصل', 'حاولنا التواصل معكم عدة مرات 📞 نأمل أن تكونوا بخير. يسعدنا خدمتكم في أي وقت 🌿'],
  ];

  for (const t of templates) {
    db.run('INSERT INTO wa_templates (name, text) VALUES (?, ?)', t);
  }
  console.log(`✅ ${templates.length} WA templates created`);

  // Force save to disk before exiting
  db.saveDB();

  console.log('\n🎉 Database seeded successfully!');
  console.log('📧 Login credentials:');
  console.log('   admin@crm.com / 123');
  console.log('   sup@crm.com / 123');
  console.log('   agent1@crm.com - agent4@crm.com / 123');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
