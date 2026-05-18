// ═══════════════ J&T Express Egypt — API wrapper ═══════════════
// Configure via .env:
//   JT_AUTH_TOKEN          (required — from J&T merchant portal)
//   JT_BASE_URL            (default: https://vipgw.jtjms-eg.com)
//   JT_SENDER_NAME, JT_SENDER_PHONE, JT_SENDER_PROVINCE,
//   JT_SENDER_CITY, JT_SENDER_AREA, JT_SENDER_STREET

const BASE = process.env.JT_BASE_URL || 'https://vipgw.jtjms-eg.com';
const TOKEN = process.env.JT_AUTH_TOKEN || '';

function isConfigured() {
  return !!TOKEN;
}

function defaultSender() {
  return {
    senderName:     process.env.JT_SENDER_NAME     || '',
    senderPhone:    process.env.JT_SENDER_PHONE    || '',
    senderProvince: process.env.JT_SENDER_PROVINCE || '',
    senderCity:     process.env.JT_SENDER_CITY     || '',
    senderArea:     process.env.JT_SENDER_AREA     || '',
    senderStreet:   process.env.JT_SENDER_STREET   || '',
  };
}

async function jtFetch(path, options = {}) {
  if (!TOKEN) throw new Error('JT_AUTH_TOKEN غير معرّف في إعدادات السيرفر');
  const url = BASE + path;
  const res = await fetch(url, {
    method: options.method || 'POST',
    headers: {
      authToken: TOKEN,
      language: 'EN',
      timezone: 'GMT+0300',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : (options.method === 'GET' ? undefined : '{}'),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!res.ok || (data && data.code && data.code !== '0' && data.code !== 0 && data.code !== 200)) {
    const msg = data?.msg || data?.message || `HTTP ${res.status}`;
    throw new Error('J&T: ' + msg);
  }
  return data;
}

// ═══════════════ Public API ═══════════════
async function saveOrder(payload) {
  return jtFetch('/vip/order/save', { body: payload });
}

async function batchSave(arr) {
  return jtFetch('/vip/order/batchSave', { body: arr });
}

async function listOrders(filter = {}) {
  return jtFetch('/vip/order/list', { body: { current: 1, size: 100, isVip: true, ...filter } });
}

async function totalGroup(filter = {}) {
  return jtFetch('/vip/order/totalGroup', { body: { isVip: true, ...filter } });
}

async function trackByWaybillNo(waybills) {
  const arr = Array.isArray(waybills) ? waybills : [waybills];
  return jtFetch('/vip/logisticsTracking/v2/getDetailByWaybillNo', { body: arr });
}

async function workOrderList(filter = {}) {
  return jtFetch('/vip/workOrder/page', { body: { current: 1, size: 100, ...filter } });
}

async function workOrderSave(payload) {
  return jtFetch('/vip/workOrder/save', { body: payload });
}

async function workOrderFirstTypes() {
  return jtFetch('/vip/workOrder/firstType', { body: {} });
}

async function getExpressTypes() {
  return jtFetch('/vip/order/getExpressType', { method: 'GET' });
}

async function getAreas(body = {}) {
  return jtFetch('/vip/area/selectByCondition', { body });
}

module.exports = {
  isConfigured,
  defaultSender,
  saveOrder,
  batchSave,
  listOrders,
  totalGroup,
  trackByWaybillNo,
  workOrderList,
  workOrderSave,
  workOrderFirstTypes,
  getExpressTypes,
  getAreas,
};
