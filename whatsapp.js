const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
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
    console.log('📂 Auth directory ready:', authDir);

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    console.log('🔑 Auth state loaded. Has creds:', !!state.creds?.me);

    const logger = pino({ level: 'warn' });

    console.log('🔌 Fetching latest WA version...');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    console.log(`📦 WA version: ${version} (latest: ${isLatest})`);

    // Close old socket if exists (prevent duplicate listeners)
    if (waSocket) {
      try { waSocket.end(undefined); } catch(e) {}
      waSocket = null;
    }

    console.log('🔌 Creating WhatsApp socket...');
    waSocket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      printQRInTerminal: false,
      logger,
      browser: Browsers.ubuntu('Chrome'),
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      retryRequestDelayMs: 2000,
      defaultQueryTimeoutMs: 30000,
    });
    console.log('✅ WhatsApp socket created, waiting for connection...');

    waSocket.ev.on('creds.update', saveCreds);

    waSocket.ev.on('connection.update', async (update) => {
      console.log('🔄 Connection update:', JSON.stringify(update).substring(0, 200));
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📱 QR code received - scan with WhatsApp');
        try {
          const qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
          waStatus.qrCode = qrDataUrl;
          waStatus.connected = false;
          waStatus.authenticated = false;
          waStatus.initializing = false;
          waStatus.qrTimestamp = Date.now();
          io.emit('whatsapp:qr', { qrDataUrl });
          console.log(`📱 QR emitted to ${io.engine?.clientsCount || '?'} clients`);
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
          waStatus.initializing = true;
          io.emit('whatsapp:status', { initializing: true });
          const delay = statusCode === 515 ? 1000 : 3000; // faster retry for stream errors
          setTimeout(() => {
            console.log('🔄 Attempting WhatsApp reconnection...');
            initWhatsApp(io);
          }, delay);
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
          const isLid = jid.endsWith('@lid');

          console.log(`📩 Incoming: jid=${jid} pushName=${msg.pushName} isLid=${isLid}`);

          const db = getDB();

          // Smart matching - try multiple strategies to find customer
          let customer = null;

          // 1. Match by exact wa_id
          customer = db.get('SELECT * FROM customers WHERE wa_id = ?', [waId]);

          // 2. Match by wa_lid (secondary WhatsApp ID)
          if (!customer) {
            customer = db.get('SELECT * FROM customers WHERE wa_lid = ?', [waId]);
          }

          // 3. Try old @c.us and @s.whatsapp.net formats
          if (!customer) {
            customer = db.get('SELECT * FROM customers WHERE wa_id = ? OR wa_id = ? OR wa_lid = ? OR wa_lid = ?',
              [rawPhone + '@c.us', rawPhone + '@s.whatsapp.net', rawPhone + '@c.us', rawPhone + '@s.whatsapp.net']);
          }

          // 4. Match by phone number variants
          if (!customer) {
            customer = findCustomerByPhone(db, rawPhone);
          }

          // 5. Try to resolve via WhatsApp lookup
          let resolvedRealPhone = null; // captured for new customer creation below
          if (!customer && waSocket) {
            try {
              const [resolved] = await waSocket.onWhatsApp(jid);
              if (resolved && resolved.jid && resolved.jid !== jid) {
                const resolvedPhone = resolved.jid.replace(/@.+$/, '');
                if (resolved.jid.endsWith('@s.whatsapp.net')) resolvedRealPhone = resolvedPhone;
                customer = db.get('SELECT * FROM customers WHERE wa_id = ? OR wa_lid = ?', [resolved.jid, resolved.jid]);
                if (!customer) customer = findCustomerByPhone(db, resolvedPhone);
                if (customer) console.log(`🔍 Resolved ${jid} → ${resolved.jid} → ${customer.name}`);
              }
            } catch(e) {}
          }

          // 6. For LID messages: find customer we recently sent to with matching pushName
          if (!customer && isLid && msg.pushName) {
            customer = db.get(`
              SELECT c.* FROM customers c
              JOIN messages m ON m.customer_id = c.id
              WHERE m.direction = 'out'
                AND c.name LIKE ?
                AND m.created_at > datetime('now', '-10 minutes')
              ORDER BY m.created_at DESC LIMIT 1
            `, ['%' + msg.pushName + '%']);
            if (!customer) {
              // Try exact name match without time limit
              customer = db.get('SELECT * FROM customers WHERE name = ?', [msg.pushName]);
            }
            if (customer) console.log(`🔍 Matched LID by name: ${msg.pushName} → ${customer.name} #${customer.id}`);
          }

          // Update wa_id / wa_lid for matched customer
          if (customer) {
            if (isLid) {
              // Store LID in wa_lid, keep wa_id as phone-based
              if (customer.wa_lid !== waId) {
                db.run('UPDATE customers SET wa_lid = ? WHERE id = ?', [waId, customer.id]);
                console.log(`🔗 Stored LID ${waId} for customer #${customer.id} (${customer.name})`);
              }
            } else {
              // Regular phone JID - store in wa_id
              if (customer.wa_id !== waId) {
                db.run('UPDATE customers SET wa_id = ? WHERE id = ?', [waId, customer.id]);
                console.log(`🔗 Linked wa_id ${waId} to customer #${customer.id} (${customer.name})`);
              }
            }
          }

          let isNew = false;
          if (!customer) {
            isNew = true;
            // Decide a real phone to store. For LID JIDs the rawPhone is a Linked-ID number,
            // not a real phone — never store it as the customer's phone.
            let storePhone = '';
            if (!isLid) {
              storePhone = rawPhone;
              if (storePhone.startsWith('20') && storePhone.length > 10) storePhone = '0' + storePhone.slice(2);
            } else if (resolvedRealPhone) {
              storePhone = resolvedRealPhone;
              if (storePhone.startsWith('20') && storePhone.length > 10) storePhone = '0' + storePhone.slice(2);
            }
            // If still no real phone, use a unique placeholder so the UNIQUE phone constraint
            // doesn't collide across multiple LID-only customers.
            if (!storePhone) storePhone = 'lid:' + rawPhone;

            // Avoid race / collision on UNIQUE phone — if a customer with this phone now exists,
            // attach to it instead of failing.
            const collide = db.get('SELECT * FROM customers WHERE phone = ?', [storePhone]);
            if (collide) {
              customer = collide;
              isNew = false;
              if (isLid && customer.wa_lid !== waId) {
                db.run('UPDATE customers SET wa_lid = ? WHERE id = ?', [waId, customer.id]);
              } else if (!isLid && customer.wa_id !== waId) {
                db.run('UPDATE customers SET wa_id = ? WHERE id = ?', [waId, customer.id]);
              }
            } else {
              const waIdCol = isLid ? '' : waId;
              const waLidCol = isLid ? waId : '';
              const result = db.run(`
                INSERT INTO customers (name, phone, source, status, wa_id, wa_lid, last_contact, created_at)
                VALUES (?, ?, 'واتساب', 'first_attempt', ?, ?, datetime('now'), datetime('now'))
              `, [contactName, storePhone, waIdCol, waLidCol]);

              customer = db.get('SELECT * FROM customers WHERE id = ?', [result.lastInsertRowid]);

              db.run(`
                INSERT INTO timeline (customer_id, type, text, icon, user_name, created_at)
                VALUES (?, 'created', 'تم إنشاء العميل تلقائياً من رسالة واتساب', '📱', 'النظام', datetime('now'))
              `, [customer.id]);
            }

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

    // Timeout detection - if no QR/connection after 30s, log warning
    setTimeout(() => {
      if (waStatus.initializing && !waStatus.connected && !waStatus.qrCode) {
        console.error('⚠️ WhatsApp timeout: No QR or connection after 30 seconds');
        console.error('⚠️ Status:', JSON.stringify(waStatus));
        console.error('⚠️ Socket state:', waSocket?.ws?.readyState);
      }
    }, 30000);

  } catch (err) {
    console.error('WhatsApp initialization error:', err);
    console.error('Error details:', err.stack || err);
    console.log('⚠️  WhatsApp will not be available. You can still use the CRM without it.');
    waStatus.initializing = false;
    io.emit('whatsapp:status', { initializing: false, error: 'فشل تشغيل الواتساب. تحقق من إعدادات السيرفر' });
  }
}

// Wraps a promise with a hard timeout so a stuck WhatsApp call can't hang forever
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`انتهت مهلة ${label || 'الواتساب'} (${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Accepts either a phone (string of digits/with prefix) or a full JID like
// "1234@s.whatsapp.net" / "1234@lid". For LID JIDs we send directly without
// onWhatsApp() check (it's an opaque ID, not a phone number).
async function sendMessage(phoneOrJid, text) {
  if (!waSocket || !waStatus.connected) {
    throw new Error('واتساب غير متصل. اربط الواتساب من الإعدادات أولاً');
  }

  let jid;
  let isLidJid = false;
  const input = String(phoneOrJid || '').trim();

  if (input.includes('@')) {
    jid = input;
    isLidJid = jid.endsWith('@lid');
  } else {
    let cleanPhone = input.replace(/\D/g, '');
    if (!cleanPhone) throw new Error('رقم غير صالح');
    if (cleanPhone.startsWith('0')) cleanPhone = '20' + cleanPhone.slice(1);
    if (!cleanPhone.startsWith('20')) cleanPhone = '20' + cleanPhone;
    jid = cleanPhone + '@s.whatsapp.net';
  }

  try {
    if (!isLidJid) {
      const checkResult = await withTimeout(waSocket.onWhatsApp(jid), 15000, 'التحقق من الرقم');
      const result = Array.isArray(checkResult) ? checkResult[0] : checkResult;
      if (!result || !result.exists) {
        throw new Error('هذا الرقم غير مسجل على واتساب');
      }
    }
    const sent = await withTimeout(waSocket.sendMessage(jid, { text }), 20000, 'إرسال الرسالة');
    return sent;
  } catch (err) {
    console.error('Send message error:', err);
    const msg = err.message || String(err);
    if (msg.includes('غير مسجل') || msg.includes('غير متصل') || msg.includes('انتهت مهلة') || msg.includes('غير صالح')) throw err;
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
