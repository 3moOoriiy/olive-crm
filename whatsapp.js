const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const { getDB } = require('./db');

let waSocket = null;
let waStatus = { connected: false, qrCode: null, phoneNumber: null, initializing: false, authenticated: false };
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
  variants.add(digits);
  variants.add(rawPhone);

  if (digits.startsWith('20') && digits.length > 10) {
    variants.add('0' + digits.slice(2));
    variants.add(digits.slice(2));
    variants.add('+' + digits);
  } else if (digits.startsWith('0')) {
    variants.add('20' + digits.slice(1));
    variants.add(digits.slice(1));
    variants.add('+20' + digits.slice(1));
  } else {
    variants.add('0' + digits);
    variants.add('20' + digits);
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

async function initWhatsApp(io) {
  ioRef = io;
  waStatus.initializing = true;
  io.emit('whatsapp:status', { initializing: true });

  try {
    const authDir = path.join(__dirname, 'data', 'wa_auth');
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const logger = pino({ level: 'silent' });

    waSocket = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: ['Olive CRM', 'Chrome', '4.0.0'],
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: false,
    });

    waSocket.ev.on('creds.update', saveCreds);

    waSocket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📱 QR code received - scan with WhatsApp');
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
          waStatus.qrCode = qrDataUrl;
          waStatus.connected = false;
          waStatus.authenticated = false;
          waStatus.initializing = false;
          io.emit('whatsapp:qr', { qrDataUrl });
        } catch (err) {
          console.error('QR generation error:', err);
        }
      }

      if (connection === 'open') {
        console.log('✅ WhatsApp connected!');
        waStatus.connected = true;
        waStatus.authenticated = true;
        waStatus.initializing = false;
        waStatus.qrCode = null;
        waStatus.phoneNumber = waSocket.user?.id?.split(':')[0] || waSocket.user?.id?.split('@')[0] || '';
        io.emit('whatsapp:ready', { phoneNumber: waStatus.phoneNumber });
      }

      if (connection === 'close') {
        waStatus.connected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        console.log(`🔌 WhatsApp disconnected (code: ${statusCode}). Reconnect: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => {
            console.log('🔄 Attempting WhatsApp reconnection...');
            initWhatsApp(io);
          }, 3000);
        } else {
          waStatus.authenticated = false;
          waStatus.qrCode = null;
          // Clear auth data so fresh QR is generated next time
          try {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log('🗑️ Auth data cleared for fresh login');
          } catch(e) {}
          io.emit('whatsapp:disconnected', { reason: 'logged_out' });
        }
      }
    });

    // Handle incoming messages
    waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        try {
          if (msg.key.fromMe) continue;
          const jid = msg.key.remoteJid;
          if (!jid || jid.includes('@g.us') || jid === 'status@broadcast') continue;

          const rawPhone = jid.replace(/@.+$/, '');
          const text = msg.message?.conversation
            || msg.message?.extendedTextMessage?.text
            || '';
          if (!text.trim()) continue;

          const contactName = msg.pushName || rawPhone;
          const waId = jid;

          const db = getDB();

          // Smart matching - try wa_id first, then phone variants
          let customer = null;

          // Also try old @c.us format for backward compatibility
          if (waId) {
            customer = db.get('SELECT * FROM customers WHERE wa_id = ?', [waId]);
            if (!customer) {
              const oldFormatId = rawPhone + '@c.us';
              customer = db.get('SELECT * FROM customers WHERE wa_id = ?', [oldFormatId]);
            }
          }

          if (!customer) {
            customer = findCustomerByPhone(db, rawPhone);
          }

          // Update wa_id for matched customer
          if (customer && customer.wa_id !== waId) {
            db.run('UPDATE customers SET wa_id = ? WHERE id = ?', [waId, customer.id]);
            console.log(`🔗 Linked wa_id ${waId} to customer #${customer.id} (${customer.name})`);
          }

          let isNew = false;
          if (!customer) {
            isNew = true;
            let storePhone = rawPhone;
            if (storePhone.startsWith('20') && storePhone.length > 10) storePhone = '0' + storePhone.slice(2);
            const result = db.run(`
              INSERT INTO customers (name, phone, source, status, wa_id, last_contact, created_at)
              VALUES (?, ?, 'واتساب', 'first_attempt', ?, datetime('now'), datetime('now'))
            `, [contactName, storePhone, waId]);

            customer = db.get('SELECT * FROM customers WHERE id = ?', [result.lastInsertRowid]);

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
          `, [customer.id, msg.key.id || '', text, contactName]);

          db.run('UPDATE customers SET last_contact = datetime("now") WHERE id = ?', [customer.id]);

          db.run(`
            INSERT INTO timeline (customer_id, type, text, icon, user_name, created_at)
            VALUES (?, 'whatsapp', ?, '📩', ?, datetime('now'))
          `, [customer.id, 'رسالة واردة: ' + text.substring(0, 50), contactName]);

          const message = db.get('SELECT * FROM messages WHERE id = ?', [msgResult.lastInsertRowid]);
          io.emit('message:new', {
            customerId: customer.id,
            customerName: customer.name,
            customerPhone: customer.phone,
            message,
            isNewCustomer: isNew
          });

          console.log(`📩 Message from ${waId} (${contactName}): ${text.substring(0, 50)}`);
        } catch (err) {
          console.error('Error handling incoming message:', err);
        }
      }
    });

    console.log('🔄 Initializing WhatsApp client...');

  } catch (err) {
    console.error('WhatsApp initialization error:', err);
    console.log('⚠️  WhatsApp will not be available. You can still use the CRM without it.');
    waStatus.initializing = false;
    io.emit('whatsapp:status', { initializing: false, error: 'فشل تشغيل الواتساب. تحقق من إعدادات السيرفر' });
  }
}

async function sendMessage(phone, text) {
  if (!waSocket || !waStatus.connected) {
    throw new Error('واتساب غير متصل. اربط الواتساب من الإعدادات أولاً');
  }

  // Normalize phone to international format without +
  let cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.startsWith('0')) cleanPhone = '20' + cleanPhone.slice(1);
  if (!cleanPhone.startsWith('20')) cleanPhone = '20' + cleanPhone;

  const jid = cleanPhone + '@s.whatsapp.net';

  try {
    const [result] = await waSocket.onWhatsApp(jid);
    if (!result || !result.exists) {
      throw new Error('هذا الرقم غير مسجل على واتساب');
    }
    const sent = await waSocket.sendMessage(jid, { text });
    return sent;
  } catch (err) {
    console.error('Send message error:', err);
    const msg = err.message || String(err);
    if (msg.includes('غير مسجل') || msg.includes('غير متصل')) throw err;
    throw new Error('فشل إرسال الرسالة. تأكد من اتصال الواتساب');
  }
}

function getStatus() {
  return { ...waStatus };
}

function getClient() {
  return waSocket;
}

module.exports = { initWhatsApp, sendMessage, getStatus, getClient };
