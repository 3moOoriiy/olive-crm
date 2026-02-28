const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const path = require('path');
const { getDB, normalizePhone } = require('./db');

let waClient = null;
let waStatus = { connected: false, qrCode: null, phoneNumber: null, initializing: false };
let ioRef = null;

/**
 * Smart phone matching - tries multiple phone formats to find a customer
 * Handles: Egyptian local (01xxx), international (201xxx), raw WhatsApp IDs
 */
function findCustomerByPhone(db, rawPhone) {
  if (!rawPhone) return null;

  // Clean: keep digits only
  const digits = rawPhone.replace(/\D/g, '');

  // Build all possible phone variants
  const variants = new Set();
  variants.add(digits);                        // raw digits: 201506669573
  variants.add(rawPhone);                      // original as-is

  if (digits.startsWith('20') && digits.length > 10) {
    variants.add('0' + digits.slice(2));       // local: 01506669573
    variants.add(digits.slice(2));             // without country & zero: 1506669573
    variants.add('+' + digits);               // +201506669573
  } else if (digits.startsWith('0')) {
    variants.add('20' + digits.slice(1));      // international: 201506669573
    variants.add(digits.slice(1));             // without zero: 1506669573
    variants.add('+20' + digits.slice(1));     // +201506669573
  } else {
    variants.add('0' + digits);               // add leading zero
    variants.add('20' + digits);              // add country code
  }

  // Try exact match with each variant
  for (const v of variants) {
    const c = db.get('SELECT * FROM customers WHERE phone = ?', [v]);
    if (c) return c;
  }

  // Try phone2 as well
  for (const v of variants) {
    const c = db.get('SELECT * FROM customers WHERE phone2 = ?', [v]);
    if (c) return c;
  }

  // Last resort: fuzzy match on last 9 digits
  if (digits.length >= 9) {
    const last9 = digits.slice(-9);
    const c = db.get("SELECT * FROM customers WHERE phone LIKE ? OR phone2 LIKE ?", ['%' + last9, '%' + last9]);
    if (c) return c;
  }

  return null;
}

function initWhatsApp(io) {
  ioRef = io;

  const puppeteerOpts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-gpu',
      '--single-process',
      '--no-zygote',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--disable-default-apps',
      '--mute-audio',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--no-default-browser-check',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--disable-domain-reliability',
      '--disable-component-update',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-ipc-flooding-protection',
      '--js-flags=--max-old-space-size=256'
    ]
  };

  // On Render/production: use system-installed Chromium
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    puppeteerOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  waClient = new Client({
    authStrategy: new LocalAuth({
      dataPath: path.join(__dirname, 'data', '.wwebjs_auth'),
      clientId: 'olive-crm'
    }),
    puppeteer: puppeteerOpts
  });

  waClient.on('qr', async (qr) => {
    console.log('📱 QR code received - scan with WhatsApp');
    try {
      const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
      waStatus.qrCode = qrDataUrl;
      waStatus.connected = false;
      io.emit('whatsapp:qr', { qrDataUrl });
    } catch (err) {
      console.error('QR generation error:', err);
    }
  });

  waClient.on('ready', () => {
    console.log('✅ WhatsApp connected!');
    waStatus.connected = true;
    waStatus.qrCode = null;
    const info = waClient.info;
    waStatus.phoneNumber = info ? info.wid.user : '';
    io.emit('whatsapp:ready', { phoneNumber: waStatus.phoneNumber });
  });

  waClient.on('authenticated', () => {
    console.log('🔐 WhatsApp authenticated');
  });

  waClient.on('auth_failure', (msg) => {
    console.error('❌ WhatsApp auth failure:', msg);
    waStatus.connected = false;
    waStatus.qrCode = null;
    io.emit('whatsapp:disconnected', { reason: 'auth_failure' });
  });

  waClient.on('disconnected', (reason) => {
    console.log('🔌 WhatsApp disconnected:', reason);
    waStatus.connected = false;
    waStatus.qrCode = null;
    io.emit('whatsapp:disconnected', { reason });
    // Try to reconnect after a delay
    setTimeout(() => {
      console.log('🔄 Attempting WhatsApp reconnection...');
      waClient.initialize().catch(err => console.error('Reconnect failed:', err));
    }, 5000);
  });

  // Handle incoming messages
  waClient.on('message', async (msg) => {
    // Skip group messages, status updates, and own messages
    if (msg.from.includes('@g.us') || msg.from === 'status@broadcast' || msg.fromMe) return;

    const waId = msg.from; // Full WhatsApp ID: 201xxx@c.us or xxx@lid
    // Strip ALL WhatsApp suffixes: @c.us, @s.whatsapp.net, @lid, etc.
    const rawPhone = msg.from.replace(/@.+$/, '');
    const text = msg.body || '';
    if (!text.trim()) return; // Skip empty/media-only messages for now

    const db = getDB();

    try {
      // Step 1: Try to get actual phone number from WhatsApp contact
      let actualPhone = rawPhone;
      try {
        const contact = await msg.getContact();
        if (contact && contact.number) {
          actualPhone = contact.number;
        }
      } catch(e) {
        console.log('Could not get contact info, using raw phone:', rawPhone);
      }

      // Step 2: Smart matching - try wa_id first, then phone variants
      let customer = null;

      // 2a: Match by WhatsApp ID (most reliable for repeat messages)
      if (waId) {
        customer = db.get('SELECT * FROM customers WHERE wa_id = ?', [waId]);
      }

      // 2b: Match by actual phone number from contact
      if (!customer && actualPhone) {
        customer = findCustomerByPhone(db, actualPhone);
      }

      // 2c: Match by raw phone (fallback if actualPhone == rawPhone didn't work with different format)
      if (!customer && actualPhone !== rawPhone) {
        customer = findCustomerByPhone(db, rawPhone);
      }

      // Step 3: Always update wa_id for matched customer (so next time it matches instantly)
      if (customer && customer.wa_id !== waId) {
        db.run('UPDATE customers SET wa_id = ? WHERE id = ?', [waId, customer.id]);
        console.log(`🔗 Linked wa_id ${waId} to customer #${customer.id} (${customer.name})`);
      }

      let isNew = false;
      if (!customer) {
        isNew = true;
        // Auto-create new customer from WhatsApp
        const contactName = msg._data?.notifyName || actualPhone;
        // Store phone in local format (with leading 0)
        let storePhone = actualPhone;
        if (storePhone.startsWith('20') && storePhone.length > 10) storePhone = '0' + storePhone.slice(2);
        const result = db.run(`
          INSERT INTO customers (name, phone, source, status, wa_id, last_contact, created_at)
          VALUES (?, ?, 'واتساب', 'first_attempt', ?, datetime('now'), datetime('now'))
        `, [contactName, storePhone, waId]);

        customer = db.get('SELECT * FROM customers WHERE id = ?', [result.lastInsertRowid]);

        // Add timeline entry for auto-creation
        db.run(`
          INSERT INTO timeline (customer_id, type, text, icon, user_name, created_at)
          VALUES (?, 'created', 'تم إنشاء العميل تلقائياً من رسالة واتساب', '📱', 'النظام', datetime('now'))
        `, [customer.id]);

        console.log(`📱 New customer auto-created: ${contactName} (${storePhone}) wa_id=${waId}`);
      }

      // Save incoming message
      const msgResult = db.run(`
        INSERT INTO messages (customer_id, wa_message_id, direction, text, user_name, created_at)
        VALUES (?, ?, 'in', ?, ?, datetime('now'))
      `, [customer.id, msg.id?._serialized || '', text, msg._data?.notifyName || actualPhone]);

      // Update last contact
      db.run('UPDATE customers SET last_contact = datetime("now") WHERE id = ?', [customer.id]);

      // Add timeline entry
      db.run(`
        INSERT INTO timeline (customer_id, type, text, icon, user_name, created_at)
        VALUES (?, 'whatsapp', ?, '📩', ?, datetime('now'))
      `, [customer.id, 'رسالة واردة: ' + text.substring(0, 50), msg._data?.notifyName || actualPhone]);

      // Emit to all connected clients
      const message = db.get('SELECT * FROM messages WHERE id = ?', [msgResult.lastInsertRowid]);
      io.emit('message:new', {
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        message,
        isNewCustomer: isNew
      });

      console.log(`📩 Message from ${waId} → phone:${actualPhone} (matched: ${customer.name} #${customer.id}): ${text.substring(0, 50)}`);
    } catch (err) {
      console.error('Error handling incoming message:', err);
    }
  });

  // Initialize the client
  console.log('🔄 Initializing WhatsApp client...');
  waStatus.initializing = true;
  io.emit('whatsapp:status', { initializing: true });
  waClient.initialize().then(() => {
    waStatus.initializing = false;
  }).catch(err => {
    console.error('WhatsApp initialization error:', err);
    console.log('⚠️  WhatsApp will not be available. You can still use the CRM without it.');
    waStatus.initializing = false;
    io.emit('whatsapp:status', { initializing: false, error: 'فشل تشغيل الواتساب. تحقق من إعدادات السيرفر' });
  });
}

async function sendMessage(phone, text) {
  if (!waClient || !waStatus.connected) {
    throw new Error('واتساب غير متصل. اربط الواتساب من الإعدادات أولاً');
  }
  const chatId = phone + '@c.us';
  try {
    // Check if number is registered on WhatsApp
    const isRegistered = await waClient.isRegisteredUser(chatId).catch(() => null);
    if (isRegistered === false) {
      throw new Error('هذا الرقم غير مسجل على واتساب');
    }
    const result = await waClient.sendMessage(chatId, text);
    return result;
  } catch (err) {
    console.error('Send message error:', err);
    // Provide user-friendly Arabic error messages
    const msg = err.message || String(err);
    if (msg.includes('غير مسجل') || msg.includes('غير متصل')) throw err;
    if (msg.includes('No LID') || msg.includes('not found')) {
      throw new Error('الرقم غير موجود على واتساب أو الاتصال منقطع. جرب إعادة ربط الواتساب');
    }
    throw new Error('فشل إرسال الرسالة. تأكد من اتصال الواتساب');
  }
}

function getStatus() {
  return { ...waStatus };
}

function getClient() {
  return waClient;
}

module.exports = { initWhatsApp, sendMessage, getStatus, getClient };
