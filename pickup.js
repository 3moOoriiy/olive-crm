// ═══════════════════════════════════════════════════════════════
//  pickup.js — Excel processing for the Pick Up tab
//  Port of jt_automation.py to Node.js using SheetJS (xlsx).
// ═══════════════════════════════════════════════════════════════

const XLSX = require('xlsx');

// ─── Helpers ─────────────────────────────────────────────────────

function isValid(v) {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return s !== '' && s.toLowerCase() !== 'nan' && s.toLowerCase() !== 'none';
}

function normalize(s) {
  return String(s || '').trim().toLowerCase().replace(/[’']/g, '');
}

function findCol(headers, name) {
  const want = normalize(name);
  for (const h of headers) {
    if (normalize(h) === want) return h;
  }
  // partial match
  for (const h of headers) {
    const n = normalize(h);
    if (n.includes(want) || want.includes(n)) return h;
  }
  return null;
}

function findWaybillCol(headers) {
  for (const c of ['Waybill NO.', 'Waybill No.', 'Waybill']) {
    if (headers.includes(c)) return c;
  }
  for (const h of headers) {
    if (h.toLowerCase().includes('waybill')) return h;
  }
  return null;
}

function findTrackCol(headers) {
  for (const c of ['Track', 'Tracking', 'Tracking Number']) {
    if (headers.includes(c)) return c;
  }
  return null;
}

function cleanColumns(headers) {
  return headers.map(h => String(h).trim().replace(/​/g, '').replace(/\n/g, ' '));
}

function cleanTrack(v) {
  return String(v == null ? '' : v).trim().replace(/\.0$/, '');
}

function cleanPhone(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (s.startsWith('+2')) s = s.slice(2);
  else if (s.startsWith('002')) s = s.slice(3);
  return s;
}

// Read a workbook from a Buffer; pick the preferred sheet if available
function readSheet(buffer, preferredNames = []) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  let sheetName = wb.SheetNames[0];
  for (const name of preferredNames) {
    if (wb.SheetNames.includes(name)) { sheetName = name; break; }
  }
  const ws = wb.Sheets[sheetName];
  // header:1 → first row is headers; defval ensures empty cells are included
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  if (!rows.length) return { headers: [], data: [] };
  const headers = cleanColumns(rows[0].map(h => String(h)));
  const data = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
  return { headers, data, sheetName };
}

function buildLookup(srcData, srcHeaders, wbCol, mapping, phoneCol = null) {
  const lookup = {};
  for (const row of srcData) {
    const wb = row[wbCol];
    if (!isValid(wb)) continue;
    const key = String(wb).trim();
    if (lookup[key]) continue; // first occurrence wins

    const entry = {};
    for (const [target, srcName] of Object.entries(mapping)) {
      const col = findCol(srcHeaders, srcName);
      if (col) {
        const v = row[col];
        if (isValid(v)) entry[target] = v;
      }
    }
    if (phoneCol) {
      const v = row[phoneCol];
      if (isValid(v)) entry.Phone = cleanPhone(v);
    }
    lookup[key] = entry;
  }
  return lookup;
}

function bufferFromData(headers, data) {
  // Preserve column order: headers first
  const aoa = [headers];
  for (const row of data) {
    aoa.push(headers.map(h => row[h] === undefined ? '' : row[h]));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const TARGETS = ['Id', 'Price', 'Status', 'Offer \\Item', 'employees Id', 'Phone', 'Sender name'];

function snapshotExisting(pickupData, trackCol, columns) {
  // Returns { col: { trackValue: existingValue } } so we can fall back to old data
  const snap = {};
  for (const col of columns) {
    if (pickupData.length && pickupData[0][col] !== undefined) {
      const m = {};
      for (const row of pickupData) {
        const k = cleanTrack(row[trackCol]);
        if (isValid(row[col]) && !(k in m)) m[k] = row[col];
      }
      snap[col] = m;
    }
  }
  return snap;
}

function mergePickupRows(pickupHeaders, pickupData, trackCol, newTrackKeys) {
  // Append rows for any new track keys not already in pickup
  const existing = new Set(pickupData.map(r => cleanTrack(r[trackCol])));
  const added = [];
  for (const t of newTrackKeys) {
    const key = cleanTrack(t);
    if (key && key !== 'nan' && !existing.has(key)) {
      const blank = {};
      pickupHeaders.forEach(h => { blank[h] = ''; });
      blank[trackCol] = key;
      pickupData.push(blank);
      existing.add(key);
      added.push(key);
    }
  }
  return added;
}

function applyTargets(pickupData, trackCol, primaryLookup, secondaryLookup, existingData) {
  // Returns stats per target
  const stats = {};
  for (const target of TARGETS) {
    stats[target] = 0;
    for (const row of pickupData) {
      const tv = cleanTrack(row[trackCol]);
      let val = null;
      const p = primaryLookup[tv];
      if (p && target in p) val = p[target];
      if (val === null && secondaryLookup) {
        const s = secondaryLookup[tv];
        if (s && target in s) val = s[target];
      }
      if (val === null) {
        const old = existingData[target]?.[tv];
        if (isValid(old)) val = old;
      }
      if (val !== null) stats[target]++;
      row[target] = val === null ? '' : val;
    }
  }
  return stats;
}

const WAYBILL_MAPPING = {
  Id: 'Order number',
  'Offer \\Item': "Customer's pickup information",
  Price: 'COD amount',
  Status: 'Status',
  'employees Id': 'Client Order No.',
  'Sender name': 'Sender name',
};

// ═══════════════ Public operations ═══════════════════════════════

// Op 1 — Merge 3 sheets (My Order + My Waybill + Pickup)
function mergeThree({ orderBuf, waybillBuf, pickupBuf }) {
  const order = readSheet(orderBuf, ['My Order']);
  const waybill = readSheet(waybillBuf, ['My Waybill']);
  const pickup = readSheet(pickupBuf, ['Sheet1', 'Backup', 'البيانات', 'Data']);

  const trackCol = findTrackCol(pickup.headers);
  if (!trackCol) throw new Error('عمود Track غير موجود في ملف البيك اب');

  const orderWb = findWaybillCol(order.headers);
  const waybillWb = findWaybillCol(waybill.headers);
  if (!orderWb || !waybillWb) throw new Error('عمود Waybill NO. غير موجود في أحد الملفات');

  // Add missing TARGETS columns to pickup headers if not present
  for (const t of TARGETS) {
    if (!pickup.headers.includes(t)) pickup.headers.push(t);
  }

  // Existing data snapshot
  const existingData = snapshotExisting(pickup.data, trackCol, [...TARGETS, 'Shipping Costs']);

  // Append new tracks
  const newFromOrder = order.data.map(r => r[orderWb]).filter(isValid);
  const newFromWaybill = waybill.data.map(r => r[waybillWb]).filter(isValid);
  const added = mergePickupRows(pickup.headers, pickup.data, trackCol, [...newFromOrder, ...newFromWaybill]);

  const wbLookup = buildLookup(waybill.data, waybill.headers, waybillWb, WAYBILL_MAPPING, findCol(waybill.headers, "The receiver's phone"));
  const ordLookup = buildLookup(order.data, order.headers, orderWb, WAYBILL_MAPPING, findCol(order.headers, "The receiver's phone"));

  const stats = applyTargets(pickup.data, trackCol, wbLookup, ordLookup, existingData);

  return {
    buffer: bufferFromData(pickup.headers, pickup.data),
    stats,
    total: pickup.data.length,
    added: added.length,
  };
}

// Op 2/3 — Transfer from a single source (My Order or My Waybill)
function transferSingle({ srcBuf, pickupBuf, preferredSheet }) {
  const src = readSheet(srcBuf, [preferredSheet]);
  const pickup = readSheet(pickupBuf, ['Sheet1', 'Backup', 'البيانات', 'Data']);

  const trackCol = findTrackCol(pickup.headers);
  if (!trackCol) throw new Error('عمود Track غير موجود في ملف البيك اب');
  const wbCol = findWaybillCol(src.headers);
  if (!wbCol) throw new Error('عمود Waybill غير موجود في ملف ' + preferredSheet);

  for (const t of TARGETS) {
    if (!pickup.headers.includes(t)) pickup.headers.push(t);
  }
  const existingData = snapshotExisting(pickup.data, trackCol, [...TARGETS, 'Shipping Costs']);
  const newTracks = src.data.map(r => r[wbCol]).filter(isValid);
  const added = mergePickupRows(pickup.headers, pickup.data, trackCol, newTracks);

  const lookup = buildLookup(src.data, src.headers, wbCol, WAYBILL_MAPPING, findCol(src.headers, "The receiver's phone"));
  const stats = applyTargets(pickup.data, trackCol, lookup, null, existingData);

  let matched = 0;
  for (const r of pickup.data) {
    if (lookup[cleanTrack(r[trackCol])]) matched++;
  }

  return {
    buffer: bufferFromData(pickup.headers, pickup.data),
    stats,
    total: pickup.data.length,
    added: added.length,
    matched,
  };
}

// Op 4 — Shipping costs from a separate file
function shippingCosts({ pickupBuf, shippingBuf }) {
  const pickup = readSheet(pickupBuf, ['Sheet1', 'Backup', 'البيانات', 'Data']);
  // Shipping file: prefer the second sheet (matches Python behavior)
  const wb = XLSX.read(shippingBuf, { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames.length > 1 ? wb.SheetNames[1] : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
  const shHeaders = cleanColumns((rows[0] || []).map(h => String(h)));
  const shData = rows.slice(1).map(row => {
    const obj = {};
    shHeaders.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });

  const trackCol = findTrackCol(pickup.headers);
  if (!trackCol) throw new Error('عمود Track غير موجود في ملف البيك اب');
  const wbCol = findWaybillCol(shHeaders);
  if (!wbCol) throw new Error('عمود Waybill غير موجود في ملف مصاريف الشحن');

  let freightCol = shHeaders.find(c => c.toLowerCase().includes('total') && c.toLowerCase().includes('freight'));
  if (!freightCol) freightCol = shHeaders.find(c => c.toLowerCase().includes('freight'));
  if (!freightCol) throw new Error('عمود Total Freight غير موجود في ملف مصاريف الشحن');

  const freightMap = {};
  for (const row of shData) {
    const k = row[wbCol];
    const v = row[freightCol];
    if (isValid(k) && isValid(v)) {
      const key = String(k).trim();
      if (!(key in freightMap)) freightMap[key] = v;
    }
  }

  if (!pickup.headers.includes('Shipping Costs')) pickup.headers.push('Shipping Costs');

  // Snapshot existing
  const oldShipping = {};
  for (const row of pickup.data) {
    const tk = cleanTrack(row[trackCol]);
    if (isValid(row['Shipping Costs']) && !(tk in oldShipping)) {
      oldShipping[tk] = row['Shipping Costs'];
    }
  }

  let updated = 0;
  for (const row of pickup.data) {
    const tk = cleanTrack(row[trackCol]);
    const v = freightMap[tk];
    if (v !== undefined) {
      row['Shipping Costs'] = v;
      updated++;
    } else if (isValid(oldShipping[tk])) {
      row['Shipping Costs'] = oldShipping[tk];
    }
  }

  return {
    buffer: bufferFromData(pickup.headers, pickup.data),
    total: pickup.data.length,
    updated,
  };
}

module.exports = { mergeThree, transferSingle, shippingCosts };
