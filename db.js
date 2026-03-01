const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'olive-crm.db');
let db;
let saveTimer;

async function initDB() {
  const SQL = await initSqlJs();

  // Load existing DB or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'call_center',
      avatar_initials TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#6366f1',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      phone2 TEXT DEFAULT '',
      region TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'first_attempt',
      assigned_to INTEGER REFERENCES users(id),
      notes TEXT DEFAULT '',
      follow_up_date TEXT,
      last_contact TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Migrations
  try { db.run(`ALTER TABLE customers ADD COLUMN address TEXT DEFAULT ''`); } catch(e) {}
  try { db.run(`ALTER TABLE customers ADD COLUMN updated_at TEXT`); } catch(e) {}
  try { db.run(`ALTER TABLE customers ADD COLUMN updated_by INTEGER REFERENCES users(id)`); } catch(e) {}
  try { db.run(`ALTER TABLE customers ADD COLUMN updated_by_name TEXT DEFAULT ''`); } catch(e) {}
  try { db.run(`ALTER TABLE customers ADD COLUMN wa_id TEXT DEFAULT ''`); } catch(e) {}
  try { db.run(`ALTER TABLE customers ADD COLUMN wa_lid TEXT DEFAULT ''`); } catch(e) {}

  db.run(`CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_customers_assigned ON customers(assigned_to)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_customers_wa_id ON customers(wa_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_customers_wa_lid ON customers(wa_lid)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      text TEXT NOT NULL,
      detail TEXT DEFAULT '',
      result TEXT DEFAULT '',
      call_type TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      user_name TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_timeline_customer ON timeline(customer_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      price REAL NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'جديد',
      address TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id)`);

  // Orders migrations for moderator fields
  try { db.run(`ALTER TABLE orders ADD COLUMN moderator_code TEXT DEFAULT ''`); } catch(e) {}
  try { db.run(`ALTER TABLE orders ADD COLUMN moderator_name TEXT DEFAULT ''`); } catch(e) {}
  try { db.run(`ALTER TABLE orders ADD COLUMN instapay_image TEXT DEFAULT ''`); } catch(e) {}
  try { db.run(`ALTER TABLE orders ADD COLUMN created_by INTEGER REFERENCES users(id)`); } catch(e) {}

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      wa_message_id TEXT DEFAULT '',
      direction TEXT NOT NULL,
      text TEXT NOT NULL,
      media_url TEXT DEFAULT '',
      user_name TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_customer ON messages(customer_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_customer_dir ON messages(customer_id, direction, created_at)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS wa_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER REFERENCES customers(id),
      shipment_number TEXT DEFAULT '',
      complaint_number TEXT DEFAULT '',
      complaint_type TEXT NOT NULL DEFAULT '',
      feedback TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_by INTEGER REFERENCES users(id),
      created_by_name TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_complaints_status ON complaints(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_complaints_customer ON complaints(customer_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS staff_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id INTEGER NOT NULL REFERENCES users(id),
      to_user_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_staff_msg_pair ON staff_messages(from_user_id, to_user_id, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_staff_msg_unread ON staff_messages(to_user_id, is_read)`);

  // Migrate old role names: agent → call_center (idempotent)
  try { db.run("UPDATE users SET role = 'call_center' WHERE role = 'agent'"); } catch(e) {}

  // One-time cleanup: merge duplicate customers with same normalized phone
  mergeDuplicateCustomers();
  // ✅ Seed default admin (first run only)
try {
  const stmt = db.prepare("SELECT id FROM users WHERE email = ?");
  stmt.bind(["admin@crm.com"]);
  const exists = stmt.step();
  stmt.free();

  if (!exists) {
    const hash = bcrypt.hashSync("123", 10);

    db.run(
      `INSERT INTO users (name, email, password_hash, role, avatar_initials, color, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      ["Admin", "admin@crm.com", hash, "admin", "AD", "#16a34a"]
    );

    console.log("✅ Seeded default admin: admin@crm.com / 123");
  }
} catch (e) {
  console.error("Admin seed error:", e.message);
}

  saveDB();
  return db;
}

function mergeDuplicateCustomers() {
  try {
    // Find all customers with messages, grouped by normalized phone
    const stmt = db.prepare("SELECT id, name, phone, phone2, wa_id, source, created_at FROM customers ORDER BY created_at ASC");
    const customers = [];
    while (stmt.step()) customers.push(stmt.getAsObject());
    stmt.free();

    // Group by normalized phone (last 9 digits)
    const phoneGroups = {};
    for (const c of customers) {
      const digits = (c.phone || '').replace(/\D/g, '');
      if (digits.length < 9) continue;
      const key = digits.slice(-9);
      if (!phoneGroups[key]) phoneGroups[key] = [];
      phoneGroups[key].push(c);
    }

    let mergeCount = 0;
    for (const [key, group] of Object.entries(phoneGroups)) {
      if (group.length <= 1) continue;

      // Keep the first (oldest) customer, merge others into it
      const keep = group[0];
      const dupes = group.slice(1);

      for (const dupe of dupes) {
        // Move messages to the kept customer
        db.run("UPDATE messages SET customer_id = ? WHERE customer_id = ?", [keep.id, dupe.id]);
        // Move timeline entries
        db.run("UPDATE timeline SET customer_id = ? WHERE customer_id = ?", [keep.id, dupe.id]);
        // Move orders
        db.run("UPDATE orders SET customer_id = ? WHERE customer_id = ?", [keep.id, dupe.id]);
        // Copy wa_id if the kept one doesn't have it
        if (!keep.wa_id && dupe.wa_id) {
          db.run("UPDATE customers SET wa_id = ? WHERE id = ?", [dupe.wa_id, keep.id]);
          keep.wa_id = dupe.wa_id;
        }
        // Delete the duplicate
        db.run("DELETE FROM customers WHERE id = ?", [dupe.id]);
        mergeCount++;
        console.log(`🔀 Merged duplicate customer #${dupe.id} (${dupe.name}) → #${keep.id} (${keep.name})`);
      }
    }

    if (mergeCount > 0) {
      console.log(`✅ Merged ${mergeCount} duplicate customer(s)`);
    }
  } catch (e) {
    console.error('Merge duplicates error:', e.message);
  }
}

// Helper: convert sql.js result to array of objects
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function get(sql, params = []) {
  const results = all(sql, params);
  return results[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
  return {
    lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0],
    changes: db.getRowsModified()
  };
}

// Save DB to disk - reduced to 100ms for safety
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDB, 100);
}

function saveDB() {
  if (!db) return;
  try {
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  } catch (e) {
    console.error('Failed to save DB:', e);
  }
}

function normalizePhone(phone) {
  if (!phone) return '';
  let p = phone.replace(/[\s\-\+\(\)]/g, '');
  if (p.startsWith('0020')) p = p.slice(2);
  else if (p.startsWith('0')) p = '20' + p.slice(1);
  else if (!p.startsWith('20')) p = '20' + p;
  return p;
}

function getDB() {
  return { all, get, run, raw: db, saveDB };
}

module.exports = { initDB, getDB, normalizePhone };
