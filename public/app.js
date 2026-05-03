// ═══════════════ API & SOCKET ═══════════════
const TOKEN_KEY = 'olive_token';
let waConnected = false;
let newMessageCount = 0;
let latestQR = null;
let qrPollTimer = null;
let socket;
try { socket = io(); } catch(e) { console.warn('Socket.io not available:', e); socket = { on: ()=>{}, emit: ()=>{} }; }

async function api(path, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch('/api' + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'حدث خطأ');
  return data;
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Request browser notification permission
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

function showWANotification(customerId, customerName, msgText, isNew) {
  // Remove any existing WA notification
  document.querySelectorAll('.wa-notif-banner').forEach(el => el.remove());

  const banner = document.createElement('div');
  banner.className = 'wa-notif-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;max-width:420px;width:100%">
      <div style="font-size:32px;flex-shrink:0">${isNew ? '📱' : '💬'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px;color:#166534">${isNew ? '🆕 عميل جديد من واتساب!' : '📩 رسالة واردة'}</div>
        <div style="font-weight:600;font-size:15px;margin-bottom:4px">${customerName}</div>
        <div style="font-size:13px;color:#374151;word-break:break-word;line-height:1.4">${msgText}</div>
        <div style="display:flex;gap:8px;margin-top:10px">
          <button onclick="selectCustomer(${customerId});this.closest('.wa-notif-banner').remove()" style="background:#166534;color:#fff;border:none;padding:6px 16px;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer">👤 فتح العميل</button>
          <button onclick="this.closest('.wa-notif-banner').remove()" style="background:#f3f4f6;color:#374151;border:none;padding:6px 16px;border-radius:8px;font-size:12px;cursor:pointer">✕ إغلاق</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(banner);
  // Auto-remove after 15 seconds
  setTimeout(() => banner.remove(), 15000);
}

// ═══════════════ CONSTANTS ═══════════════
const STATUSES = [
  { key: "first_attempt",    label: "محاوله اولي",        color: "#22c55e", bg: "#f0fdf4",  icon: "1️⃣" },
  { key: "second_attempt",   label: "محاوله ثانيه",       color: "#eab308", bg: "#fefce8",  icon: "2️⃣" },
  { key: "third_attempt",    label: "محاوله ثالثه",       color: "#1e293b", bg: "#f1f5f9",  icon: "3️⃣" },
  { key: "confirmed",        label: "تم التأكيد",         color: "#16a34a", bg: "#dcfce7",  icon: "✅" },
  { key: "rejected",         label: "رفض",                color: "#dc2626", bg: "#fee2e2",  icon: "❌" },
  { key: "waiting_transfer", label: "في انتظار التحويل",  color: "#65a30d", bg: "#ecfccb",  icon: "⏳" },
  { key: "postponed",        label: "تأجيل",              color: "#9333ea", bg: "#f3e8ff",  icon: "📅" },
  { key: "shipped",          label: "تم الشحن",           color: "#0891b2", bg: "#cffafe",  icon: "🚚" },
  { key: "duplicate",        label: "مكرر",               color: "#374151", bg: "#f3f4f6",  icon: "📋" },
];
const SOURCES = ["فيسبوك", "واتساب", "جوجل", "انستجرام", "توصية", "أخرى"];
const REGIONS = ["القاهرة","الجيزة","الإسكندرية","الشرقية","الدقهلية","المنوفية","القليوبية","البحيرة","الغربية","كفر الشيخ","دمياط","بورسعيد","الإسماعيلية","السويس","الفيوم","بني سويف","المنيا","أسيوط","سوهاج","قنا","الأقصر","أسوان"];
const ROLE_LABELS = {
  admin: "مدير", operations: "أوبريشن", supervisor: "سوبرفايزر",
  complaints: "مسئول شكاوي", call_center: "كول سنتر", moderator: "مودوريتور", agent: "موظف",
  warehouse_manager: "مدير مخزن", warehouse_supervisor: "مسئول مخزن", warehouse_worker: "عامل مخزن"
};
const PERMS = {
  moderator:   ['view:dashboard', 'view:moderator_form', 'view:staff_chat', 'orders:create'],
  call_center: ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:staff_chat', 'customers:manage', 'orders:create', 'calls:log', 'whatsapp:send'],
  complaints:  ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:complaints', 'view:staff_chat', 'customers:manage', 'orders:create', 'calls:log', 'whatsapp:send', 'complaints:manage'],
  supervisor:  ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:complaints', 'view:performance', 'view:reports', 'view:moderator_form', 'view:staff_chat', 'customers:manage', 'orders:create', 'calls:log', 'whatsapp:send', 'complaints:manage'],
  operations:  ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:complaints', 'view:performance', 'view:reports', 'view:settings', 'view:moderator_form', 'view:staff_chat', 'view:inventory', 'customers:manage', 'orders:create', 'orders:manage', 'calls:log', 'whatsapp:send', 'complaints:manage', 'users:manage', 'users:delete', 'products:manage', 'templates:manage', 'customers:delete_all'],
  admin:       ['view:dashboard', 'view:customers', 'view:followups', 'view:orders', 'view:whatsapp', 'view:complaints', 'view:performance', 'view:reports', 'view:settings', 'view:moderator_form', 'view:staff_chat', 'view:inventory', 'customers:manage', 'orders:create', 'orders:manage', 'calls:log', 'whatsapp:send', 'complaints:manage', 'users:manage', 'users:delete', 'products:manage', 'templates:manage', 'customers:delete_all'],
  warehouse_manager:    ['view:dashboard', 'view:inventory'],
  warehouse_supervisor: ['view:dashboard', 'view:inventory'],
  warehouse_worker:     ['view:dashboard', 'view:inventory'],
};
function can(perm) {
  const u = state.currentUser;
  if (!u) return false;
  const perms = PERMS[u.role];
  return perms ? perms.includes(perm) : false;
}
const STATUS_LABELS = {};
STATUSES.forEach(s => STATUS_LABELS[s.key] = s.label);

// ═══════════════ STATE ═══════════════
let state = {
  currentUser: null,
  view: "dashboard",
  selectedCustomer: null,
  filterStatus: "all",
  filterSource: "all",
  filterAgent: "all",
  filterSearch: "",
  activeTab: "timeline",
  // Customers pagination
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  // Orders pagination
  ordersPage: 1,
  ordersTotalPages: 1,
  ordersTotalItems: 0,
  // Data from API
  users: [],
  products: [],
  waTemplates: [],
  customers: [],
  dashboardData: null,
  // Cached view data
  _orders: null,
  _ordersPagination: null,
  _ordFilterSt: "all",
  _perfData: null,
  _reportData: null,
  // Complaints
  _complaints: null,
  _complaintsPagination: null,
  _complaintFilterSt: 'all',
  complaintsPage: 1,
  complaintsTotalPages: 1,
  complaintsTotalItems: 0,
  // WhatsApp Chat view
  waChatList: [],
  waChatSearch: '',
  waSelectedChatId: null,
  waSelectedMessages: [],
  waSelectedChat: null,
  waChatPage: 1,
  waChatTotalPages: 1,
  // Online users
  onlineUsers: [],
  // Staff chat
  staffChatConversations: [],
  staffChatSelectedUserId: null,
  staffChatSelectedUser: null,
  staffChatMessages: [],
  staffChatSearch: '',
  staffChatUnreadTotal: 0,
};

// ═══════════════ HELPERS ═══════════════
const getSt    = k => STATUSES.find(s => s.key === k) || STATUSES[0];
const getUser  = id => state.users.find(u => u.id === id);
const parseD   = iso => { if (!iso) return null; const s = (iso.includes('Z') || iso.includes('+')) ? iso : iso.replace(' ','T') + 'Z'; return new Date(s); };
const fmtDate  = iso => { const d = parseD(iso); if (!d) return "—"; const dd = String(d.getDate()).padStart(2,'0'); const mm = String(d.getMonth()+1).padStart(2,'0'); const yy = d.getFullYear(); return `${dd}/${mm}/${yy}`; };
const fmtTime  = iso => { const d = parseD(iso); if (!d) return "—"; let h = d.getHours(); const m = String(d.getMinutes()).padStart(2,'0'); const ampm = h >= 12 ? 'م' : 'ص'; if (h > 12) h -= 12; if (h === 0) h = 12; return `${h}:${m} ${ampm}`; };
const fmtDateTime = iso => { if (!iso) return "—"; return fmtDate(iso) + ' — ' + fmtTime(iso); };
const daysDiff = iso => { const d = parseD(iso); if (!d) return 999; return Math.floor((Date.now() - d.getTime()) / 86400000); };
const esc      = s  => String(s || '').replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const avHtml   = (u, size = 32) => {
  if (!u) return "";
  const obj = typeof u === 'number' ? getUser(u) : u;
  if (!obj) return "";
  return `<div class="av" style="width:${size}px;height:${size}px;background:${obj.color || '#6366f1'};font-size:${Math.round(size * .35)}px">${esc(obj.avatar_initials || obj.av || '')}</div>`;
};
// stBadge uses CSS classes: badge + status-{key}
const stBadge = k => {
  const s = getSt(k);
  return `<span class="badge status-${s.key}">${s.icon} ${s.label}</span>`;
};
const formatPhone = p => {
  if (!p) return '';
  if (p.startsWith('20')) return '0' + p.slice(2);
  return p;
};

// ═══════════════ LOGIN ═══════════════
function fillLogin(email) {
  document.getElementById("l-email").value = email;
  document.getElementById("l-pass").value = "123";
}

async function doLogin() {
  const email = document.getElementById("l-email").value.trim();
  const pass  = document.getElementById("l-pass").value;
  try {
    const { token, user } = await api('/auth/login', { method: 'POST', body: { email, password: pass } });
    localStorage.setItem(TOKEN_KEY, token);
    state.currentUser = user;
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    restoreSidebarState();
    await loadAppData();
    identifySocket();
    loadStaffUnreadCount();
    renderAll();
  } catch (e) {
    const el = document.getElementById("l-err");
    el.classList.remove("hidden");
    el.textContent = "⚠️ " + e.message;
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  state.currentUser = null;
  state.view = "dashboard";
  state.selectedCustomer = null;
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("app").classList.add("hidden");
}

// Try auto-login with saved token
async function tryAutoLogin() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    const { user } = await api('/auth/me');
    state.currentUser = user;
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app").classList.remove("hidden");
    restoreSidebarState();
    await loadAppData();
    identifySocket();
    loadStaffUnreadCount();
    renderAll();
  } catch (e) {
    localStorage.removeItem(TOKEN_KEY);
  }
}

function identifySocket() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token && socket && socket.connected) {
    socket.emit('user:identify', { token });
  }
}

async function loadAppData() {
  try {
    const [users, products, templates] = await Promise.all([
      api('/users'),
      api('/products'),
      api('/wa-templates'),
    ]);
    state.users      = users;
    state.products   = products;
    state.waTemplates = templates;
  } catch (e) {
    console.error('Failed to load app data:', e);
  }
  // Check WhatsApp connection status on startup
  try {
    const waStatus = await api('/whatsapp/status');
    waConnected = !!waStatus.connected;
    renderSidebar();
  } catch(e) {}
}

// ═══════════════ SIDEBAR / NAV ═══════════════
function toggleSidebar() {
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("overlay").classList.toggle("show");
  } else {
    const app = document.getElementById("app");
    const hidden = app.classList.toggle("sb-hidden");
    try { localStorage.setItem("olive_sb_hidden", hidden ? "1" : "0"); } catch(_) {}
  }
}
function closeSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("show");
}
function restoreSidebarState() {
  if (window.innerWidth > 768 && localStorage.getItem("olive_sb_hidden") === "1") {
    document.getElementById("app").classList.add("sb-hidden");
  }
}

function setView(v) {
  hideCustTooltip();
  state.view = v;
  state.selectedCustomer = null;
  // Reset pagination when switching view
  if (v === 'customers') {
    state.currentPage = 1;
  }
  if (v === 'orders') {
    state.ordersPage = 1;
    state._orders = null;
    state._ordersPagination = null;
  }
  if (v === 'performance') state._perfData = null;
  if (v === 'reports')     state._reportData = null;
  if (v === 'complaints') {
    state._complaints = null; state._complaintsPagination = null;
    state._complaintFilterSt = 'all'; state.complaintsPage = 1;
  }
  if (v === 'whatsappChat') {
    state.waChatList = []; state.waSelectedChatId = null;
    state.waSelectedMessages = []; state.waSelectedChat = null;
    state.waChatSearch = ''; state.waChatPage = 1;
    newMessageCount = 0;
  }
  if (v === 'staffChat') {
    state.staffChatConversations = [];
    state.staffChatSelectedUserId = null;
    state.staffChatSelectedUser = null;
    state.staffChatMessages = [];
    state.staffChatSearch = '';
  }
  closeSidebar();
  renderAll();
  loadViewData();
}

async function selectCustomer(id) {
  hideCustTooltip();
  try {
    const customer = await api('/customers/' + id);
    state.selectedCustomer = customer;
    state.view = "customerDetail";
    state.activeTab = "timeline";
    closeSidebar();
    renderAll();
  } catch (e) { showToast(e.message, 'error'); }
}

function goBack() {
  state.view = "customers";
  state.selectedCustomer = null;
  renderAll();
  loadViewData();
}

// ═══════════════ DATA LOADING ═══════════════
async function loadViewData() {
  try {
    if (state.view === 'dashboard') {
      state.dashboardData = await api('/dashboard');
      renderContent();
    } else if (state.view === 'customers') {
      await loadCustomersPage(state.currentPage);
    } else if (state.view === 'orders') {
      await loadOrdersPage(state.ordersPage);
    } else if (state.view === 'performance') {
      state._perfData = await api('/performance');
      renderContent();
    } else if (state.view === 'reports') {
      state._reportData = await api('/reports');
      renderContent();
    } else if (state.view === 'followups') {
      if (!state.dashboardData) {
        state.dashboardData = await api('/dashboard');
      }
      renderContent();
    } else if (state.view === 'complaints') {
      await loadComplaintsPage(state.complaintsPage);
    } else if (state.view === 'moderatorForm') {
      renderContent();
      initMFPrice();
    } else if (state.view === 'whatsappChat') {
      await loadWAChatList(true);
    } else if (state.view === 'staffChat') {
      await loadStaffChatConversations();
    }
  } catch (e) { console.error('Load view data error:', e); }
}

async function loadCustomersPage(page) {
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', 50);
  if (state.filterStatus !== 'all') params.set('status', state.filterStatus);
  if (state.filterSource !== 'all') params.set('source', state.filterSource);
  if (state.filterAgent  !== 'all') params.set('agent',  state.filterAgent);
  if (state.filterSearch)           params.set('search', state.filterSearch);

  const result = await api('/customers?' + params.toString());
  state.customers   = result.customers;
  state.currentPage = result.pagination.page;
  state.totalPages  = result.pagination.pages;
  state.totalItems  = result.pagination.total;
  renderContent();
  // Restore search focus if user was typing
  const searchEl = document.getElementById('cust-search-input');
  if (searchEl && state.filterSearch) {
    searchEl.focus();
    searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
  }
}

async function loadOrdersPage(page) {
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', 50);
  if (state._ordFilterSt && state._ordFilterSt !== 'all') {
    params.set('status', state._ordFilterSt);
  }
  const result = await api('/orders?' + params.toString());
  // New API returns { orders: [...], pagination: { page, limit, total, pages } }
  state._orders           = result.orders;
  state._ordersPagination = result.pagination;
  state.ordersPage        = result.pagination.page;
  state.ordersTotalPages  = result.pagination.pages;
  state.ordersTotalItems  = result.pagination.total;
  renderContent();
}

function goToCustomersPage(page) {
  if (page < 1 || page > state.totalPages) return;
  state.currentPage = page;
  loadCustomersPage(page);
}

function goToOrdersPage(page) {
  if (page < 1 || page > state.ordersTotalPages) return;
  state.ordersPage = page;
  loadOrdersPage(page);
}

const VIEW_TITLES = {
  dashboard:      "لوحة التحكم",
  customers:      "إدارة العملاء",
  customerDetail: "ملف العميل",
  followups:      "المتابعات الذكية",
  orders:         "إدارة الطلبات",
  performance:    "الأداء والتقييم",
  reports:        "التقارير",
  settings:       "الإعدادات",
  complaints:     "الشكاوي",
  moderatorForm:  "فورم الطلبات",
  whatsappChat:   "واتساب",
  staffChat:      "المحادثات",
  inventory:      "المخزن"
};

// ═══════════════ RENDER ALL ═══════════════
function renderAll() {
  hideCustTooltip();
  renderSidebar();
  renderTopbar();
  renderContent();
}

// ═══════════════ SIDEBAR RENDER ═══════════════
function renderSidebar() {
  const u = state.currentUser;
  if (!u) return;
  const allLinks = [
    { key: "dashboard",    label: "لوحة التحكم", icon: "📊", perm: "view:dashboard" },
    { key: "customers",    label: "العملاء",      icon: "👥", perm: "view:customers" },
    { key: "followups",    label: "المتابعات",    icon: "🔔", perm: "view:followups" },
    { key: "orders",       label: "الطلبات",      icon: "📦", perm: "view:orders" },
    { key: "whatsappChat", label: "واتساب",       icon: "💬", perm: "view:whatsapp", badge: newMessageCount },
    { key: "staffChat",    label: "المحادثات",    icon: "🗨️", perm: "view:staff_chat", badge: state.staffChatUnreadTotal },
    { key: "moderatorForm", label: "فورم الطلبات", icon: "📝", perm: "view:moderator_form" },
    { key: "complaints",   label: "الشكاوي",      icon: "📋", perm: "view:complaints" },
    { key: "performance",  label: "الأداء",       icon: "🏆", perm: "view:performance" },
    { key: "reports",      label: "التقارير",     icon: "📈", perm: "view:reports" },
    { key: "inventory",    label: "المخزن",       icon: "🏭", perm: "view:inventory" },
    { key: "settings",     label: "الإعدادات",    icon: "⚙️", perm: "view:settings" },
  ];
  const links = allLinks.filter(l => !l.perm || can(l.perm));
  document.getElementById("sb-links").innerHTML = links.map(l => `
    <div class="sb-link ${state.view === l.key || (state.view === "customerDetail" && l.key === "customers") ? "active" : ""}" onclick="setView('${l.key}')">
      <span class="sb-link-icon">${l.icon}</span>
      <span style="flex:1">${l.label}</span>
      ${l.badge > 0 ? `<span class="sb-badge">${l.badge}</span>` : ""}
    </div>
  `).join("");
  document.getElementById("sb-user").innerHTML = `<div class="flex gap10">${avHtml(u, 36)}<div><div style="color:#fff;font-weight:700;font-size:13px">${esc(u.name)}</div><div style="color:#a8c49a;font-size:11px">${ROLE_LABELS[u.role]}</div></div></div>`;
  document.getElementById("sb-status").innerHTML = `<div class="sb-status-inner">
    <span class="wa-status-dot" style="background:${waConnected ? '#16a34a' : '#ef4444'}"></span>
    واتساب: ${waConnected ? '✅ متصل' : '❌ غير متصل'}
    ${!waConnected ? `<br><span style="cursor:pointer;text-decoration:underline" onclick="showQRModal()">📱 ربط الواتساب</span>` : ''}
    ${newMessageCount > 0 ? `<br>📩 ${newMessageCount} رسالة جديدة` : ''}
  </div>`;
}

// ═══════════════ TOPBAR ═══════════════
function renderTopbar() {
  const u = state.currentUser;
  if (!u) return;
  let title = VIEW_TITLES[state.view] || "";
  if (state.view === "customerDetail" && state.selectedCustomer) title = state.selectedCustomer.name;
  document.getElementById("topbar-title").textContent = title;
  document.getElementById("topbar-user").innerHTML = `<div style="font-size:12px;font-weight:600">${esc(u.name)}</div><div style="font-size:11px;color:var(--muted)">${ROLE_LABELS[u.role]}</div>`;
}

// ═══════════════ CONTENT ROUTER ═══════════════
function renderContent() {
  const el = document.getElementById("content");
  if (!el) return;
  const v = state.view;
  if      (v === "dashboard")      el.innerHTML = renderDashboard();
  else if (v === "customers")      el.innerHTML = renderCustomers();
  else if (v === "customerDetail") el.innerHTML = renderCustomerDetail();
  else if (v === "followups")      el.innerHTML = renderFollowups();
  else if (v === "orders")         el.innerHTML = renderOrders();
  else if (v === "performance")    el.innerHTML = renderPerformance();
  else if (v === "reports")        el.innerHTML = renderReports();
  else if (v === "complaints")     el.innerHTML = renderComplaints();
  else if (v === "moderatorForm")  el.innerHTML = renderModeratorForm();
  else if (v === "settings")       el.innerHTML = renderSettings();
  else if (v === "whatsappChat")   el.innerHTML = renderWhatsAppChat();
  else if (v === "staffChat")      el.innerHTML = renderStaffChat();
  else if (v === "inventory")    { el.innerHTML = renderInventory(); loadInventoryFrame(); }
}

function renderInventory() {
  return `<iframe id="inventory-frame" src="about:blank" style="width:100%;height:100%;min-height:calc(100vh - 60px);border:0;display:block" title="نظام المخزن"></iframe>`;
}

async function loadInventoryFrame() {
  const frame = document.getElementById('inventory-frame');
  if (!frame) return;
  try {
    const r = await fetch('/api/inventory/sso', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status} — ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const ssoPayload = encodeURIComponent(JSON.stringify(data));
    frame.src = `/inventory/?embedded=1#sso=${ssoPayload}`;
  } catch (e) {
    frame.srcdoc = `<div style="padding:24px;font-family:Cairo;color:#dc2626">فشل فتح المخزن: ${esc(e.message)}</div>`;
  }
}

window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'inventory-back') setView('dashboard');
});

// ═══════════════ PAGINATION HTML HELPER ═══════════════
function renderPaginationControls(currentPage, totalPages, totalItems, onPageFn) {
  if (totalPages <= 1) return '';
  const pages = [];
  // Always show first, last, current, and neighbours
  const delta = 2;
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
      pages.push(i);
    }
  }
  // De-dup and sort
  const uniquePages = [...new Set(pages)].sort((a, b) => a - b);
  // Insert ellipsis placeholders
  const items = [];
  for (let idx = 0; idx < uniquePages.length; idx++) {
    if (idx > 0 && uniquePages[idx] - uniquePages[idx - 1] > 1) {
      items.push('...');
    }
    items.push(uniquePages[idx]);
  }

  const btnHtml = items.map(item => {
    if (item === '...') {
      return `<span class="page-btn" style="cursor:default;background:transparent;border:none;color:var(--muted)">…</span>`;
    }
    const isActive = item === currentPage;
    return `<button class="page-btn${isActive ? ' active' : ''}" onclick="${onPageFn}(${item})" ${isActive ? 'disabled' : ''}>${item}</button>`;
  }).join('');

  return `<div class="pagination">
    <button class="page-btn" onclick="${onPageFn}(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>→</button>
    ${btnHtml}
    <button class="page-btn" onclick="${onPageFn}(${currentPage + 1})" ${currentPage >= totalPages ? 'disabled' : ''}>←</button>
    <span class="page-info">صفحة ${currentPage} من ${totalPages} • إجمالي ${totalItems.toLocaleString()}</span>
  </div>`;
}

// ═══════════════ DASHBOARD ═══════════════
function renderDashboard() {
  const d = state.dashboardData;
  if (!d) {
    loadViewData();
    return `<div class="page" style="text-align:center;padding:60px"><div style="font-size:30px">⏳</div><p>جاري التحميل...</p></div>`;
  }

  const showModForm = can('view:moderator_form');
  return `<div class="page">
  ${showModForm ? `<div style="margin-bottom:16px"><button class="btn btn-primary btn-lg" onclick="openModeratorOrderModal()" style="width:100%;font-size:16px;padding:14px">📝 إضافة طلب جديد (مودوريتور)</button></div>` : ''}
  <div class="stats-grid g4" style="margin-bottom:20px">
    ${[
      ["📞", "مكالمات اليوم",  d.todayCalls,               "#0284c7", "#e0f2fe"],
      ["🛍️", "طلبات اليوم",    d.todayOrders,              "#16a34a", "#dcfce7"],
      ["📈", "معدل التحويل",   d.convRate + "%",           "#c8972a", "#fef8ec"],
      ["📦", "إجمالي الطلبات", d.totalOrders,              "#7c3aed", "#f3e8ff"],
    ].map(([icon, label, val, color, bg]) => `
    <div class="stat-card">
      <div class="stat-icon" style="background:${bg};color:${color}">${icon}</div>
      <div class="stat-info">
        <div class="stat-value" style="color:${color}">${val}</div>
        <div class="stat-label">${label}</div>
      </div>
    </div>`).join("")}
  </div>
  <div class="grid-2 g2" style="margin-bottom:16px">
    <div class="card" style="padding:16px">
      <div class="flex jcsb" style="margin-bottom:12px">
        <h3 style="font-size:14px;font-weight:700">📅 متابعات اليوم</h3>
        <span class="badge" style="background:#dcfce7;color:#166534">${d.todayFollowups.length}</span>
      </div>
      ${d.todayFollowups.length === 0
        ? `<p style="font-size:12px;color:var(--muted);text-align:center;padding:16px">لا توجد متابعات اليوم 🎉</p>`
        : d.todayFollowups.slice(0, 4).map(c => `
          <div class="flex jcsb" style="padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="selectCustomer(${c.id})">
            <div><div style="font-size:13px;font-weight:600">${esc(c.name)}</div><div style="font-size:11px;color:var(--muted)">${formatPhone(c.phone)}</div></div>
            ${stBadge(c.status)}
          </div>`).join("")}
    </div>
    <div class="card" style="padding:16px;${d.overdueFollowups.length ? 'border:1px solid #fca5a5' : ''}">
      <div class="flex jcsb" style="margin-bottom:12px">
        <h3 style="font-size:14px;font-weight:700;color:${d.overdueFollowups.length ? '#dc2626' : 'var(--text)'}">⚠️ متابعات متأخرة</h3>
        ${d.overdueFollowups.length ? `<span class="badge pulse" style="background:#fee2e2;color:#dc2626">${d.overdueFollowups.length}</span>` : ''}
      </div>
      ${d.overdueFollowups.length === 0
        ? `<p style="font-size:12px;color:var(--muted);text-align:center;padding:16px">ممتاز! لا توجد متابعات متأخرة ✅</p>`
        : d.overdueFollowups.slice(0, 4).map(c => `
          <div class="flex jcsb" style="padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="selectCustomer(${c.id})">
            <div><div style="font-size:13px;font-weight:600">${esc(c.name)}</div><div style="font-size:11px;color:#dc2626">متأخر ${Math.abs(daysDiff(c.follow_up_date))} يوم</div></div>
            ${stBadge(c.status)}
          </div>`).join("")}
    </div>
    <div class="card" style="padding:16px">
      <div class="flex jcsb" style="margin-bottom:12px">
        <h3 style="font-size:14px;font-weight:700">🔥 العملاء الساخنون</h3>
        <span class="badge" style="background:#fff7ed;color:#ea580c">${d.hotLeads.length}</span>
      </div>
      ${d.hotLeads.length === 0
        ? `<p style="font-size:12px;color:var(--muted);text-align:center;padding:16px">لا يوجد عملاء ساخنون حالياً</p>`
        : d.hotLeads.map(c => `
          <div class="flex jcsb" style="padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="selectCustomer(${c.id})">
            <div><div style="font-size:13px;font-weight:600">${esc(c.name)}</div><div style="font-size:11px;color:var(--muted)">${esc(c.region)} • ${esc(c.source)}</div></div>
            <span style="font-size:11px;color:#ea580c;font-weight:700">منذ ${daysDiff(c.last_contact)}ي</span>
          </div>`).join("")}
    </div>
    <div class="card" style="padding:16px">
      <div class="flex jcsb" style="margin-bottom:12px">
        <h3 style="font-size:14px;font-weight:700">📵 بدون تواصل +3 أيام</h3>
        <span class="badge" style="background:#fef9c3;color:#a16207">${d.noContact.length}</span>
      </div>
      ${d.noContact.slice(0, 5).map(c => `
        <div class="flex jcsb" style="padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="selectCustomer(${c.id})">
          <div><div style="font-size:12px;font-weight:600">${esc(c.name)}</div><div style="font-size:11px;color:var(--muted)">${esc(c.region)}</div></div>
          <span style="font-size:11px;font-weight:700;color:#d97706">${daysDiff(c.last_contact)} يوم</span>
        </div>`).join("")}
    </div>
  </div>
  </div>`;
}

// ═══════════════ CUSTOMER TOOLTIP ═══════════════
let _tooltipTimer = null;

function showCustTooltip(e, id) {
  clearTimeout(_tooltipTimer);
  _tooltipTimer = setTimeout(() => {
    const c = state.customers.find(x => x.id === id);
    if (!c) return;
    const agent    = getUser(c.assigned_to);
    const st       = getSt(c.status);
    const d        = daysDiff(c.last_contact);
    const lastStr  = d === 0 ? "اليوم" : d === 1 ? "أمس" : d >= 999 ? "لا يوجد" : `منذ ${d} أيام`;
    const agentName = agent ? esc(agent.name) : '—';
    const tt = document.getElementById('cust-tooltip');
    tt.innerHTML = `
      <div class="tt-header">
        <div class="tt-avatar">${esc(c.name.substring(0, 2))}</div>
        <div style="flex:1;min-width:0">
          <div class="tt-name">${esc(c.name)}</div>
          <div class="tt-sub"><span>${st.icon} ${st.label}</span><span>•</span><span>${esc(c.source)}</span></div>
        </div>
        <span class="badge" style="background:${st.bg};color:${st.color};font-size:11px;padding:3px 10px;border:1px solid ${st.color}33">${st.label}</span>
      </div>
      <div class="tt-status-bar">
        <div class="tt-stat"><div class="tt-stat-val">${formatPhone(c.phone)}</div><div class="tt-stat-lbl">📞 الهاتف</div></div>
        <div class="tt-stat"><div class="tt-stat-val" style="color:${d >= 3 ? '#dc2626' : '#166534'}">${lastStr}</div><div class="tt-stat-lbl">📅 آخر تواصل</div></div>
      </div>
      <div class="tt-body">
        ${c.phone2 ? `<div class="tt-row"><span class="tt-label">📱 هاتف بديل</span><span class="tt-val">${formatPhone(c.phone2)}</span></div>` : ''}
        <div class="tt-row"><span class="tt-label">📍 المحافظة</span><span class="tt-val" style="direction:rtl;text-align:left">${esc(c.region)}</span></div>
        ${c.address ? `<div class="tt-row"><span class="tt-label">🏠 العنوان</span><span class="tt-val" style="direction:rtl;text-align:left;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.address)}</span></div>` : ''}
        <div class="tt-row"><span class="tt-label">👤 الموظف</span><span class="tt-val" style="direction:rtl;text-align:left">${agentName}</span></div>
        ${c.follow_up_date ? `<div class="tt-row"><span class="tt-label">🔔 متابعة</span><span class="tt-val" style="direction:rtl;text-align:left;color:${new Date(c.follow_up_date) < new Date() ? '#dc2626' : '#0369a1'};font-weight:800">${fmtDate(c.follow_up_date)}</span></div>` : ''}
      </div>
      ${c.notes ? `<div class="tt-notes">📝 ${esc(c.notes)}</div>` : ''}
      <div class="tt-footer">اضغط لعرض التفاصيل الكاملة</div>`;
    positionTooltip(e, tt);
    tt.classList.add('show');
  }, 350);
}

function moveCustTooltip(e) {
  const tt = document.getElementById('cust-tooltip');
  if (tt.classList.contains('show')) positionTooltip(e, tt);
}

function positionTooltip(e, tt) {
  const pad = 16;
  const w   = tt.offsetWidth  || 340;
  const h   = tt.offsetHeight || 300;
  let x = e.clientX + pad;
  let y = e.clientY + pad;
  if (x + w > window.innerWidth  - pad) x = e.clientX - w - pad;
  if (y + h > window.innerHeight - pad) y = window.innerHeight - h - pad;
  if (y < pad) y = pad;
  tt.style.left = x + 'px';
  tt.style.top  = y + 'px';
}

function hideCustTooltip() {
  clearTimeout(_tooltipTimer);
  const tt = document.getElementById('cust-tooltip');
  tt.classList.remove('show');
}

// ═══════════════ CUSTOMERS PAGE ═══════════════
function renderCustomers() {
  const filtered = state.customers;
  const u        = state.currentUser;
  const st       = state.filterStatus;
  const src      = state.filterSource;
  const ag       = state.filterAgent;

  const paginationHtml = renderPaginationControls(
    state.currentPage,
    state.totalPages,
    state.totalItems,
    'goToCustomersPage'
  );

  return `<div class="page">
  <div class="page-header flex wrap gap10" style="margin-bottom:14px">
    <div class="search-wrap" style="position:relative;flex:1 1 200px">
      <input class="search-box" id="cust-search-input" type="text" placeholder="بحث بالاسم أو الهاتف أو المنطقة..." value="${esc(state.filterSearch)}" oninput="onCustomerSearch(this.value)" style="padding-right:34px;width:100%">
      <span class="search-icon" style="position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--muted)">🔍</span>
    </div>
    <select style="width:auto;min-width:130px" onchange="state.filterStatus=this.value;state.currentPage=1;loadCustomersPage(1)">
      <option value="all" ${st === "all" ? "selected" : ""}>كل الحالات</option>
      ${STATUSES.map(s => `<option value="${s.key}" ${st === s.key ? "selected" : ""}>${s.label}</option>`).join("")}
    </select>
    <select style="width:auto;min-width:120px" onchange="state.filterSource=this.value;state.currentPage=1;loadCustomersPage(1)">
      <option value="all" ${src === "all" ? "selected" : ""}>كل المصادر</option>
      ${SOURCES.map(s => `<option ${src === s ? "selected" : ""}>${s}</option>`).join("")}
    </select>
    ${!['moderator','call_center'].includes(u.role) ? `<select style="width:auto;min-width:130px" onchange="state.filterAgent=this.value;state.currentPage=1;loadCustomersPage(1)">
      <option value="all" ${ag === "all" ? "selected" : ""}>كل الموظفين</option>
      ${state.users.filter(u => ['call_center','complaints','moderator'].includes(u.role)).map(u => `<option value="${u.id}" ${ag === String(u.id) ? "selected" : ""}>${u.name}</option>`).join("")}
    </select>` : ""}
    <button class="btn btn-primary" onclick="openAddCustomerModal()">➕ عميل جديد</button>
    <button class="btn btn-accent" onclick="openImportModal()">📥 استيراد من Excel</button>
    ${can('customers:delete_all') ? `<button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5" onclick="deleteAllCustomers()">🗑️ مسح الكل</button>` : ''}
    <input type="file" id="excel-file-input" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleExcelFile(event)">
  </div>

  <div class="tabs-bar flex wrap gap6" style="margin-bottom:12px">
    <div class="tab ${st === 'all' ? 'active' : ''}" onclick="state.filterStatus='all';state.currentPage=1;loadCustomersPage(1)">
      الكل <span class="tab-count">${state.totalItems}</span>
    </div>
    ${STATUSES.map(s => `
      <div class="tab ${st === s.key ? 'active' : ''}" onclick="state.filterStatus='${s.key}';state.currentPage=1;loadCustomersPage(1)">
        ${s.icon} ${s.label}
      </div>`).join("")}
  </div>

  <div class="flex wrap gap6" style="margin-bottom:10px">
    <span style="font-size:12px;color:var(--muted)">إجمالي النتائج: <b>${state.totalItems}</b> عميل • صفحة <b>${state.currentPage}</b> من <b>${state.totalPages}</b></span>
  </div>

  <div class="card"><div class="tbl-wrap">
    <table class="tbl">
      <thead>
        <tr><th>العميل</th><th>الهاتف</th><th class="mob-hide">العنوان</th><th class="mob-hide">المصدر</th><th>الحالة</th><th class="mob-hide">الموظف</th><th class="mob-hide">آخر تعديل</th><th>آخر تواصل</th><th></th></tr>
      </thead>
      <tbody>
      ${filtered.map(c => {
        const agent = getUser(c.assigned_to);
        const d     = daysDiff(c.last_contact);
        const fullAddr = [c.region, c.address].filter(Boolean).join(' — ');
        return `<tr style="cursor:pointer" onclick="selectCustomer(${c.id})" onmouseenter="showCustTooltip(event,${c.id})" onmousemove="moveCustTooltip(event)" onmouseleave="hideCustTooltip()">
          <td><div class="flex gap6"><div><div style="font-weight:600">${esc(c.name)}</div>${c.notes ? `<div style="font-size:11px;color:var(--muted);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.notes)}</div>` : ""}</div></div></td>
          <td style="direction:ltr;text-align:right">${formatPhone(c.phone)}</td>
          <td class="mob-hide" style="min-width:200px"><div style="font-size:13px;white-space:normal;word-break:break-word">${esc(fullAddr) || '—'}</div></td>
          <td class="mob-hide"><span class="tag" style="background:#f0fdf4;color:#166534">${esc(c.source)}</span></td>
          <td>${stBadge(c.status)}</td>
          <td class="mob-hide">${agent ? `<div class="flex gap6">${avHtml(agent, 24)}<span style="font-size:12px">${esc(agent.name)}</span></div>` : "—"}</td>
          <td class="mob-hide" style="font-size:12px;white-space:nowrap"><div>${c.updated_at ? fmtDate(c.updated_at) + ' ' + fmtTime(c.updated_at) : '—'}</div>${c.updated_by_name ? `<div style="font-size:11px;color:var(--muted)">${esc(c.updated_by_name)}</div>` : ''}</td>
          <td style="color:${d >= 3 ? '#dc2626' : 'var(--muted)'};font-size:12px">${d === 0 ? "اليوم" : d === 1 ? "أمس" : `منذ ${d} أيام`}</td>
          <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();selectCustomer(${c.id})">عرض</button></td>
        </tr>`;
      }).join("")}
      ${filtered.length === 0 ? `<tr><td colspan="9" style="padding:40px;text-align:center;color:var(--muted)">
        <div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">لا توجد نتائج</div></div>
      </td></tr>` : ""}
      </tbody>
    </table>
  </div></div>

  ${paginationHtml}
  </div>`;
}

// ═══════════════ CUSTOMER DETAIL ═══════════════
function renderCustomerDetail() {
  const c = state.selectedCustomer;
  if (!c) return `<div class="page"><button class="btn btn-ghost" onclick="goBack()">← رجوع</button></div>`;

  const agent = getUser(c.assigned_to);
  const d     = daysDiff(c.last_contact);
  const isHot = c.status === "confirmed" && d < 3;
  const t     = state.activeTab;
  let tabContent = "";

  if (t === "timeline") {
    const timeline = c.timeline || [];
    tabContent = `<div class="card" style="padding:20px">
      ${timeline.length === 0
        ? `<p style="text-align:center;color:var(--muted);padding:20px">لا توجد أحداث</p>`
        : timeline.map(item => `
          <div class="tl-item">
            <div class="tl-dot" style="background:${item.type === 'call' ? '#dbeafe' : item.type === 'order' ? '#dcfce7' : item.type === 'whatsapp' ? '#f0fdf4' : '#f3f4f6'}">${item.icon || '●'}</div>
            <div style="flex:1;padding-top:4px">
              <div class="flex jcsb">
                <div>
                  <div style="font-size:13px;font-weight:600">${esc(item.text)}</div>
                  ${item.result ? `<span class="badge" style="background:#dbeafe;color:#1e40af;margin-top:4px">${esc(item.result)}</span>` : ""}
                  ${item.detail ? `<div style="font-size:12px;color:var(--muted);margin-top:4px">${esc(item.detail)}</div>` : ""}
                </div>
                <div style="text-align:left;flex-shrink:0;margin-right:8px">
                  <div style="font-size:11px;color:var(--muted)">${fmtDate(item.created_at)} ${fmtTime(item.created_at)}</div>
                  <div style="font-size:11px;color:var(--muted)">${esc(item.user_name || "")}</div>
                </div>
              </div>
            </div>
          </div>`).join("")}
    </div>`;
  } else if (t === "orders") {
    const orders = c.orders || [];
    tabContent = `<div>
      <button class="btn btn-primary" style="margin-bottom:14px" onclick="openAddOrderModal()">➕ طلب جديد</button>
      ${orders.length === 0
        ? `<div class="card" style="padding:30px;text-align:center;color:var(--muted)">لا توجد طلبات</div>`
        : orders.map(o => `
          <div class="card" style="padding:16px;margin-bottom:10px">
            <div class="flex jcsb">
              <div>
                <div style="font-weight:700;font-size:14px">${esc(o.product_name)}</div>
                <div style="font-size:12px;color:var(--muted);margin-top:4px">الكمية: ${o.qty} • السعر: ${o.price} جنيه • الإجمالي: <b>${o.total} جنيه</b></div>
                <div style="font-size:12px;color:var(--muted)">${fmtDate(o.created_at)}${o.address ? " • " + esc(o.address) : ""}</div>
              </div>
              <div class="flex gap6" style="align-items:center">
                <span class="badge" style="background:${o.status === 'تم التسليم' ? '#dcfce7' : o.status === 'مرتجع' ? '#fee2e2' : '#dbeafe'};color:${o.status === 'تم التسليم' ? '#166534' : o.status === 'مرتجع' ? '#dc2626' : '#1e40af'}">${esc(o.status)}</span>
                <button class="btn btn-ghost btn-sm" onclick="printInvoice(${o.id})" title="طباعة فاتورة">🖨️</button>
              </div>
            </div>
          </div>`).join("")}
    </div>`;
  } else if (t === "whatsapp") {
    const messages = c.messages || [];
    tabContent = `<div>
      <div class="flex gap10" style="margin-bottom:14px">
        <button class="btn btn-primary" onclick="openWAModal()">💬 إرسال رسالة</button>
        <a href="https://wa.me/${c.phone}" target="_blank" class="btn btn-ghost">🔗 فتح واتساب</a>
      </div>
      <div class="card" style="padding:16px;min-height:200px">
        ${messages.length === 0
          ? `<div style="text-align:center;color:var(--muted);padding:40px">لا توجد رسائل مسجلة</div>`
          : messages.map(m => `
            <div style="display:flex;flex-direction:column;align-items:${m.direction === 'out' ? 'flex-start' : 'flex-end'};margin-bottom:10px">
              <div class="${m.direction === 'out' ? 'bubble-out' : 'bubble-in'}">${esc(m.text)}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(m.user_name || '')} • ${fmtTime(m.created_at)}</div>
            </div>`).join("")}
      </div>
    </div>`;
  } else if (t === "notes") {
    tabContent = `<div class="card" style="padding:18px">
      <label style="margin-bottom:8px">ملاحظات العميل</label>
      <textarea rows="6" oninput="updateCustomerNotes(${c.id},this.value)" placeholder="أضف ملاحظاتك هنا...">${esc(c.notes)}</textarea>
      <div style="font-size:11px;color:var(--muted);margin-top:6px">يتم الحفظ تلقائياً</div>
    </div>`;
  }

  return `<div class="page">
  <div class="flex gap12 wrap" style="margin-bottom:18px">
    <button class="btn btn-ghost btn-sm" onclick="goBack()">← رجوع</button>
    <div style="flex:1">
      <div class="flex gap8 wrap">
        <h2 style="font-size:17px;font-weight:800">${esc(c.name)}</h2>
        ${isHot ? `<span style="font-size:18px">🔥</span>` : ""}
        ${stBadge(c.status)}
      </div>
      <div style="font-size:12px;color:var(--muted);margin-top:2px">${[c.region, c.address].filter(Boolean).map(esc).join(' — ')} • ${esc(c.source)} • ${fmtDate(c.created_at)}</div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="openEditCustomerModal()">✏️ تعديل</button>
  </div>

  <div class="grid-3 g3" style="margin-bottom:18px">
    <div class="card" style="padding:13px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:3px">📞 الهاتف الأساسي</div>
      <div style="font-weight:700;direction:ltr;text-align:right">${formatPhone(c.phone)}</div>
      ${c.phone2 ? `<div style="font-size:12px;color:var(--muted);direction:ltr;text-align:right">${formatPhone(c.phone2)}</div>` : ""}
      <div style="margin-top:6px;display:flex;gap:6px">
        <a href="tel:${formatPhone(c.phone)}" onclick="setTimeout(()=>openLogCallModal(),1500)" class="btn btn-green btn-sm" style="flex:1;text-decoration:none">📞 اتصل وسجل</a>
        <a href="https://wa.me/${c.phone}" target="_blank" class="btn btn-sm" style="flex:1;text-decoration:none;background:#25d366;color:#fff">💬 واتساب</a>
      </div>
    </div>
    <div class="card" style="padding:13px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:3px">📍 العنوان</div>
      <div style="font-weight:700;font-size:13px;word-break:break-word">${(() => { const parts = [c.region, c.address, c.notes].filter(Boolean); return parts.length ? esc(parts.join(' — ')) : '<span style="color:var(--muted)">لا يوجد عنوان</span>'; })()}</div>
    </div>
    <div class="card" style="padding:13px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:3px">👤 الموظف</div>
      ${agent ? `<div class="flex gap6">${avHtml(agent, 24)}<span style="font-weight:600;font-size:13px">${esc(agent.name)}</span></div>` : "—"}
    </div>
    <div class="card" style="padding:13px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:3px">📅 آخر تواصل</div>
      <div style="font-weight:700;color:${d >= 3 ? '#dc2626' : 'var(--text)'}">${d === 0 ? "اليوم" : d === 1 ? "أمس" : `منذ ${d} أيام`}</div>
    </div>
    ${c.follow_up_date ? `
      <div class="card" style="padding:13px;${new Date(c.follow_up_date) < new Date() ? 'border:1px solid #fca5a5' : ''}">
        <div style="font-size:12px;color:var(--muted);margin-bottom:3px">🔔 موعد المتابعة</div>
        <div style="font-weight:700;color:${new Date(c.follow_up_date) < new Date() ? '#dc2626' : 'var(--text)'}">${fmtDate(c.follow_up_date)}</div>
      </div>` : ""}
    <div class="card" style="padding:13px">
      <div style="font-size:12px;color:var(--muted);margin-bottom:3px">✏️ آخر تعديل</div>
      <div style="font-weight:700;font-size:13px">${c.updated_at ? fmtDateTime(c.updated_at) : 'لم يتم التعديل'}</div>
      ${c.updated_by_name ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">بواسطة: ${esc(c.updated_by_name)}</div>` : ''}
    </div>
  </div>

  <div class="card" style="padding:16px;margin-bottom:18px">
    <div style="font-size:13px;font-weight:700;margin-bottom:12px;color:var(--muted)">⚡ إجراء سريع — One Click</div>
    <div class="quick-actions flex wrap gap8">
      <div class="qbtn" onclick="quickAction(${c.id},'first_attempt')"  style="background:#f0fdf4;color:#16a34a;border-color:#86efac"><span class="qbtn-icon">1️⃣</span>محاولة أولى</div>
      <div class="qbtn" onclick="quickAction(${c.id},'second_attempt')" style="background:#fefce8;color:#a16207;border-color:#fde68a"><span class="qbtn-icon">2️⃣</span>محاولة ثانية</div>
      <div class="qbtn" onclick="quickAction(${c.id},'third_attempt')"  style="background:#f1f5f9;color:#1e293b;border-color:#94a3b8"><span class="qbtn-icon">3️⃣</span>محاولة ثالثة</div>
      <div class="qbtn" onclick="quickAction(${c.id},'confirmed')"      style="background:#dcfce7;color:#166534;border-color:#86efac"><span class="qbtn-icon">✅</span>تم التأكيد</div>
      <div class="qbtn" onclick="quickAction(${c.id},'rejected')"       style="background:#fee2e2;color:#dc2626;border-color:#fca5a5"><span class="qbtn-icon">❌</span>رفض</div>
      <div class="qbtn" onclick="quickAction(${c.id},'postponed')"      style="background:#f3e8ff;color:#7c3aed;border-color:#c4b5fd"><span class="qbtn-icon">📅</span>تأجيل</div>
      <div class="qbtn" onclick="openLogCallModal()"                     style="background:#ede9fe;color:#4f46e5;border-color:#a5b4fc"><span class="qbtn-icon">📋</span>تسجيل مكالمة</div>
      <div class="qbtn" onclick="openAddOrderModal()"                    style="background:#cffafe;color:#0891b2;border-color:#67e8f9"><span class="qbtn-icon">🛍️</span>طلب جديد</div>
      <div class="qbtn" onclick="openWAModal()"                          style="background:#f0fdf4;color:#15803d;border-color:#4ade80"><span class="qbtn-icon">💬</span>واتساب</div>
      <div class="qbtn" onclick="openFollowUpModal()"                    style="background:#e0f2fe;color:#0369a1;border-color:#7dd3fc"><span class="qbtn-icon">⏳</span>متابعة</div>
    </div>
    <div style="margin-top:14px" class="flex wrap gap6 align-center">
      <span style="font-size:12px;color:var(--muted);font-weight:600">تغيير الحالة:</span>
      ${STATUSES.map(s => `<span class="badge" onclick="changeStatus(${c.id},'${s.key}')" style="color:${s.color};background:${c.status === s.key ? s.bg : '#f5f5f5'};cursor:pointer;border:1.5px solid ${c.status === s.key ? s.color : 'transparent'};padding:4px 10px">${s.icon} ${s.label}</span>`).join("")}
    </div>
  </div>

  <div class="tabs-bar flex gap6 wrap" style="margin-bottom:14px">
    ${[["timeline","📜 التاريخ"],["orders","📦 الطلبات"],["whatsapp","💬 واتساب"],["notes","📝 ملاحظات"]].map(([k, l]) => `
      <div class="tab ${t === k ? "active" : ""}" onclick="setDetailTab('${k}')">${l}</div>`).join("")}
  </div>
  ${tabContent}
  </div>`;
}

function setDetailTab(t) {
  state.activeTab = t;
  renderContent();
}

// ═══════════════ FOLLOW-UPS ═══════════════
function renderFollowups() {
  const d = state.dashboardData;
  if (!d) { loadViewData(); return `<div class="page" style="text-align:center;padding:60px">⏳ جاري التحميل...</div>`; }

  const ovr  = d.overdueFollowups || [];
  const todF = d.todayFollowups   || [];
  const hot  = d.hotLeads         || [];
  const noC  = d.noContact        || [];

  const cRow = (c, badge) => `
    <div class="flex jcsb" style="padding:9px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="selectCustomer(${c.id})">
      <div>
        <div style="font-size:13px;font-weight:600">${esc(c.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(c.region)} • ${formatPhone(c.phone)}</div>
      </div>
      <div class="flex gap6">${stBadge(c.status)}${badge}</div>
    </div>`;

  return `<div class="page"><div class="grid-2 g2">
    <div class="card" style="padding:16px;${ovr.length ? 'border:1px solid #fca5a5' : ''}">
      <h3 style="font-size:14px;font-weight:700;color:#dc2626;margin-bottom:12px">⚠️ متابعات متأخرة (${ovr.length})</h3>
      ${ovr.length === 0 ? `<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px">لا توجد ✅</div>` : ovr.map(c => cRow(c, `<span style="font-size:11px;color:#dc2626;font-weight:700">متأخر ${Math.abs(daysDiff(c.follow_up_date))}ي</span>`)).join("")}
    </div>
    <div class="card" style="padding:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:12px">📅 متابعات اليوم (${todF.length})</h3>
      ${todF.length === 0 ? `<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px">لا توجد متابعات اليوم</div>` : todF.map(c => cRow(c, `<span style="font-size:11px;color:#0369a1;font-weight:700">اليوم</span>`)).join("")}
    </div>
    <div class="card" style="padding:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:12px">🔥 العملاء الساخنون (${hot.length})</h3>
      ${hot.length === 0 ? `<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px">لا يوجد</div>` : hot.slice(0, 8).map(c => cRow(c, `<span style="font-size:11px;color:#ea580c;font-weight:700">منذ ${daysDiff(c.last_contact)}ي</span>`)).join("")}
    </div>
    <div class="card" style="padding:16px">
      <h3 style="font-size:14px;font-weight:700;color:#d97706;margin-bottom:12px">📵 بدون تواصل +3 أيام (${noC.length})</h3>
      ${noC.length === 0 ? `<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px">ممتاز! ✅</div>` : noC.slice(0, 8).map(c => cRow(c, `<span style="font-size:11px;color:#d97706;font-weight:700">${daysDiff(c.last_contact)} يوم</span>`)).join("")}
    </div>
  </div></div>`;
}

// ═══════════════ ORDERS PAGE ═══════════════
function renderOrders() {
  if (!state._orders) {
    loadOrdersPage(state.ordersPage);
    return `<div class="page" style="text-align:center;padding:60px">⏳ جاري التحميل...</div>`;
  }

  const allOrds   = state._orders;
  const filterSt  = state._ordFilterSt || "all";
  const pagination = state._ordersPagination || { page: 1, pages: 1, total: allOrds.length };
  const statuses  = ["جديد", "قيد الشحن", "تم التسليم", "مرتجع"];
  const total     = allOrds.reduce((s, o) => s + (o.total || 0), 0);

  // Count per status from current page data (for tab labels, full counts need server-side)
  const countPerStatus = {};
  statuses.forEach(s => { countPerStatus[s] = allOrds.filter(o => o.status === s).length; });

  const paginationHtml = renderPaginationControls(
    state.ordersPage,
    state.ordersTotalPages || pagination.pages,
    state.ordersTotalItems || pagination.total,
    'goToOrdersPage'
  );

  return `<div class="page">
  <div class="flex gap8 wrap" style="margin-bottom:14px;align-items:center">
    <div class="tabs-bar flex gap6 wrap">
      <div class="tab ${filterSt === 'all' ? 'active' : ''}" onclick="changeOrderFilter('all')">
        الكل <span class="tab-count">${state.ordersTotalItems || pagination.total}</span>
      </div>
      ${statuses.map(s => `
        <div class="tab ${filterSt === s ? 'active' : ''}" onclick="changeOrderFilter('${s}')">
          ${s}
        </div>`).join("")}
    </div>
    <span style="margin-right:auto;font-weight:700;color:var(--primary)">إجمالي الصفحة: ${total.toLocaleString()} جنيه</span>
  </div>

  <div class="card"><div class="tbl-wrap">
    <table class="tbl">
      <thead>
        <tr><th>العميل</th><th class="mob-hide">المنتج</th><th class="mob-hide">الكمية</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th><th></th></tr>
      </thead>
      <tbody>
      ${allOrds.map(o => `<tr>
        <td>
          <div style="font-weight:600;cursor:pointer" onclick="selectCustomer(${o.customer_id})">${esc(o.customer_name)}</div>
          ${o.customer_region ? `<div style="font-size:11px;color:var(--muted)">${esc(o.customer_region)}</div>` : ''}
        </td>
        <td class="mob-hide">${esc(o.product_name)}</td>
        <td class="mob-hide">${o.qty}</td>
        <td style="font-weight:700;color:var(--primary)">${(o.total || 0).toLocaleString()} جنيه</td>
        <td>
          <span class="badge" style="background:${o.status === 'تم التسليم' ? '#dcfce7' : o.status === 'مرتجع' ? '#fee2e2' : o.status === 'قيد الشحن' ? '#dbeafe' : '#fef9c3'};color:${o.status === 'تم التسليم' ? '#166534' : o.status === 'مرتجع' ? '#dc2626' : o.status === 'قيد الشحن' ? '#1e40af' : '#a16207'}">
            ${esc(o.status)}
          </span>
        </td>
        <td style="font-size:12px;color:var(--muted)">${fmtDate(o.created_at)}</td>
        <td><button class="btn btn-ghost btn-sm" onclick="printInvoice(${o.id})" title="طباعة فاتورة">🖨️</button></td>
      </tr>`).join("")}
      ${allOrds.length === 0 ? `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--muted)">
        <div class="empty-state"><div class="empty-state-icon">📦</div><div class="empty-state-text">لا توجد طلبات</div></div>
      </td></tr>` : ""}
      </tbody>
    </table>
  </div></div>

  ${paginationHtml}
  </div>`;
}

function changeOrderFilter(status) {
  state._ordFilterSt = status;
  state.ordersPage   = 1;
  state._orders      = null;
  state._ordersPagination = null;
  loadOrdersPage(1);
}

// ═══════════════ PERFORMANCE ═══════════════
function renderPerformance() {
  if (!state._perfData) {
    api('/performance').then(data => { state._perfData = data; renderContent(); });
    return `<div class="page" style="text-align:center;padding:60px">⏳ جاري التحميل...</div>`;
  }
  const agents = state._perfData;
  const medals = ["🥇","🥈","🥉","4️⃣"];
  return `<div class="page">
  <h2 style="font-size:17px;font-weight:800;margin-bottom:18px">🏆 أداء الفريق</h2>
  ${agents.map((a, i) => `
  <div class="card perf-card" style="padding:18px;margin-bottom:14px;${i === 0 ? 'border:2px solid var(--accent)' : ''}">
    <div class="flex gap12 wrap" style="margin-bottom:14px">
      <span class="perf-medal" style="font-size:28px">${medals[i] || (i + 1)}</span>
      ${avHtml(a, 46)}
      <div style="flex:1">
        <div style="font-size:15px;font-weight:800">${esc(a.name)}</div>
        <div class="flex gap6 wrap" style="margin-top:6px">
          <span class="badge" style="background:#f0fdf4;color:#166534">📞 ${a.calls}</span>
          <span class="badge" style="background:#ede9fe;color:#4f46e5">🛍️ ${a.orders}</span>
          <span class="badge" style="background:#fef8ec;color:#c8972a">📈 ${a.conv}%</span>
          ${a.overdue ? `<span class="badge" style="background:#fee2e2;color:#dc2626">⚠️ ${a.overdue}</span>` : ''}
        </div>
      </div>
      <div class="perf-score" style="text-align:center">
        <div style="font-size:30px;font-weight:900;color:${a.color}">${a.score}</div>
        <div style="font-size:11px;color:var(--muted)">نقطة</div>
      </div>
    </div>
    <div class="perf-stats grid-4 g4">
      ${[["👥","العملاء",a.total],["📞","المكالمات",a.calls],["📦","الطلبات",a.orders],["💰","الإيرادات",a.revenue.toLocaleString()+"ر"]].map(([icon,label,val]) => `
        <div class="perf-stat" style="background:#f9fbf7;border-radius:10px;padding:10px;text-align:center">
          <div style="font-size:18px">${icon}</div>
          <div style="font-size:15px;font-weight:800;margin-top:3px">${val}</div>
          <div style="font-size:11px;color:var(--muted)">${label}</div>
        </div>`).join("")}
    </div>
  </div>`).join("")}
  </div>`;
}

// ═══════════════ REPORTS ═══════════════
function renderReports() {
  if (!state._reportData) {
    api('/reports').then(data => { state._reportData = data; renderContent(); });
    return `<div class="page" style="text-align:center;padding:60px">⏳ جاري التحميل...</div>`;
  }
  const r = state._reportData;
  return `<div class="page">
  <div class="grid-2 g2" style="margin-bottom:14px">
    <div class="card" style="padding:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">📊 العملاء حسب المصدر</h3>
      ${r.bySource.filter(s => s.count > 0).map(s => `
        <div style="margin-bottom:10px">
          <div class="flex jcsb" style="margin-bottom:4px;font-size:12px">
            <span style="font-weight:600">${esc(s.source)}</span>
            <span style="color:var(--muted)">${s.count} عميل • ${s.orders} طلب</span>
          </div>
          <div class="prog"><div class="prog-fill" style="width:${r.totalCustomers ? Math.round((s.count / r.totalCustomers) * 100) : 0}%;background:var(--primary)"></div></div>
        </div>`).join("")}
    </div>
    <div class="card" style="padding:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">📍 التوزيع الجغرافي</h3>
      ${r.byRegion.filter(x => x.count > 0).sort((a, b) => b.count - a.count).map(x => {
        const max = Math.max(...r.byRegion.map(y => y.count), 1);
        return `
          <div style="margin-bottom:10px">
            <div class="flex jcsb" style="margin-bottom:4px;font-size:12px">
              <span style="font-weight:600">${esc(x.region)}</span>
              <span style="color:var(--muted)">${x.count}</span>
            </div>
            <div class="prog"><div class="prog-fill" style="width:${Math.round((x.count / max) * 100)}%;background:var(--accent)"></div></div>
          </div>`;
      }).join("")}
    </div>
    <div class="card" style="padding:16px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">🎯 معدل التحويل</h3>
      ${r.convByAgent.map(a => `
        <div style="margin-bottom:10px">
          <div class="flex jcsb" style="margin-bottom:4px;font-size:12px">
            <span style="font-weight:600">${esc(a.name)}</span>
            <span style="font-weight:700;color:${a.color}">${a.rate}%</span>
          </div>
          <div class="prog"><div class="prog-fill" style="width:${a.rate}%;background:${a.color}"></div></div>
        </div>`).join("")}
    </div>
  </div></div>`;
}

// ═══════════════ CUSTOMER SEARCH DEBOUNCE ═══════════════
let _custSearchTimer;
function onCustomerSearch(value) {
  state.filterSearch = value;
  clearTimeout(_custSearchTimer);
  _custSearchTimer = setTimeout(() => { state.currentPage = 1; loadCustomersPage(1); }, 300);
}

// ═══════════════ WHATSAPP CHAT VIEW ═══════════════
let _waChatSearchTimer;

async function loadWAChatList(fullRender) {
  const params = new URLSearchParams();
  params.set('page', state.waChatPage);
  params.set('limit', 50);
  if (state.waChatSearch) params.set('search', state.waChatSearch);
  try {
    const result = await api('/whatsapp/chats?' + params.toString());
    state.waChatList = result.chats;
    state.waChatTotalPages = result.pagination.pages;
    if (fullRender) {
      renderContent();
    } else {
      // Partial update: only refresh chat list items (keeps search input focused)
      const listEl = document.querySelector('.wa-chat-list-items');
      if (listEl) {
        const selId = state.waSelectedChatId;
        listEl.innerHTML = state.waChatList.length === 0
          ? `<div style="text-align:center;color:var(--muted);padding:40px">💬<br>لا توجد محادثات</div>`
          : state.waChatList.map(c => `
            <div class="wa-chat-item ${selId === c.id ? 'active' : ''} ${c.unread_count > 0 ? 'unread' : ''}" onclick="selectWAChat(${c.id})">
              <div class="wa-chat-avatar">${esc(c.name.substring(0, 2))}</div>
              <div class="wa-chat-item-info">
                <div class="wa-chat-item-top">
                  <span class="wa-chat-item-name">${esc(c.name)}</span>
                  <span class="wa-chat-item-time">${fmtTime(c.last_message_at)}</span>
                </div>
                <div class="wa-chat-item-bottom">
                  <span class="wa-chat-item-preview">${c.last_message_direction === 'out' ? '← ' : ''}${esc((c.last_message_text || '').substring(0, 45))}</span>
                  ${c.unread_count > 0 ? `<span class="wa-unread-badge">${c.unread_count}</span>` : ''}
                </div>
              </div>
            </div>`).join('');
      } else {
        renderContent();
      }
    }
  } catch(e) { console.error('Load chats error:', e); }
}

function onWAChatSearch(value) {
  state.waChatSearch = value;
  clearTimeout(_waChatSearchTimer);
  _waChatSearchTimer = setTimeout(() => { state.waChatPage = 1; loadWAChatList(); }, 300);
}

async function selectWAChat(customerId) {
  state.waSelectedChatId = customerId;
  state.waSelectedChat = state.waChatList.find(c => c.id === customerId) || null;
  renderContent();
  // Load messages
  try {
    const messages = await api('/customers/' + customerId + '/messages');
    state.waSelectedMessages = messages;
    renderContent();
    setTimeout(() => {
      const el = document.getElementById('wa-chat-messages');
      if (el) el.scrollTop = el.scrollHeight;
    }, 50);
  } catch(e) { showToast('خطأ في تحميل الرسائل', 'error'); }
}

function closeMobileChat() {
  if (state.view === 'whatsappChat') {
    state.waSelectedChatId = null;
    state.waSelectedChat = null;
    state.waSelectedMessages = [];
    renderContent();
  } else if (state.view === 'staffChat') {
    state.staffChatSelectedUserId = null;
    state.staffChatSelectedUser = null;
    state.staffChatMessages = [];
    renderContent();
    loadStaffChatConversations();
  }
}

async function sendWAChatMessage() {
  const input = document.getElementById('wa-chat-input');
  const text = input?.value.trim();
  if (!text || !state.waSelectedChatId) return;
  const btn = document.getElementById('wa-chat-send-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'جاري الإرسال...'; }
  try {
    const res = await api('/whatsapp/send', { method: 'POST', body: { customerId: state.waSelectedChatId, text } });
    input.value = '';
    // Append the sent message instantly
    if (res.message) {
      state.waSelectedMessages.push(res.message);
      renderContent();
      setTimeout(() => {
        const el = document.getElementById('wa-chat-messages');
        if (el) el.scrollTop = el.scrollHeight;
        document.getElementById('wa-chat-input')?.focus();
      }, 50);
    }
    // Refresh chat list (updates last message preview)
    loadWAChatList();
  } catch(e) {
    showToast(e.message || 'فشل إرسال الرسالة', 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'إرسال ↩'; }
  }
}

function renderWhatsAppChat() {
  const chats = state.waChatList;
  const selId = state.waSelectedChatId;
  const msgs = state.waSelectedMessages;
  const chat = state.waSelectedChat;

  const listHtml = chats.length === 0
    ? `<div style="text-align:center;color:var(--muted);padding:40px">💬<br>لا توجد محادثات</div>`
    : chats.map(c => `
      <div class="wa-chat-item ${selId === c.id ? 'active' : ''} ${c.unread_count > 0 ? 'unread' : ''}" onclick="selectWAChat(${c.id})">
        <div class="wa-chat-avatar">${esc(c.name.substring(0, 2))}</div>
        <div class="wa-chat-item-info">
          <div class="wa-chat-item-top">
            <span class="wa-chat-item-name">${esc(c.name)}</span>
            <span class="wa-chat-item-time">${fmtTime(c.last_message_at)}</span>
          </div>
          <div class="wa-chat-item-bottom">
            <span class="wa-chat-item-preview">${c.last_message_direction === 'out' ? '← ' : ''}${esc((c.last_message_text || '').substring(0, 45))}</span>
            ${c.unread_count > 0 ? `<span class="wa-unread-badge">${c.unread_count}</span>` : ''}
          </div>
        </div>
      </div>`).join('');

  let panelHtml;
  if (!selId || !chat) {
    panelHtml = `<div class="wa-chat-panel"><div class="wa-chat-empty">
      <div style="font-size:60px;margin-bottom:16px">💬</div>
      <p style="font-size:16px;font-weight:700;color:var(--muted)">اختر محادثة للبدء</p>
      <p style="font-size:13px;color:var(--muted)">اختر عميل من القائمة لعرض المحادثة</p>
    </div></div>`;
  } else {
    panelHtml = `<div class="wa-chat-panel">
      <div class="wa-chat-header">
        <button class="btn btn-ghost btn-sm wa-chat-back-btn" onclick="closeMobileChat()" style="display:none;padding:4px 8px">→</button>
        <div class="wa-chat-avatar">${esc(chat.name.substring(0, 2))}</div>
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px">${esc(chat.name)}</div>
          <div style="font-size:12px;color:var(--muted);direction:ltr;text-align:right">${formatPhone(chat.phone)}</div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="selectCustomer(${chat.id})" title="ملف العميل">👤 ملف العميل</button>
      </div>
      <div class="wa-chat-messages" id="wa-chat-messages">
        ${msgs.length === 0
          ? `<div style="text-align:center;color:var(--muted);padding:40px">لا توجد رسائل</div>`
          : msgs.map(m => `
            <div class="wa-msg-row ${m.direction === 'out' ? 'wa-msg-out' : 'wa-msg-in'}">
              <div class="${m.direction === 'out' ? 'bubble-out' : 'bubble-in'}">
                ${esc(m.text)}
                <div class="wa-msg-meta">${esc(m.user_name || '')} ${fmtTime(m.created_at)}</div>
              </div>
            </div>`).join('')}
      </div>
      <div class="wa-chat-input-bar">
        <input type="text" id="wa-chat-input" placeholder="${waConnected ? 'اكتب رسالة...' : 'واتساب غير متصل'}" onkeydown="if(event.key==='Enter')sendWAChatMessage()" ${!waConnected ? 'disabled' : ''}>
        <button class="btn btn-primary" id="wa-chat-send-btn" onclick="sendWAChatMessage()" ${!waConnected ? 'disabled' : ''}>إرسال ↩</button>
      </div>
    </div>`;
  }

  return `<div class="wa-chat-container ${selId && chat ? 'chat-open' : ''}">
    <div class="wa-chat-list">
      <div class="wa-chat-list-header">
        <div style="font-size:15px;font-weight:700;margin-bottom:10px">💬 المحادثات</div>
        <input type="text" class="wa-chat-search" placeholder="🔍 بحث برقم الهاتف أو الاسم..." value="${esc(state.waChatSearch)}" oninput="onWAChatSearch(this.value)">
      </div>
      <div class="wa-chat-list-items">${listHtml}</div>
    </div>
    ${panelHtml}
  </div>`;
}

// ═══════════════ SETTINGS ═══════════════
// ═══════════════ MODERATOR FORM (TAB) ═══════════════
function renderModeratorForm() {
  const productOpts = state.products.filter(p => p.is_active).map(p => `<option value="${p.id}" data-price="${p.price}">${esc(p.name)} — ${p.price} جنيه</option>`).join('');
  return `<div class="page">
  <div class="card" style="padding:24px;max-width:700px;margin:0 auto">
    <h2 style="font-size:18px;font-weight:800;text-align:center;margin-bottom:20px;color:var(--primary)">📝 إضافة طلب جديد</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="form-group" style="grid-column:1/-1"><label>اسم العميل *</label><input id="mf-name" type="text" placeholder="الاسم الكامل"></div>
      <div class="form-group"><label>رقم الهاتف *</label><input id="mf-phone" type="tel" placeholder="01xxxxxxxxx"></div>
      <div class="form-group"><label>رقم بديل</label><input id="mf-phone2" type="tel" placeholder="01xxxxxxxxx"></div>
      <div class="form-group" style="grid-column:1/-1"><label>العنوان *</label><input id="mf-address" type="text" placeholder="المحافظة — المنطقة — الشارع — رقم العمارة..."></div>
      <div class="form-group"><label>المنتج *</label><select id="mf-product" onchange="updateMFPrice()">${productOpts}</select></div>
      <div class="form-group"><label>الكمية</label><input id="mf-qty" type="number" min="1" value="1" oninput="updateMFPrice()"></div>
      <div class="form-group"><label>السعر (جنيه)</label><input id="mf-price" type="number" min="0" oninput="updateMFTotal()"></div>
      <div class="form-group"><label>الإجمالي</label><input id="mf-total" type="number" min="0" readonly style="background:#f3f4f6;font-weight:700"></div>
      <div class="form-group"><label>كود المودوريتور</label><input id="mf-code" type="text" placeholder="كود المودوريتور"></div>
      <div class="form-group"><label>اسم المودوريتور</label><input id="mf-modname" type="text" placeholder="اسم المودوريتور" value="${esc(state.currentUser?.name || '')}"></div>
      <div class="form-group" style="grid-column:1/-1"><label>صورة انستاباي (اختياري)</label><input id="mf-instapay" type="file" accept="image/*" onchange="previewMFInstapay(event)"></div>
      <div id="mf-instapay-preview" style="grid-column:1/-1"></div>
    </div>
    <div id="mf-msg" style="display:none;padding:10px;border-radius:8px;margin-top:12px;text-align:center;font-weight:600"></div>
    <button id="mf-submit-btn" class="btn btn-primary btn-lg" style="width:100%;margin-top:16px;font-size:15px" onclick="submitModeratorForm()">📦 حفظ الطلب</button>
  </div>
  </div>`;
}

function initMFPrice() {
  setTimeout(() => {
    updateMFPrice();
  }, 50);
}

function updateMFPrice() {
  const sel = document.getElementById('mf-product');
  const qtyEl = document.getElementById('mf-qty');
  const priceEl = document.getElementById('mf-price');
  const totalEl = document.getElementById('mf-total');
  if (!sel || !qtyEl || !priceEl || !totalEl) return;
  const opt = sel.options[sel.selectedIndex];
  const basePrice = parseFloat(opt?.dataset?.price) || 0;
  const qty = parseInt(qtyEl.value) || 1;
  if (!priceEl.dataset.userEdited) {
    priceEl.value = basePrice;
  }
  totalEl.value = (parseFloat(priceEl.value) || 0) * qty;
}

function updateMFTotal() {
  const priceEl = document.getElementById('mf-price');
  const qtyEl = document.getElementById('mf-qty');
  const totalEl = document.getElementById('mf-total');
  if (!priceEl || !qtyEl || !totalEl) return;
  priceEl.dataset.userEdited = 'true';
  totalEl.value = (parseFloat(priceEl.value) || 0) * (parseInt(qtyEl.value) || 1);
}

function previewMFInstapay(event) {
  const file = event.target.files[0];
  const preview = document.getElementById('mf-instapay-preview');
  if (!file || !preview) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    preview.innerHTML = `<img src="${e.target.result}" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid var(--border)">`;
  };
  reader.readAsDataURL(file);
}

async function submitModeratorForm() {
  const name = document.getElementById('mf-name')?.value.trim();
  const phone = document.getElementById('mf-phone')?.value.trim();
  const address = document.getElementById('mf-address')?.value.trim();
  const productId = document.getElementById('mf-product')?.value;

  if (!name) { alert('اسم العميل مطلوب'); return; }
  if (!phone) { alert('رقم الهاتف مطلوب'); return; }
  if (!address) { alert('العنوان مطلوب'); return; }

  const productSel = document.getElementById('mf-product');
  const productName = productSel?.options[productSel.selectedIndex]?.text?.split(' — ')[0] || '';

  let instapayImage = '';
  const fileInput = document.getElementById('mf-instapay');
  if (fileInput?.files[0]) {
    instapayImage = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(fileInput.files[0]);
    });
  }

  const btn = document.getElementById('mf-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...'; }
  const msgEl = document.getElementById('mf-msg');

  try {
    await api('/moderator-orders', { method: 'POST', body: {
      customer_name: name,
      customer_phone: phone,
      customer_phone2: document.getElementById('mf-phone2')?.value || '',
      customer_address: address,
      product_id: parseInt(productId),
      product_name: productName,
      qty: parseInt(document.getElementById('mf-qty')?.value) || 1,
      price: parseFloat(document.getElementById('mf-price')?.value) || 0,
      total: parseFloat(document.getElementById('mf-total')?.value) || 0,
      moderator_code: document.getElementById('mf-code')?.value || '',
      moderator_name: document.getElementById('mf-modname')?.value || '',
      instapay_image: instapayImage
    }});

    // Show success and reset form
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.background = '#dcfce7';
      msgEl.style.color = '#166534';
      msgEl.textContent = '✅ تم حفظ الطلب بنجاح!';
    }
    showToast('تم حفظ الطلب بنجاح');

    // Reset form fields
    ['mf-name','mf-phone','mf-phone2','mf-address','mf-code'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const qtyEl = document.getElementById('mf-qty');
    if (qtyEl) qtyEl.value = '1';
    const priceEl = document.getElementById('mf-price');
    if (priceEl) { priceEl.value = ''; delete priceEl.dataset.userEdited; }
    const totalEl = document.getElementById('mf-total');
    if (totalEl) totalEl.value = '';
    const fileEl = document.getElementById('mf-instapay');
    if (fileEl) fileEl.value = '';
    const previewEl = document.getElementById('mf-instapay-preview');
    if (previewEl) previewEl.innerHTML = '';

    updateMFPrice();

    if (btn) { btn.disabled = false; btn.textContent = '📦 حفظ الطلب'; }
    setTimeout(() => { if (msgEl) msgEl.style.display = 'none'; }, 4000);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📦 حفظ الطلب'; }
    if (msgEl) {
      msgEl.style.display = 'block';
      msgEl.style.background = '#fee2e2';
      msgEl.style.color = '#dc2626';
      msgEl.textContent = '❌ ' + e.message;
    }
  }
}

// ═══════════════ COMPLAINTS ═══════════════
function renderComplaints() {
  if (!state._complaints) {
    loadComplaintsPage(state.complaintsPage);
    return `<div class="page" style="text-align:center;padding:60px">⏳ جاري التحميل...</div>`;
  }

  const complaints = state._complaints;
  const filterSt = state._complaintFilterSt || 'all';
  const statuses = ['open', 'in_progress', 'resolved', 'closed'];
  const statusLabels = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلقة' };
  const statusColors = {
    open:        { bg: '#fef9c3', color: '#a16207' },
    in_progress: { bg: '#dbeafe', color: '#1e40af' },
    resolved:    { bg: '#dcfce7', color: '#166534' },
    closed:      { bg: '#f3f4f6', color: '#374151' }
  };

  const paginationHtml = renderPaginationControls(
    state.complaintsPage,
    state.complaintsTotalPages,
    state.complaintsTotalItems,
    'goToComplaintsPage'
  );

  return `<div class="page">
  <div class="flex gap8 wrap" style="margin-bottom:14px;align-items:center">
    <div class="tabs-bar flex gap6 wrap">
      <div class="tab ${filterSt === 'all' ? 'active' : ''}" onclick="changeComplaintFilter('all')">
        الكل <span class="tab-count">${state.complaintsTotalItems}</span>
      </div>
      ${statuses.map(s => `
        <div class="tab ${filterSt === s ? 'active' : ''}" onclick="changeComplaintFilter('${s}')">
          ${statusLabels[s]}
        </div>`).join("")}
    </div>
    <button class="btn btn-primary" style="margin-right:auto" onclick="openAddComplaintModal()">➕ شكوى جديدة</button>
  </div>

  <div class="card"><div class="tbl-wrap">
    <table class="tbl">
      <thead>
        <tr><th>#</th><th>العميل</th><th class="mob-hide">رقم الشحنة</th><th class="mob-hide">رقم الشكوى</th><th>النوع</th><th class="mob-hide">الفيدباك</th><th>الحالة</th><th class="mob-hide">بواسطة</th><th class="mob-hide">التاريخ</th><th></th></tr>
      </thead>
      <tbody>
      ${complaints.map(c => {
        const sc = statusColors[c.status] || statusColors.open;
        return `<tr>
          <td>${c.id}</td>
          <td>${c.customer_name ? `<span style="cursor:pointer;color:var(--primary);font-weight:600" onclick="selectCustomer(${c.customer_id})">${esc(c.customer_name)}</span>` : '—'}</td>
          <td class="mob-hide">${esc(c.shipment_number || '—')}</td>
          <td class="mob-hide">${esc(c.complaint_number || '—')}</td>
          <td>${esc(c.complaint_type)}</td>
          <td class="mob-hide" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.feedback || '—')}</td>
          <td><span class="badge" style="background:${sc.bg};color:${sc.color}">${statusLabels[c.status] || c.status}</span></td>
          <td class="mob-hide" style="font-size:12px">${esc(c.created_by_name || '—')}</td>
          <td class="mob-hide" style="font-size:12px;color:var(--muted)">${fmtDate(c.created_at)}</td>
          <td>
            <div class="flex gap4">
              <button class="btn btn-ghost btn-sm" onclick="openEditComplaintModal(${c.id})">✏️</button>
              <button class="btn btn-red btn-sm" onclick="deleteComplaint(${c.id})">🗑️</button>
            </div>
          </td>
        </tr>`;
      }).join("")}
      ${complaints.length === 0 ? `<tr><td colspan="10" style="padding:40px;text-align:center;color:var(--muted)">
        <div class="empty-state"><div class="empty-state-icon">📋</div><div class="empty-state-text">لا توجد شكاوي</div></div>
      </td></tr>` : ""}
      </tbody>
    </table>
  </div></div>

  ${paginationHtml}
  </div>`;
}

async function loadComplaintsPage(page) {
  const params = new URLSearchParams();
  params.set('page', page);
  params.set('limit', 50);
  if (state._complaintFilterSt && state._complaintFilterSt !== 'all') {
    params.set('status', state._complaintFilterSt);
  }
  const result = await api('/complaints?' + params.toString());
  state._complaints = result.complaints;
  state._complaintsPagination = result.pagination;
  state.complaintsPage = result.pagination.page;
  state.complaintsTotalPages = result.pagination.pages;
  state.complaintsTotalItems = result.pagination.total;
  renderContent();
}

function goToComplaintsPage(page) {
  if (page < 1 || page > state.complaintsTotalPages) return;
  state.complaintsPage = page;
  loadComplaintsPage(page);
}

function changeComplaintFilter(status) {
  state._complaintFilterSt = status;
  state.complaintsPage = 1;
  state._complaints = null;
  state._complaintsPagination = null;
  loadComplaintsPage(1);
}

function openAddComplaintModal() {
  const customerOpts = `<option value="">— اختر عميل (اختياري) —</option>`;
  openModal("➕ شكوى جديدة", `
    <div class="form-group"><label>العميل</label>
      <input id="comp-cust-search" type="text" placeholder="ابحث باسم أو رقم العميل..." oninput="searchComplaintCustomer(this.value)">
      <select id="comp-cust" style="margin-top:6px">${customerOpts}</select>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label>رقم الشحنة</label><input id="comp-ship" type="text" placeholder="رقم الشحنة..."></div>
      <div class="form-group"><label>رقم الشكوى</label><input id="comp-num" type="text" placeholder="رقم الشكوى..."></div>
    </div>
    <div class="form-group"><label>نوع الشكوى *</label><select id="comp-type">
      <option value="تأخير شحن">تأخير شحن</option>
      <option value="منتج تالف">منتج تالف</option>
      <option value="منتج خطأ">منتج خطأ</option>
      <option value="خدمة عملاء">خدمة عملاء</option>
      <option value="استرجاع">استرجاع</option>
      <option value="أخرى">أخرى</option>
    </select></div>
    <div class="form-group"><label>الفيدباك</label><textarea id="comp-feedback" rows="3" placeholder="تفاصيل الشكوى..."></textarea></div>
    <div class="form-group"><label>الحالة</label><select id="comp-status">
      <option value="open">مفتوحة</option>
      <option value="in_progress">قيد المعالجة</option>
      <option value="resolved">تم الحل</option>
      <option value="closed">مغلقة</option>
    </select></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveNewComplaint()">💾 حفظ</button>`);
}

async function searchComplaintCustomer(query) {
  if (!query || query.length < 2) return;
  try {
    const result = await api('/customers?search=' + encodeURIComponent(query) + '&limit=20');
    const sel = document.getElementById('comp-cust');
    if (!sel) return;
    sel.innerHTML = `<option value="">— اختر عميل —</option>` +
      result.customers.map(c => `<option value="${c.id}">${esc(c.name)} — ${formatPhone(c.phone)}</option>`).join('');
  } catch(e) {}
}

async function saveNewComplaint() {
  try {
    await api('/complaints', { method: 'POST', body: {
      customer_id:      parseInt(document.getElementById("comp-cust")?.value) || null,
      shipment_number:  document.getElementById("comp-ship")?.value || '',
      complaint_number: document.getElementById("comp-num")?.value || '',
      complaint_type:   document.getElementById("comp-type")?.value,
      feedback:         document.getElementById("comp-feedback")?.value || '',
      status:           document.getElementById("comp-status")?.value || 'open'
    }});
    closeModal();
    showToast('تم إضافة الشكوى');
    state._complaints = null;
    loadComplaintsPage(state.complaintsPage);
  } catch (e) { alert(e.message); }
}

function openEditComplaintModal(id) {
  const c = (state._complaints || []).find(x => x.id === id);
  if (!c) return;
  const statusLabels = { open: 'مفتوحة', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلقة' };
  openModal("✏️ تعديل شكوى #" + c.id, `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label>رقم الشحنة</label><input id="ecomp-ship" type="text" value="${esc(c.shipment_number)}"></div>
      <div class="form-group"><label>رقم الشكوى</label><input id="ecomp-num" type="text" value="${esc(c.complaint_number)}"></div>
    </div>
    <div class="form-group"><label>نوع الشكوى</label><select id="ecomp-type">
      ${['تأخير شحن','منتج تالف','منتج خطأ','خدمة عملاء','استرجاع','أخرى'].map(t => `<option ${c.complaint_type === t ? 'selected' : ''}>${t}</option>`).join('')}
    </select></div>
    <div class="form-group"><label>الفيدباك</label><textarea id="ecomp-feedback" rows="3">${esc(c.feedback)}</textarea></div>
    <div class="form-group"><label>الحالة</label><select id="ecomp-status">
      ${['open','in_progress','resolved','closed'].map(s => `<option value="${s}" ${c.status === s ? 'selected' : ''}>${statusLabels[s]}</option>`).join('')}
    </select></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveEditComplaint(${c.id})">💾 حفظ</button>`);
}

async function saveEditComplaint(id) {
  try {
    await api('/complaints/' + id, { method: 'PUT', body: {
      shipment_number:  document.getElementById("ecomp-ship")?.value || '',
      complaint_number: document.getElementById("ecomp-num")?.value || '',
      complaint_type:   document.getElementById("ecomp-type")?.value,
      feedback:         document.getElementById("ecomp-feedback")?.value || '',
      status:           document.getElementById("ecomp-status")?.value
    }});
    closeModal();
    showToast('تم تحديث الشكوى');
    state._complaints = null;
    loadComplaintsPage(state.complaintsPage);
  } catch (e) { alert(e.message); }
}

async function deleteComplaint(id) {
  if (!confirm('هل تريد حذف هذه الشكوى؟')) return;
  try {
    await api('/complaints/' + id, { method: 'DELETE' });
    showToast('تم حذف الشكوى');
    state._complaints = null;
    loadComplaintsPage(state.complaintsPage);
  } catch (e) { alert(e.message); }
}

// ═══════════════ SETTINGS ═══════════════
function renderSettings() {
  return `<div class="page"><div class="grid-2 g2">
    <div class="card" style="padding:18px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">📱 ربط الواتساب</h3>
      <div style="text-align:center;padding:16px">
        <div style="font-size:40px;margin-bottom:10px">${waConnected ? '✅' : '📱'}</div>
        <p style="font-weight:700;color:${waConnected ? '#16a34a' : '#dc2626'};margin-bottom:10px">${waConnected ? 'واتساب متصل' : 'واتساب غير متصل'}</p>
        ${!waConnected
          ? `<button class="btn btn-primary" onclick="showQRModal()">📱 ربط الواتساب الآن</button>`
          : `<p style="font-size:12px;color:var(--muted)">الرقم المتصل جاهز لاستقبال وإرسال الرسائل</p>`}
      </div>
    </div>
    <div class="card" style="padding:18px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">👥 إدارة المستخدمين</h3>
      ${state.users.map(u => `
        <div class="flex gap10" style="padding:8px 0;border-bottom:1px solid var(--border);${u.is_active ? '' : 'opacity:0.5'}">
          ${avHtml(u, 34)}
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${esc(u.name)} ${u.is_active ? '' : '<span style="color:#dc2626;font-size:11px">(معطل)</span>'}</div>
            <div style="font-size:11px;color:var(--muted)">${esc(u.email)} • ${ROLE_LABELS[u.role]}</div>
          </div>
          <div class="flex gap6">
            <button class="btn btn-ghost btn-sm" onclick="openEditUserModal(${u.id})">✏️</button>
            ${u.id !== state.currentUser.id ? `<button class="btn ${u.is_active ? 'btn-red' : 'btn-green'} btn-sm" onclick="toggleUser(${u.id}, ${u.is_active})">${u.is_active ? '🚫' : '✅'}</button>` : ''}
            ${u.id !== state.currentUser.id && can('users:delete') ? `<button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5" onclick="deleteUser(${u.id},'${esc(u.name)}')">🗑️</button>` : ''}
          </div>
        </div>`).join("")}
      <button class="btn btn-primary" style="width:100%;margin-top:12px" onclick="openAddUserModal()">➕ إضافة مستخدم</button>
    </div>
    <div class="card" style="padding:18px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">📋 قوالب واتساب</h3>
      ${state.waTemplates.map(t => `
        <div class="flex gap8" style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:12px;font-weight:700;color:var(--primary)">${esc(t.name)}</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">${esc(t.text.substring(0, 60))}...</div>
          </div>
          <div class="flex gap6">
            <button class="btn btn-ghost btn-sm" onclick="openEditTemplateModal(${t.id})">✏️</button>
            <button class="btn btn-red btn-sm" onclick="deleteTemplate(${t.id})">🗑️</button>
          </div>
        </div>`).join("")}
      <button class="btn btn-ghost" style="width:100%;margin-top:12px" onclick="openAddTemplateModal()">➕ قالب جديد</button>
    </div>
    <div class="card" style="padding:18px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">🫒 المنتجات</h3>
      ${state.products.map(p => `
        <div class="flex jcsb gap8" style="padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px;flex:1">${esc(p.name)}</span>
          <span style="font-weight:700;color:var(--primary)">${p.price} جنيه</span>
          <div class="flex gap6">
            <button class="btn btn-ghost btn-sm" onclick="openEditProductModal(${p.id})">✏️</button>
            <button class="btn btn-red btn-sm" onclick="deleteProduct(${p.id})">🗑️</button>
          </div>
        </div>`).join("")}
      <button class="btn btn-ghost" style="width:100%;margin-top:12px" onclick="openAddProductModal()">➕ منتج جديد</button>
    </div>
    ${can('users:manage') ? `<div class="card" style="padding:18px">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:14px">💾 نسخ احتياطي</h3>
      <p style="font-size:12px;color:var(--muted);margin-bottom:14px">حمّل نسخة من الداتابيز واحفظها عندك. لو الداتا اتمسحت ارفعها تاني.</p>
      <div class="flex gap8" style="flex-wrap:wrap">
        <button class="btn btn-primary" onclick="downloadBackup()">📥 تحميل نسخة احتياطية</button>
        <button class="btn btn-ghost" onclick="document.getElementById('restore-file-input').click()">📤 استعادة من نسخة</button>
        <input type="file" id="restore-file-input" accept=".db" style="display:none" onchange="restoreBackup(event)">
      </div>
      <div id="backup-status" style="margin-top:10px;font-size:12px"></div>
    </div>` : ''}
  </div></div>`;
}

// ═══════════════ ACTIONS ═══════════════
async function quickAction(id, action) {
  try {
    await api('/customers/' + id + '/quick-action', { method: 'POST', body: { action } });
    showToast('تم التحديث');
    await selectCustomer(id);
  } catch (e) { showToast(e.message, 'error'); }
}

async function changeStatus(id, newStatus) {
  try {
    await api('/customers/' + id + '/status', { method: 'PATCH', body: { status: newStatus } });
    showToast('تم تغيير الحالة');
    await selectCustomer(id);
  } catch (e) { showToast(e.message, 'error'); }
}

let _notesTimer;
function updateCustomerNotes(id, notes) {
  clearTimeout(_notesTimer);
  _notesTimer = setTimeout(async () => {
    try { await api('/customers/' + id + '/notes', { method: 'PATCH', body: { notes } }); }
    catch (e) { console.error(e); }
  }, 1000);
}

// ═══════════════ MODAL SYSTEM ═══════════════
function openModal(title, bodyHtml, footerHtml, wide = false) {
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-body").innerHTML    = bodyHtml;
  document.getElementById("modal-footer").innerHTML  = footerHtml;
  document.getElementById("modal-box").className     = "modal-box" + (wide ? " modal-wide" : "");
  document.getElementById("modal-overlay").classList.remove("hidden");
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}
function handleModalClick(e) {
  if (e.target === document.getElementById("modal-overlay")) closeModal();
}

// ═══════════════ ADD CUSTOMER MODAL ═══════════════
function openAddCustomerModal() {
  const agentOpts  = state.users.filter(u => ['call_center','complaints','moderator'].includes(u.role)).map(u => `<option value="${u.id}">${u.name}</option>`).join("");
  const regionOpts = REGIONS.map(r => `<option>${r}</option>`).join("");
  const sourceOpts = SOURCES.map(s => `<option>${s}</option>`).join("");
  openModal("➕ إضافة عميل جديد", `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="grid-column:1/-1"><label>الاسم الكامل *</label><input id="nc-name" type="text" placeholder="محمد أحمد..."></div>
      <div class="form-group"><label>رقم الهاتف الأساسي *</label><input id="nc-phone" type="tel" placeholder="01xxxxxxxxx"></div>
      <div class="form-group"><label>رقم بديل</label><input id="nc-phone2" type="tel" placeholder="01xxxxxxxxx"></div>
      <div class="form-group"><label>المحافظة</label><select id="nc-region">${regionOpts}</select></div>
      <div class="form-group"><label>مصدر العميل</label><select id="nc-source">${sourceOpts}</select></div>
      <div class="form-group" style="grid-column:1/-1"><label>العنوان التفصيلي</label><input id="nc-address" type="text" placeholder="المنطقة - الشارع - رقم العمارة..."></div>
      <div class="form-group"><label>تعيين لموظف</label><select id="nc-agent">${agentOpts}</select></div>
      <div class="form-group" style="grid-column:1/-1"><label>ملاحظات</label><textarea id="nc-notes" rows="3" placeholder="ملاحظات..."></textarea></div>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveNewCustomer()">💾 حفظ</button>`);
  setTimeout(() => document.getElementById("nc-name")?.focus(), 50);
}

async function saveNewCustomer() {
  const name  = document.getElementById("nc-name")?.value.trim();
  const phone = document.getElementById("nc-phone")?.value.trim();
  if (!name)  { alert("الاسم مطلوب");        return; }
  if (!phone) { alert("رقم الهاتف مطلوب");  return; }
  try {
    await api('/customers', { method: 'POST', body: {
      name, phone,
      phone2:     document.getElementById("nc-phone2")?.value  || "",
      region:     document.getElementById("nc-region")?.value,
      source:     document.getElementById("nc-source")?.value,
      assignedTo: parseInt(document.getElementById("nc-agent")?.value),
      notes:      document.getElementById("nc-notes")?.value   || "",
      address:    document.getElementById("nc-address")?.value || ""
    }});
    closeModal();
    showToast('تم إضافة العميل بنجاح');
    loadViewData();
  } catch (e) { alert(e.message); }
}

// ═══════════════ EDIT CUSTOMER MODAL ═══════════════
function openEditCustomerModal() {
  const c = state.selectedCustomer; if (!c) return;
  const agentOpts  = state.users.filter(u => ['call_center','complaints','moderator'].includes(u.role)).map(u => `<option value="${u.id}" ${c.assigned_to === u.id ? "selected" : ""}>${u.name}</option>`).join("");
  const regionOpts = REGIONS.map(r => `<option ${c.region === r ? "selected" : ""}>${r}</option>`).join("");
  const sourceOpts = SOURCES.map(s => `<option ${c.source === s ? "selected" : ""}>${s}</option>`).join("");
  openModal("✏️ تعديل بيانات العميل", `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="grid-column:1/-1"><label>الاسم الكامل</label><input id="ec-name" type="text" value="${esc(c.name)}"></div>
      <div class="form-group"><label>الهاتف الأساسي</label><input id="ec-phone" type="tel" value="${formatPhone(c.phone)}"></div>
      <div class="form-group"><label>رقم بديل</label><input id="ec-phone2" type="tel" value="${formatPhone(c.phone2 || '')}"></div>
      <div class="form-group"><label>المحافظة</label><select id="ec-region">${regionOpts}</select></div>
      <div class="form-group"><label>المصدر</label><select id="ec-source">${sourceOpts}</select></div>
      <div class="form-group" style="grid-column:1/-1"><label>العنوان التفصيلي</label><input id="ec-address" type="text" value="${esc(c.address || '')}"></div>
      <div class="form-group"><label>الموظف</label><select id="ec-agent">${agentOpts}</select></div>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveEditCustomer(${c.id})">💾 حفظ</button>`);
}

async function saveEditCustomer(id) {
  try {
    await api('/customers/' + id, { method: 'PUT', body: {
      name:       document.getElementById("ec-name")?.value,
      phone:      document.getElementById("ec-phone")?.value,
      phone2:     document.getElementById("ec-phone2")?.value,
      region:     document.getElementById("ec-region")?.value,
      source:     document.getElementById("ec-source")?.value,
      assignedTo: parseInt(document.getElementById("ec-agent")?.value),
      address:    document.getElementById("ec-address")?.value || ""
    }});
    closeModal();
    showToast('تم تحديث بيانات العميل');
    await selectCustomer(id);
  } catch (e) { alert(e.message); }
}

// ═══════════════ LOG CALL MODAL ═══════════════
function openLogCallModal() {
  openModal("📞 تسجيل مكالمة", `
    <div class="form-group"><label>نوع المكالمة</label><select id="cl-type"><option value="outgoing">📤 صادرة</option><option value="incoming">📥 واردة</option></select></div>
    <div class="form-group"><label>نتيجة المكالمة</label><select id="cl-result">${["تم التأكيد","رفض","محاوله ثانيه","محاوله ثالثه","تأجيل","تم الشحن","مكرر","خطأ في الرقم"].map(r => `<option>${r}</option>`).join("")}</select></div>
    <div class="form-group"><label>ملاحظات</label><textarea id="cl-notes" rows="3" placeholder="ملاحظات المكالمة..."></textarea></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveLogCall()">حفظ</button>`);
}

async function saveLogCall() {
  const c = state.selectedCustomer; if (!c) return;
  try {
    await api('/customers/' + c.id + '/log-call', { method: 'POST', body: {
      callType: document.getElementById("cl-type")?.value,
      result:   document.getElementById("cl-result")?.value,
      notes:    document.getElementById("cl-notes")?.value
    }});
    closeModal();
    showToast('تم تسجيل المكالمة');
    await selectCustomer(c.id);
  } catch (e) { alert(e.message); }
}

// ═══════════════ ADD ORDER MODAL ═══════════════
function openAddOrderModal() {
  const c = state.selectedCustomer; if (!c) return;
  openModal("🛍️ طلب جديد", `
    <div class="form-group"><label>المنتج</label><select id="ord-prod" onchange="updateOrderTotal()">${state.products.map(p => `<option value="${p.id}" data-price="${p.price}">${p.name} — ${p.price} جنيه</option>`).join("")}</select></div>
    <div class="form-group"><label>الكمية</label><input id="ord-qty" type="number" min="1" max="100" value="1" oninput="updateOrderTotal()"></div>
    <div class="form-group"><label>عنوان التسليم</label><input id="ord-addr" type="text" value="${esc(c.region)}${c.address ? ' - ' + esc(c.address) : ''}"></div>
    <div id="ord-total" style="padding:12px 14px;background:#f0fdf4;border-radius:8px;display:flex;justify-content:space-between;font-size:14px"><span>الإجمالي:</span><span style="font-weight:800;color:#166534">${state.products[0]?.price || 0} جنيه</span></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveOrder()">إنشاء الطلب</button>`);
}

function updateOrderTotal() {
  const sel   = document.getElementById("ord-prod");
  const price = parseInt(sel?.options[sel?.selectedIndex]?.dataset.price || 0);
  const qty   = parseInt(document.getElementById("ord-qty")?.value || 1);
  const el    = document.getElementById("ord-total");
  if (el) el.innerHTML = `<span>الإجمالي:</span><span style="font-weight:800;color:#166534">${price * qty} جنيه</span>`;
}

async function saveOrder() {
  const c = state.selectedCustomer; if (!c) return;
  try {
    await api('/customers/' + c.id + '/orders', { method: 'POST', body: {
      productId: parseInt(document.getElementById("ord-prod")?.value),
      qty:       parseInt(document.getElementById("ord-qty")?.value  || 1),
      address:   document.getElementById("ord-addr")?.value || c.region
    }});
    closeModal();
    showToast('تم إنشاء الطلب بنجاح');
    state._orders = null;
    await selectCustomer(c.id);
  } catch (e) { alert(e.message); }
}

// ═══════════════ WHATSAPP MODAL ═══════════════
function openWAModal() {
  if (!waConnected) {
    showToast('واتساب غير متصل. اربط الواتساب من الإعدادات أولاً', 'error');
    return;
  }
  const templates = state.waTemplates;
  openModal("💬 إرسال رسالة واتساب", `
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px">📋 قوالب جاهزة:</div>
      ${templates.map(t => `
        <div onclick="useWATemplate(${t.id})" style="padding:8px 12px;background:#f9fbf7;border-radius:8px;cursor:pointer;border:1.5px solid var(--border);margin-bottom:6px;font-size:12px;transition:.15s" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="font-weight:700;font-size:11px;color:var(--primary);margin-bottom:2px">${esc(t.name)}</div>
          ${esc(t.text.length > 80 ? t.text.substring(0, 80) + '...' : t.text)}
        </div>`).join("")}
    </div>
    <div class="form-group"><label>الرسالة</label><textarea id="wa-msg" rows="4" placeholder="اكتب رسالتك هنا..."></textarea></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" id="wa-send-btn" onclick="sendWA()">إرسال ✉️</button>`);
}

function useWATemplate(id) {
  const t = state.waTemplates.find(x => x.id === id);
  if (t) {
    const c = state.selectedCustomer;
    let text = t.text;
    if (c) {
      text = text.replace(/\{اسم\}/g,    c.name              || '');
      text = text.replace(/\{name\}/gi,   c.name              || '');
      text = text.replace(/\{هاتف\}/g,    formatPhone(c.phone) || '');
      text = text.replace(/\{محافظة\}/g,  c.region            || '');
    }
    const el = document.getElementById('wa-msg');
    if (el) { el.value = text; el.focus(); }
  }
}

async function sendWA() {
  const c   = state.selectedCustomer; if (!c) return;
  const msg = document.getElementById("wa-msg")?.value.trim();
  if (!msg) { showToast("اكتب الرسالة الأول", 'error'); return; }
  const btn = document.getElementById("wa-send-btn");
  if (btn) { btn.disabled = true; btn.textContent = "جاري الإرسال..."; }
  try {
    await api('/whatsapp/send', { method: 'POST', body: { customerId: c.id, text: msg } });
    closeModal();
    showToast('تم إرسال الرسالة بنجاح ✅');
    await selectCustomer(c.id);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "إرسال ✉️"; }
    showToast(e.message, 'error');
  }
}

// ═══════════════ FOLLOW-UP MODAL ═══════════════
function openFollowUpModal() {
  const c = state.selectedCustomer; if (!c) return;
  const defaultDate = new Date(Date.now() + 86400000).toISOString().substring(0, 10);
  openModal("📅 تحديد موعد متابعة", `
    <div class="form-group"><label>تاريخ المتابعة</label><input id="fu-date" type="date" value="${c.follow_up_date ? c.follow_up_date.substring(0, 10) : defaultDate}"></div>
    <div class="flex wrap gap8">
      ${[1, 2, 3, 7, 14].map(d => `<button class="btn btn-ghost btn-sm" onclick="document.getElementById('fu-date').value=new Date(Date.now()+${d}*86400000).toISOString().substring(0,10)">+${d} ${d === 1 ? 'يوم' : d === 7 ? 'أسبوع' : d === 14 ? 'أسبوعين' : 'أيام'}</button>`).join("")}
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveFollowUp()">حفظ</button>`);
}

async function saveFollowUp() {
  const c = state.selectedCustomer; if (!c) return;
  const date = document.getElementById("fu-date")?.value;
  if (!date) return;
  try {
    await api('/customers/' + c.id + '/followup', { method: 'PATCH', body: { followUpDate: new Date(date).toISOString() } });
    closeModal();
    showToast('تم تحديد موعد المتابعة');
    state.dashboardData = null;
    await selectCustomer(c.id);
  } catch (e) { alert(e.message); }
}

// ═══════════════ EXCEL IMPORT ═══════════════
let importedRows = [];

async function deleteAllCustomers() {
  const count = state.totalItems || 0;
  const confirmed = confirm(`⚠️ تحذير!\n\nهل أنت متأكد من حذف جميع العملاء؟\nعدد العملاء: ${count}\n\nسيتم حذف كل العملاء والطلبات والرسائل والسجلات المرتبطة بهم.\n\nهذا الإجراء لا يمكن التراجع عنه!`);
  if (!confirmed) return;
  const doubleCheck = confirm('⛔ تأكيد نهائي: هل أنت متأكد 100%؟ سيتم حذف كل شيء!');
  if (!doubleCheck) return;
  try {
    const result = await api('/customers/all', { method: 'DELETE' });
    showToast(result.message, 'success');
    state.currentPage = 1;
    await loadCustomersPage(1);
  } catch (e) { showToast(e.message, 'error'); }
}

function openImportModal() {
  openModal("📥 استيراد عملاء من Excel", `
    <div style="text-align:center;padding:20px">
      <div style="font-size:50px;margin-bottom:12px">📊</div>
      <p style="font-weight:700;font-size:15px;margin-bottom:8px">اختر ملف Excel أو CSV</p>
      <p style="font-size:12px;color:var(--muted);margin-bottom:16px">النظام هيحاول يتعرف على الأعمدة تلقائياً</p>
      <button class="btn btn-primary btn-lg" onclick="document.getElementById('excel-file-input').click()">📁 اختر الملف</button>
      <div style="margin-top:20px;text-align:right">
        <p style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px">الأعمدة المدعومة:</p>
        <div style="font-size:11px;color:var(--muted);line-height:2">
          <span class="tag" style="background:#e0f2fe;color:#0369a1">NAME / الاسم</span>
          <span class="tag" style="background:#e0f2fe;color:#0369a1">PHONE / الهاتف</span>
          <span class="tag" style="background:#e0f2fe;color:#0369a1">PHONE 2</span>
          <span class="tag" style="background:#e0f2fe;color:#0369a1">CITY / المحافظة</span>
          <span class="tag" style="background:#e0f2fe;color:#0369a1">Adrees / العنوان</span>
          <span class="tag" style="background:#e0f2fe;color:#0369a1">notes / ملاحظات</span>
          <span class="tag" style="background:#e0f2fe;color:#0369a1">Status / الحالة</span>
          <span class="tag" style="background:#e0f2fe;color:#0369a1">source / المصدر</span>
          <span class="tag" style="background:#e0f2fe;color:#0369a1">price / السعر</span>
          <span class="tag" style="background:#e0f2fe;color:#0369a1">order / المنتج</span>
        </div>
      </div>
    </div>`, '');
}

function handleExcelFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data     = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet    = workbook.Sheets[workbook.SheetNames[0]];
      const json     = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!json.length) { showToast('الملف فاضي!', 'error'); return; }
      mapAndPreview(json, file.name);
    } catch(err) {
      showToast('خطأ في قراءة الملف: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
  event.target.value = '';
}

function mapAndPreview(json, fileName) {
  const colMap = {
    name:    ['NAME', 'الاسم', 'name', 'اسم', 'اسم العميل', 'Customer', 'العميل'],
    phone:   ['PHONE 1', 'PHONE', 'الهاتف', 'هاتف', 'رقم الهاتف', 'phone', 'Phone', 'موبايل', 'الموبايل', 'رقم'],
    phone2:  ['PHONE 2', 'PHONE2', 'هاتف 2', 'هاتف2', 'phone2', 'موبايل 2'],
    region:  ['CITY', 'city', 'المدينة', 'المحافظة', 'محافظة', 'المنطقة', 'منطقة', 'region'],
    address: ['Adrees', 'Address', 'العنوان', 'عنوان', 'address'],
    notes:   ['notes', 'Notes', 'ملاحظات', 'الملاحظات'],
    source:  ['App_source', 'source', 'Source', 'المصدر', 'مصدر'],
    status:  ['Status', 'status', 'الحالة', 'حالة'],
    price:   ['price', 'Price', 'السعر', 'سعر'],
    qty:     ['عدد المطح', 'qty', 'Qty', 'الكمية', 'كمية', 'العدد'],
    product: ['order', 'Order', 'المنتج', 'منتج', 'product', 'Product', 'الطلب'],
  };

  const headers = Object.keys(json[0]);
  const mapped  = {};
  for (const [field, candidates] of Object.entries(colMap)) {
    for (const c of candidates) {
      const found = headers.find(h => h.trim().toLowerCase() === c.toLowerCase() || h.trim() === c);
      if (found) { mapped[field] = found; break; }
    }
  }

  importedRows = json.map(row => ({
    name:    String(row[mapped.name]    || '').trim(),
    phone:   String(row[mapped.phone]   || '').trim(),
    phone2:  String(row[mapped.phone2]  || '').trim(),
    region:  String(row[mapped.region]  || '').trim(),
    address: String(row[mapped.address] || '').trim(),
    notes:   String(row[mapped.notes]   || '').trim(),
    source:  String(row[mapped.source]  || '').trim(),
    status:  String(row[mapped.status]  || '').trim(),
    price:   String(row[mapped.price]   || '').trim(),
    qty:     String(row[mapped.qty]     || '').trim(),
    product: String(row[mapped.product] || '').trim(),
  })).filter(r => r.name && r.phone);

  const preview    = importedRows.slice(0, 8);
  const foundCols  = Object.entries(mapped).filter(([k, v]) => v).map(([k]) => k);
  const colLabels  = { name:'الاسم', phone:'الهاتف', phone2:'هاتف 2', region:'المحافظة', address:'العنوان', notes:'ملاحظات', source:'المصدر', status:'الحالة', price:'السعر', product:'المنتج', qty:'الكمية' };

  openModal("📊 معاينة البيانات — " + fileName, `
    <div class="alert alert-green" style="margin-bottom:12px">✅ تم قراءة <b>${importedRows.length}</b> عميل من الملف</div>
    <div style="margin-bottom:10px;font-size:12px;color:var(--muted)">الأعمدة المكتشفة: ${foundCols.map(c => `<span class="tag" style="background:#dcfce7;color:#166534">${colLabels[c]}</span>`).join(' ')}</div>
    <div style="overflow:auto;max-height:350px">
      <table class="tbl">
        <thead><tr><th>#</th><th>الاسم</th><th>الهاتف</th><th>المحافظة</th><th>الحالة</th><th>المصدر</th></tr></thead>
        <tbody>
          ${preview.map((r, i) => `<tr>
            <td>${i + 1}</td>
            <td style="font-weight:600">${esc(r.name)}</td>
            <td style="direction:ltr;text-align:right">${esc(r.phone)}</td>
            <td>${esc(r.region)}</td>
            <td>${esc(r.status)}</td>
            <td>${esc(r.source)}</td>
          </tr>`).join('')}
          ${importedRows.length > 8 ? `<tr><td colspan="6" style="text-align:center;color:var(--muted);font-size:12px">... و ${importedRows.length - 8} عميل آخر</td></tr>` : ''}
        </tbody>
      </table>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>
     <button class="btn btn-primary" id="import-btn" onclick="doImport()">📥 استيراد ${importedRows.length} عميل</button>`,
    true);
}

async function doImport() {
  if (!importedRows.length) return;
  const btn = document.getElementById('import-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'جاري الاستيراد...'; }
  try {
    let totalImported = 0, totalSkipped = 0, allErrors = [];
    for (let i = 0; i < importedRows.length; i += 100) {
      const batch  = importedRows.slice(i, i + 100);
      const result = await api('/customers/import', { method: 'POST', body: { customers: batch } });
      totalImported += result.imported;
      totalSkipped  += result.skipped;
      if (result.errors) allErrors = allErrors.concat(result.errors);
    }
    closeModal();
    showToast(`تم استيراد ${totalImported} عميل بنجاح${totalSkipped > 0 ? ` (${totalSkipped} مكرر/محذوف)` : ''}`);
    importedRows = [];
    state.currentPage = 1;
    await loadViewData();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📥 إعادة المحاولة'; }
    showToast('خطأ: ' + e.message, 'error');
  }
}

// ═══════════════ QR MODAL ═══════════════
function retryWhatsApp() {
  const container = document.getElementById('qr-container');
  if (container) container.innerHTML = `<div style="font-size:40px;margin-bottom:10px">🔄</div><p style="color:var(--muted)">جاري إعادة الاتصال...</p>`;
  api('/whatsapp/reconnect', 'POST').catch(() => {});
}

function showQRModal() {
  openModal("📱 ربط الواتساب", `
    <div style="text-align:center;padding:20px">
      <div id="qr-container" style="margin-bottom:16px">
        <div style="font-size:40px;margin-bottom:10px">⏳</div>
        <p style="color:var(--muted)">جاري تحميل رمز QR...</p>
        <p style="color:var(--muted);font-size:11px;margin-top:8px">قد يستغرق هذا بضع ثوانٍ</p>
      </div>
    </div>`, '');

  function updateQR() {
    const container = document.getElementById('qr-container');
    if (!container) { clearInterval(qrPollTimer); qrPollTimer = null; return; }
    api('/whatsapp/status').then(status => {
      if (!document.getElementById('qr-container')) { clearInterval(qrPollTimer); qrPollTimer = null; return; }
      if (status.connected) {
        waConnected = true;
        renderSidebar();
        if (state.view === 'settings') renderContent();
        container.innerHTML = `<div style="font-size:40px;margin-bottom:10px">✅</div><p style="color:#16a34a;font-weight:700">واتساب متصل بالفعل!</p>`;
        clearInterval(qrPollTimer); qrPollTimer = null;
        setTimeout(closeModal, 2000);
      } else if (status.authenticated) {
        container.innerHTML = `<div style="font-size:40px;margin-bottom:10px">🔐</div>
          <p style="color:#16a34a;font-weight:600">تم مسح الرمز بنجاح!</p>
          <p style="color:var(--muted);font-size:12px;margin-top:8px">جاري تحميل المحادثات... قد يستغرق دقيقة</p>
          <div style="margin-top:12px;width:50px;height:50px;border:4px solid #e5e7eb;border-top-color:#16a34a;border-radius:50%;animation:spin 1s linear infinite;margin-inline:auto"></div>`;
      } else if (status.qrCode) {
        container.innerHTML = `<img src="${status.qrCode}" style="max-width:280px;border-radius:12px"><p style="margin-top:12px;color:var(--muted);font-size:12px">امسح الرمز بتطبيق واتساب من هاتفك</p>`;
      } else if (status.initializing) {
        container.innerHTML = `<div style="font-size:40px;margin-bottom:10px">⏳</div>
          <p style="color:var(--muted);font-weight:600">جاري تشغيل محرك الواتساب...</p>
          <p style="color:var(--muted);font-size:11px;margin-top:8px">قد يستغرق 30-60 ثانية على السيرفر</p>
          <div style="margin-top:12px;width:50px;height:50px;border:4px solid #e5e7eb;border-top-color:#16a34a;border-radius:50%;animation:spin 1s linear infinite;margin-inline:auto"></div>`;
      } else {
        container.innerHTML = `<div style="font-size:40px;margin-bottom:10px">⏳</div><p style="color:var(--muted)">في انتظار رمز QR من الواتساب...</p><p style="color:var(--muted);font-size:11px;margin-top:8px">تأكد أن السيرفر شغال وبيحاول يتصل</p><button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="retryWhatsApp()">🔄 إعادة المحاولة</button>`;
      }
    }).catch(() => {});
  }

  updateQR();
  if (qrPollTimer) clearInterval(qrPollTimer);
  qrPollTimer = setInterval(updateQR, 3000);
}

// ═══════════════ ADD USER MODAL ═══════════════
function openAddUserModal() {
  openModal("➕ إضافة مستخدم", `
    <div class="form-group"><label>الاسم</label><input id="nu-name" type="text" placeholder="الاسم الكامل"></div>
    <div class="form-group"><label>البريد</label><input id="nu-email" type="email" placeholder="email@crm.com"></div>
    <div class="form-group"><label>كلمة المرور</label><input id="nu-pass" type="password" placeholder="كلمة المرور"></div>
    <div class="form-group"><label>الدور</label><select id="nu-role">
      <option value="call_center">كول سنتر</option>
      <option value="moderator">مودوريتور</option>
      <option value="complaints">مسئول شكاوي</option>
      <option value="supervisor">سوبرفايزر</option>
      <option value="operations">أوبريشن</option>
      <option value="admin">مدير</option>
      <option value="warehouse_manager">🏭 مدير مخزن</option>
      <option value="warehouse_supervisor">🏭 مسئول مخزن</option>
      <option value="warehouse_worker">🏭 عامل مخزن</option>
    </select></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveNewUser()">حفظ</button>`);
}

async function saveNewUser() {
  try {
    await api('/users', { method: 'POST', body: {
      name:     document.getElementById("nu-name")?.value,
      email:    document.getElementById("nu-email")?.value,
      password: document.getElementById("nu-pass")?.value,
      role:     document.getElementById("nu-role")?.value
    }});
    closeModal();
    showToast('تم إضافة المستخدم');
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

// ═══════════════ EDIT USER MODAL ═══════════════
function openEditUserModal(id) {
  const u = state.users.find(x => x.id === id); if (!u) return;
  openModal("✏️ تعديل مستخدم", `
    <div class="form-group"><label>الاسم</label><input id="eu-name" type="text" value="${esc(u.name)}"></div>
    <div class="form-group"><label>البريد</label><input id="eu-email" type="email" value="${esc(u.email)}"></div>
    <div class="form-group"><label>كلمة مرور جديدة (اتركها فارغة للإبقاء)</label><input id="eu-pass" type="password" placeholder="كلمة مرور جديدة..."></div>
    <div class="form-group"><label>الدور</label><select id="eu-role">
      <option value="call_center" ${u.role === 'call_center' ? 'selected' : ''}>كول سنتر</option>
      <option value="moderator"   ${u.role === 'moderator'   ? 'selected' : ''}>مودوريتور</option>
      <option value="complaints"  ${u.role === 'complaints'  ? 'selected' : ''}>مسئول شكاوي</option>
      <option value="supervisor"  ${u.role === 'supervisor'  ? 'selected' : ''}>سوبرفايزر</option>
      <option value="operations"  ${u.role === 'operations'  ? 'selected' : ''}>أوبريشن</option>
      <option value="admin"       ${u.role === 'admin'       ? 'selected' : ''}>مدير</option>
      <option value="warehouse_manager"    ${u.role === 'warehouse_manager'    ? 'selected' : ''}>🏭 مدير مخزن</option>
      <option value="warehouse_supervisor" ${u.role === 'warehouse_supervisor' ? 'selected' : ''}>🏭 مسئول مخزن</option>
      <option value="warehouse_worker"     ${u.role === 'warehouse_worker'     ? 'selected' : ''}>🏭 عامل مخزن</option>
    </select></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveEditUser(${u.id})">💾 حفظ</button>`);
}

async function saveEditUser(id) {
  try {
    const body = {
      name:  document.getElementById("eu-name")?.value,
      email: document.getElementById("eu-email")?.value,
      role:  document.getElementById("eu-role")?.value
    };
    const pass = document.getElementById("eu-pass")?.value;
    if (pass) body.password = pass;
    await api('/users/' + id, { method: 'PUT', body });
    closeModal();
    showToast('تم تحديث المستخدم');
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

async function toggleUser(id, isActive) {
  const action = isActive ? 'تعطيل' : 'تفعيل';
  if (!confirm(`هل تريد ${action} هذا المستخدم؟`)) return;
  try {
    await api('/users/' + id + '/toggle', { method: 'PATCH' });
    showToast(`تم ${action} المستخدم`);
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

async function deleteUser(id, name) {
  if (!confirm(`هل تريد حذف المستخدم "${name}" نهائياً؟`)) return;
  if (!confirm(`تأكيد نهائي: سيتم حذف "${name}" ولن يمكن استعادته. هل أنت متأكد؟`)) return;
  try {
    await api('/users/' + id, { method: 'DELETE' });
    showToast('تم حذف المستخدم نهائياً');
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

// ═══════════════ BACKUP / RESTORE ═══════════════
async function downloadBackup() {
  const statusEl = document.getElementById('backup-status');
  if (statusEl) statusEl.innerHTML = '<span style="color:#2563eb">جاري التحميل...</span>';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const res = await fetch('/api/backup', { headers: { 'Authorization': 'Bearer ' + token } });
    if (!res.ok) throw new Error('فشل التحميل');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `olive-crm-backup-${new Date().toISOString().slice(0,10)}.db`;
    a.click();
    URL.revokeObjectURL(url);
    if (statusEl) statusEl.innerHTML = '<span style="color:#16a34a">تم تحميل النسخة بنجاح ✅</span>';
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626">فشل: ' + e.message + '</span>';
  }
}

async function restoreBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.name.endsWith('.db')) { alert('الملف لازم يكون بصيغة .db'); return; }
  if (!confirm('هل تريد استعادة الداتابيز من هذا الملف؟ سيتم استبدال البيانات الحالية.')) {
    event.target.value = '';
    return;
  }
  const statusEl = document.getElementById('backup-status');
  if (statusEl) statusEl.innerHTML = '<span style="color:#2563eb">جاري الاستعادة...</span>';
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const buffer = await file.arrayBuffer();
    const res = await fetch('/api/restore', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/octet-stream' },
      body: buffer
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    if (statusEl) statusEl.innerHTML = '<span style="color:#16a34a">تم الاستعادة ✅ جاري إعادة تحميل...</span>';
    setTimeout(() => window.location.reload(), 2000);
  } catch (e) {
    if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626">فشل: ' + e.message + '</span>';
  }
  event.target.value = '';
}

// ═══════════════ ADD TEMPLATE MODAL ═══════════════
function openAddTemplateModal() {
  openModal("➕ قالب واتساب جديد", `
    <div class="form-group"><label>اسم القالب</label><input id="nt-name" type="text" placeholder="ترحيب، متابعة..."></div>
    <div class="form-group"><label>نص الرسالة</label><textarea id="nt-text" rows="4" placeholder="نص الرسالة..."></textarea></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveNewTemplate()">حفظ</button>`);
}

async function saveNewTemplate() {
  try {
    await api('/wa-templates', { method: 'POST', body: {
      name: document.getElementById("nt-name")?.value,
      text: document.getElementById("nt-text")?.value
    }});
    closeModal();
    showToast('تم إضافة القالب');
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

// ═══════════════ EDIT TEMPLATE MODAL ═══════════════
function openEditTemplateModal(id) {
  const t = state.waTemplates.find(x => x.id === id); if (!t) return;
  openModal("✏️ تعديل قالب", `
    <div class="form-group"><label>اسم القالب</label><input id="et-name" type="text" value="${esc(t.name)}"></div>
    <div class="form-group"><label>نص الرسالة</label><textarea id="et-text" rows="4">${esc(t.text)}</textarea></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveEditTemplate(${t.id})">💾 حفظ</button>`);
}

async function saveEditTemplate(id) {
  try {
    await api('/wa-templates/' + id, { method: 'PUT', body: {
      name: document.getElementById("et-name")?.value,
      text: document.getElementById("et-text")?.value
    }});
    closeModal();
    showToast('تم تحديث القالب');
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

async function deleteTemplate(id) {
  if (!confirm('هل تريد حذف هذا القالب؟')) return;
  try {
    await api('/wa-templates/' + id, { method: 'DELETE' });
    showToast('تم حذف القالب');
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

// ═══════════════ ADD PRODUCT MODAL ═══════════════
function openAddProductModal() {
  openModal("➕ منتج جديد", `
    <div class="form-group"><label>اسم المنتج</label><input id="np-name" type="text" placeholder="زيت زيتون..."></div>
    <div class="form-group"><label>السعر (جنيه)</label><input id="np-price" type="number" min="1" placeholder="100"></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveNewProduct()">حفظ</button>`);
}

async function saveNewProduct() {
  try {
    await api('/products', { method: 'POST', body: {
      name:  document.getElementById("np-name")?.value,
      price: parseFloat(document.getElementById("np-price")?.value)
    }});
    closeModal();
    showToast('تم إضافة المنتج');
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

// ═══════════════ EDIT PRODUCT MODAL ═══════════════
function openEditProductModal(id) {
  const p = state.products.find(x => x.id === id); if (!p) return;
  openModal("✏️ تعديل منتج", `
    <div class="form-group"><label>اسم المنتج</label><input id="ep-name" type="text" value="${esc(p.name)}"></div>
    <div class="form-group"><label>السعر (جنيه)</label><input id="ep-price" type="number" min="1" value="${p.price}"></div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveEditProduct(${p.id})">💾 حفظ</button>`);
}

async function saveEditProduct(id) {
  try {
    await api('/products/' + id, { method: 'PUT', body: {
      name:  document.getElementById("ep-name")?.value,
      price: parseFloat(document.getElementById("ep-price")?.value)
    }});
    closeModal();
    showToast('تم تحديث المنتج');
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

async function deleteProduct(id) {
  if (!confirm('هل تريد حذف هذا المنتج؟')) return;
  try {
    await api('/products/' + id, { method: 'DELETE' });
    showToast('تم حذف المنتج');
    await loadAppData();
    renderContent();
  } catch (e) { alert(e.message); }
}

// ═══════════════ MODERATOR ORDER FORM ═══════════════
function openModeratorOrderModal() {
  const productOpts = state.products.filter(p => p.is_active).map(p => `<option value="${p.id}" data-price="${p.price}">${esc(p.name)} — ${p.price} جنيه</option>`).join('');
  openModal("📝 طلب جديد — مودوريتور", `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="grid-column:1/-1"><label>اسم العميل *</label><input id="mo-name" type="text" placeholder="الاسم الكامل"></div>
      <div class="form-group"><label>رقم الهاتف *</label><input id="mo-phone" type="tel" placeholder="01xxxxxxxxx"></div>
      <div class="form-group"><label>رقم بديل</label><input id="mo-phone2" type="tel" placeholder="01xxxxxxxxx"></div>
      <div class="form-group" style="grid-column:1/-1"><label>العنوان *</label><input id="mo-address" type="text" placeholder="المحافظة — المنطقة — الشارع..."></div>
      <div class="form-group"><label>المنتج *</label><select id="mo-product" onchange="updateModeratorPrice()">${productOpts}</select></div>
      <div class="form-group"><label>الكمية</label><input id="mo-qty" type="number" min="1" value="1" onchange="updateModeratorPrice()"></div>
      <div class="form-group"><label>السعر (جنيه)</label><input id="mo-price" type="number" min="0"></div>
      <div class="form-group"><label>الإجمالي</label><input id="mo-total" type="number" min="0" readonly style="background:#f3f4f6;font-weight:700"></div>
      <div class="form-group"><label>كود المودوريتور</label><input id="mo-code" type="text" placeholder="كود المودوريتور"></div>
      <div class="form-group"><label>اسم المودوريتور</label><input id="mo-modname" type="text" placeholder="اسم المودوريتور" value="${esc(state.currentUser?.name || '')}"></div>
      <div class="form-group" style="grid-column:1/-1"><label>صورة انستاباي (اختياري)</label><input id="mo-instapay" type="file" accept="image/*" onchange="previewInstapay(event)"></div>
      <div id="mo-instapay-preview" style="grid-column:1/-1"></div>
    </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button><button class="btn btn-primary" onclick="saveModeratorOrder()">📦 حفظ الطلب</button>`, true);

  // Set initial price from first product
  setTimeout(() => updateModeratorPrice(), 50);
}

function updateModeratorPrice() {
  const sel = document.getElementById('mo-product');
  const qtyEl = document.getElementById('mo-qty');
  const priceEl = document.getElementById('mo-price');
  const totalEl = document.getElementById('mo-total');
  if (!sel || !qtyEl || !priceEl || !totalEl) return;

  const opt = sel.options[sel.selectedIndex];
  const basePrice = parseFloat(opt?.dataset?.price) || 0;
  const qty = parseInt(qtyEl.value) || 1;

  if (!priceEl.dataset.userEdited) {
    priceEl.value = basePrice;
  }
  totalEl.value = (parseFloat(priceEl.value) || 0) * qty;

  priceEl.oninput = () => {
    priceEl.dataset.userEdited = 'true';
    totalEl.value = (parseFloat(priceEl.value) || 0) * (parseInt(qtyEl.value) || 1);
  };
}

function previewInstapay(event) {
  const file = event.target.files[0];
  const preview = document.getElementById('mo-instapay-preview');
  if (!file || !preview) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    preview.innerHTML = `<img src="${e.target.result}" style="max-width:200px;max-height:200px;border-radius:8px;border:1px solid var(--border)">`;
  };
  reader.readAsDataURL(file);
}

async function saveModeratorOrder() {
  const name = document.getElementById('mo-name')?.value.trim();
  const phone = document.getElementById('mo-phone')?.value.trim();
  const address = document.getElementById('mo-address')?.value.trim();
  const productId = document.getElementById('mo-product')?.value;

  if (!name) { alert('اسم العميل مطلوب'); return; }
  if (!phone) { alert('رقم الهاتف مطلوب'); return; }
  if (!address) { alert('العنوان مطلوب'); return; }

  const productSel = document.getElementById('mo-product');
  const productName = productSel?.options[productSel.selectedIndex]?.text?.split(' — ')[0] || '';

  let instapayImage = '';
  const fileInput = document.getElementById('mo-instapay');
  if (fileInput?.files[0]) {
    instapayImage = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(fileInput.files[0]);
    });
  }

  const btn = document.querySelector('#modal-footer .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الحفظ...'; }

  try {
    await api('/moderator-orders', { method: 'POST', body: {
      customer_name: name,
      customer_phone: phone,
      customer_phone2: document.getElementById('mo-phone2')?.value || '',
      customer_address: address,
      product_id: parseInt(productId),
      product_name: productName,
      qty: parseInt(document.getElementById('mo-qty')?.value) || 1,
      price: parseFloat(document.getElementById('mo-price')?.value) || 0,
      total: parseFloat(document.getElementById('mo-total')?.value) || 0,
      moderator_code: document.getElementById('mo-code')?.value || '',
      moderator_name: document.getElementById('mo-modname')?.value || '',
      instapay_image: instapayImage
    }});
    closeModal();
    showToast('تم حفظ الطلب بنجاح');
    // Refresh dashboard
    state.dashboardData = null;
    loadViewData();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = '📦 حفظ الطلب'; }
    alert(e.message);
  }
}

// ═══════════════ PRINT INVOICE ═══════════════
async function printInvoice(orderId) {
  // Show a size picker, then defer to doPrintInvoice with the chosen size
  openModal('🖨️ اختر حجم الطباعة', `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <button class="btn btn-primary" style="padding:24px 8px;flex-direction:column" onclick="doPrintInvoice(${orderId}, 'a4')">
        <div style="font-size:22px;margin-bottom:4px">📄</div>
        <div style="font-weight:700">A4</div>
        <div style="font-size:11px;opacity:.8">210 × 297 مم</div>
      </button>
      <button class="btn btn-primary" style="padding:24px 8px;flex-direction:column" onclick="doPrintInvoice(${orderId}, 'a5')">
        <div style="font-size:22px;margin-bottom:4px">📃</div>
        <div style="font-weight:700">A5</div>
        <div style="font-size:11px;opacity:.8">148 × 210 مم</div>
      </button>
      <button class="btn btn-primary" style="padding:24px 8px;flex-direction:column" onclick="doPrintInvoice(${orderId}, 'thermal')">
        <div style="font-size:22px;margin-bottom:4px">🧾</div>
        <div style="font-weight:700">حراري</div>
        <div style="font-size:11px;opacity:.8">80 مم</div>
      </button>
    </div>
  `, `<button class="btn btn-ghost" onclick="closeModal()">إلغاء</button>`);
}

async function doPrintInvoice(orderId, size) {
  closeModal();
  try {
    // Find order from current page data or fetch it
    let order = null;
    let customer = null;

    if (state.selectedCustomer && state.selectedCustomer.orders) {
      order = state.selectedCustomer.orders.find(o => o.id === orderId);
      customer = state.selectedCustomer;
    }
    if (!order && state._orders) {
      order = state._orders.find(o => o.id === orderId);
    }

    if (!order) {
      showToast('لم يتم العثور على الطلب', 'error');
      return;
    }

    if (!customer && order.customer_id) {
      try { customer = await api('/customers/' + order.customer_id); } catch(e) {}
    }

    const custName = customer ? customer.name : (order.customer_name || '—');
    const custPhone = customer ? formatPhone(customer.phone) : '';
    const custRegion = customer ? (customer.region || '') : (order.customer_region || '');
    const custAddress = customer ? (customer.address || '') : '';
    const fullAddr = [custRegion, custAddress].filter(Boolean).join(' — ');

    const isThermal = size === 'thermal';
    const isA5 = size === 'a5';

    // Page geometry
    const pageSize = isThermal ? '80mm auto' : (isA5 ? 'A5' : 'A4');
    const bodyPad = isThermal ? '4mm' : (isA5 ? '12mm' : '18mm');
    const bodyWidth = isThermal ? '72mm' : 'auto';

    // Typography
    const baseFont = isThermal ? '11px' : (isA5 ? '12px' : '13px');
    const h1Font = isThermal ? '16px' : (isA5 ? '22px' : '28px');
    const h3Font = isThermal ? '12px' : (isA5 ? '13px' : '15px');
    const tableFont = isThermal ? '10px' : (isA5 ? '12px' : '13px');
    const cellPad = isThermal ? '4px 4px' : (isA5 ? '6px 8px' : '10px 14px');

    let invoiceHtml;

    if (isThermal) {
      // Receipt-style single column, no fancy colors/borders
      invoiceHtml = `
        <div class="r-header">
          <div class="r-title">🫒 Olive CRM</div>
          <div class="r-sub">فاتورة #${order.id}</div>
          <div class="r-sub">${fmtDate(order.created_at)}</div>
        </div>
        <div class="r-divider"></div>
        <div class="r-row"><b>العميل:</b> ${esc(custName)}</div>
        ${custPhone ? `<div class="r-row"><b>الهاتف:</b> <span style="direction:ltr;display:inline-block">${esc(custPhone)}</span></div>` : ''}
        ${fullAddr ? `<div class="r-row"><b>العنوان:</b> ${esc(fullAddr)}</div>` : ''}
        ${order.address ? `<div class="r-row"><b>التوصيل:</b> ${esc(order.address)}</div>` : ''}
        <div class="r-divider"></div>
        <div class="r-row" style="font-weight:700">${esc(order.product_name)}</div>
        <div class="r-row r-flex"><span>الكمية × السعر</span><span>${order.qty} × ${order.price}</span></div>
        <div class="r-divider"></div>
        <div class="r-row r-flex" style="font-size:13px;font-weight:800"><span>الإجمالي</span><span>${order.total} جنيه</span></div>
        <div class="r-divider"></div>
        <div class="r-footer">شكراً لتعاملكم معنا</div>
      `;
    } else {
      invoiceHtml = `
        <div class="invoice-header">
          <h1>🫒 Olive CRM</h1>
          <p>نظام إدارة علاقات العملاء</p>
          <div class="invoice-id">فاتورة رقم: <b>#${order.id}</b> • التاريخ: <b>${fmtDate(order.created_at)}</b></div>
        </div>
        <div class="invoice-section">
          <h3>👤 بيانات العميل</h3>
          <div class="info-grid">
            <div class="info-item"><span class="label">الاسم: </span><span class="value">${esc(custName)}</span></div>
            <div class="info-item"><span class="label">الهاتف: </span><span class="value" style="direction:ltr;display:inline-block">${esc(custPhone)}</span></div>
            ${fullAddr ? `<div class="info-item" style="grid-column:1/-1"><span class="label">العنوان: </span><span class="value">${esc(fullAddr)}</span></div>` : ''}
          </div>
        </div>
        <div class="invoice-section">
          <h3>📦 تفاصيل الطلب</h3>
          <table>
            <thead><tr><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>
              <tr>
                <td>${esc(order.product_name)}</td>
                <td>${order.qty}</td>
                <td>${order.price} جنيه</td>
                <td style="font-weight:700">${order.total} جنيه</td>
              </tr>
            </tbody>
            <tfoot>
              <tr class="total-row"><td colspan="3">الإجمالي الكلي</td><td>${order.total} جنيه</td></tr>
            </tfoot>
          </table>
        </div>
        ${order.address ? `<div class="invoice-section"><h3>🏠 عنوان التوصيل</h3><p style="font-size:${tableFont}">${esc(order.address)}</p></div>` : ''}
        <div class="invoice-footer">
          <p>شكراً لتعاملكم معنا — Olive CRM</p>
          <p>تم الطباعة في: ${new Date().toLocaleDateString('ar-EG')} ${new Date().toLocaleTimeString('ar-EG')}</p>
        </div>
      `;
    }

    const w = window.open('', '_blank', 'width=800,height=600');
    w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>فاتورة #${order.id}</title>
<style>
  @page { size: ${pageSize}; margin: ${isThermal ? '2mm' : '8mm'}; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Cairo', 'Segoe UI', Arial, sans-serif; padding: ${bodyPad}; color: #1a1a1a; direction: rtl; font-size: ${baseFont}; ${isThermal ? `width:${bodyWidth};` : ''} }

  /* A4/A5 layout */
  .invoice-header { text-align: center; margin-bottom: ${isA5 ? '14px' : '24px'}; border-bottom: 3px solid #1e4d0f; padding-bottom: ${isA5 ? '10px' : '16px'}; }
  .invoice-header h1 { font-size: ${h1Font}; color: #1e4d0f; margin-bottom: 4px; }
  .invoice-header p { color: #666; font-size: ${baseFont}; }
  .invoice-id { font-size: ${baseFont}; color: #666; margin-top: 6px; }
  .invoice-section { margin-bottom: ${isA5 ? '14px' : '20px'}; }
  .invoice-section h3 { font-size: ${h3Font}; font-weight: 700; color: #1e4d0f; margin-bottom: 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
  .info-item { font-size: ${tableFont}; }
  .info-item .label { color: #666; font-weight: 600; }
  .info-item .value { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { padding: ${cellPad}; text-align: right; border: 1px solid #e5e7eb; font-size: ${tableFont}; }
  th { background: #f0fdf4; color: #1e4d0f; font-weight: 700; }
  .total-row { background: #f0fdf4; font-weight: 800; font-size: ${h3Font}; color: #1e4d0f; }
  .invoice-footer { text-align: center; margin-top: ${isA5 ? '20px' : '30px'}; padding-top: 12px; border-top: 2px solid #e5e7eb; color: #999; font-size: 10px; }

  /* Thermal (receipt) layout */
  .r-header { text-align: center; margin-bottom: 4px; }
  .r-title { font-size: ${h1Font}; font-weight: 800; }
  .r-sub { font-size: ${baseFont}; color: #333; }
  .r-row { margin: 2px 0; line-height: 1.4; word-wrap: break-word; }
  .r-flex { display: flex; justify-content: space-between; gap: 6px; }
  .r-divider { border-top: 1px dashed #000; margin: 4px 0; }
  .r-footer { text-align: center; margin-top: 6px; font-size: 10px; }

  @media print { body { padding: ${bodyPad}; } }
</style>
</head>
<body>${invoiceHtml}</body>
</html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  } catch (e) {
    console.error('Print invoice error:', e);
    showToast('خطأ في طباعة الفاتورة', 'error');
  }
}

// ═══════════════ ONLINE USERS TOPBAR ═══════════════
function renderOnlineUsers() {
  const el = document.getElementById('topbar-online');
  if (!el) return;
  const me = state.currentUser?.id;
  const others = state.onlineUsers.filter(u => u.id !== me);
  if (others.length === 0) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = others.map(u => `
    <div class="online-avatar" style="background:${u.color || '#6366f1'}" title="${esc(u.name)}" onclick="openQuickChat(${u.id})">
      ${esc(u.avatar_initials || '')}
      <span class="online-dot"></span>
    </div>
  `).join('');
}

function openQuickChat(userId) {
  state.staffChatSelectedUserId = userId;
  setView('staffChat');
}

// ═══════════════ STAFF CHAT ═══════════════
async function loadStaffUnreadCount() {
  try {
    const data = await api('/staff-chat/unread-count');
    state.staffChatUnreadTotal = data.count || 0;
    renderSidebar();
  } catch(e) {}
}

async function loadStaffChatConversations() {
  try {
    const data = await api('/staff-chat/conversations');
    state.staffChatConversations = data;
    if (state.view === 'staffChat') {
      renderStaffChatList();
    }
  } catch(e) { console.error('Load staff conversations error:', e); }
}

async function selectStaffChat(userId) {
  state.staffChatSelectedUserId = userId;
  const conv = state.staffChatConversations.find(c => c.user.id === userId);
  state.staffChatSelectedUser = conv ? conv.user : state.users.find(u => u.id === userId);
  try {
    const messages = await api('/staff-chat/messages/' + userId);
    state.staffChatMessages = messages;
    // Mark as read via socket
    socket.emit('staff:messages:read', { fromUserId: userId });
    // Update unread count
    if (conv && conv.unread > 0) {
      state.staffChatUnreadTotal = Math.max(0, state.staffChatUnreadTotal - conv.unread);
      conv.unread = 0;
      renderSidebar();
    }
    renderStaffChatPanel();
    renderStaffChatList();
    // On mobile: show chat panel full screen
    document.querySelector('.wa-chat-container')?.classList.add('chat-open');
  } catch(e) { showToast(e.message, 'error'); }
}

function sendStaffMessage() {
  const input = document.getElementById('staff-chat-input');
  if (!input) return;
  const text = input.value.trim();
  if (!text || !state.staffChatSelectedUserId) return;
  socket.emit('staff:message', { toUserId: state.staffChatSelectedUserId, text });
  input.value = '';
  input.focus();
}

function renderStaffChat() {
  return `<div class="wa-chat-container ${state.staffChatSelectedUserId ? 'chat-open' : ''}" style="height:calc(100vh - 56px)">
    <div class="wa-chat-list" id="staff-chat-list-panel">
      <div style="padding:10px">
        <input type="text" class="search-box" placeholder="🔍 بحث..." value="${esc(state.staffChatSearch)}" oninput="onStaffChatSearch(this.value)">
      </div>
      <div id="staff-chat-list"></div>
    </div>
    <div class="wa-chat-panel" id="staff-chat-panel">
      <div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:14px">
        اختر محادثة للبدء 🗨️
      </div>
    </div>
  </div>`;
}

function renderStaffChatList() {
  const el = document.getElementById('staff-chat-list');
  if (!el) return;
  let convs = state.staffChatConversations;
  if (state.staffChatSearch) {
    const s = state.staffChatSearch.toLowerCase();
    convs = convs.filter(c => c.user.name.toLowerCase().includes(s));
  }
  if (convs.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">لا توجد محادثات</div>';
    return;
  }
  el.innerHTML = convs.map(c => {
    const u = c.user;
    const isSelected = state.staffChatSelectedUserId === u.id;
    const isOnline = c.online;
    const preview = c.lastMessage ? (c.lastMessageFromMe ? 'أنت: ' : '') + c.lastMessage.substring(0, 35) : '';
    return `<div class="wa-chat-item ${isSelected ? 'active' : ''}" onclick="selectStaffChat(${u.id})">
      <div style="position:relative;flex-shrink:0">
        <div class="av" style="width:40px;height:40px;background:${u.color || '#6366f1'};font-size:14px">${esc(u.avatar_initials || '')}</div>
        ${isOnline ? '<span class="online-dot" style="bottom:1px;right:1px"></span>' : ''}
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-weight:600;font-size:13px">${esc(u.name)}</span>
          <span style="font-size:10px;color:var(--muted)">${c.lastMessageAt ? fmtTime(c.lastMessageAt) : ''}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:2px">
          <span style="font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(preview) || '<span style="color:#ccc">ابدأ محادثة</span>'}</span>
          ${c.unread > 0 ? `<span class="sb-badge" style="font-size:10px;min-width:18px;height:18px">${c.unread}</span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderStaffChatPanel() {
  const panel = document.getElementById('staff-chat-panel');
  if (!panel) return;
  const u = state.staffChatSelectedUser;
  if (!u) {
    panel.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:14px">اختر محادثة للبدء 🗨️</div>';
    return;
  }
  const isOnline = state.onlineUsers.some(ou => ou.id === u.id);
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);background:#fafafa">
      <button class="btn btn-ghost btn-sm wa-chat-back-btn" onclick="closeMobileChat()" style="display:none;padding:4px 8px">→</button>
      <div style="position:relative">
        <div class="av" style="width:36px;height:36px;background:${u.color || '#6366f1'};font-size:13px">${esc(u.avatar_initials || '')}</div>
        ${isOnline ? '<span class="online-dot" style="bottom:1px;right:1px"></span>' : ''}
      </div>
      <div>
        <div style="font-weight:700;font-size:14px">${esc(u.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${isOnline ? '🟢 متصل' : '⚪ غير متصل'}</div>
      </div>
    </div>
    <div id="staff-chat-messages" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:4px"></div>
    <div style="display:flex;gap:8px;padding:10px 16px;border-top:1px solid var(--border);background:#fafafa">
      <input id="staff-chat-input" type="text" class="search-box" style="flex:1;margin:0" placeholder="اكتب رسالة..." onkeydown="if(event.key==='Enter')sendStaffMessage()">
      <button class="btn btn-primary btn-sm" onclick="sendStaffMessage()">إرسال</button>
    </div>`;
  renderStaffChatMessages();
}

function renderStaffChatMessages() {
  const el = document.getElementById('staff-chat-messages');
  if (!el) return;
  const me = state.currentUser?.id;
  if (state.staffChatMessages.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;margin-top:40px">لا توجد رسائل بعد. ابدأ المحادثة! 💬</div>';
    return;
  }
  el.innerHTML = state.staffChatMessages.map(m => {
    const isMe = m.from_user_id === me;
    return `<div class="staff-msg ${isMe ? 'me' : 'other'}">
      <div class="bubble">${esc(m.text)}</div>
      <div class="msg-time">${fmtTime(m.created_at)}</div>
    </div>`;
  }).join('');
  el.scrollTop = el.scrollHeight;
}

function onStaffChatSearch(val) {
  state.staffChatSearch = val;
  renderStaffChatList();
}

// ═══════════════ SOCKET.IO EVENTS ═══════════════
socket.on('connect', () => {
  identifySocket();
});

socket.on('users:online', (users) => {
  state.onlineUsers = users || [];
  renderOnlineUsers();
});

socket.on('staff:message:new', (msg) => {
  if (!state.currentUser) return;
  const me = state.currentUser.id;
  const otherId = msg.from_user_id === me ? msg.to_user_id : msg.from_user_id;

  // If viewing this conversation, append and mark read
  if (state.view === 'staffChat' && state.staffChatSelectedUserId === otherId) {
    state.staffChatMessages.push(msg);
    renderStaffChatMessages();
    if (msg.from_user_id !== me) {
      socket.emit('staff:messages:read', { fromUserId: otherId });
    }
  } else if (msg.from_user_id !== me) {
    // Not viewing: increment unread + toast
    state.staffChatUnreadTotal++;
    renderSidebar();
    const sender = state.users.find(u => u.id === msg.from_user_id);
    showToast(`💬 رسالة من ${sender ? sender.name : 'مستخدم'}: ${msg.text.substring(0, 40)}`, 'success');
  }

  // Update conversations list if on staffChat view
  if (state.view === 'staffChat') {
    loadStaffChatConversations();
  }
});

socket.on('whatsapp:qr', ({ qrDataUrl }) => {
  waConnected = false;
  latestQR    = qrDataUrl;
  renderSidebar();
  const container = document.getElementById('qr-container');
  if (container) {
    container.innerHTML = `<img src="${qrDataUrl}" style="max-width:280px;border-radius:12px"><p style="margin-top:12px;color:var(--muted);font-size:12px">امسح الرمز بتطبيق واتساب من هاتفك</p>`;
  }
});

socket.on('whatsapp:authenticated', () => {
  const container = document.getElementById('qr-container');
  if (container) {
    container.innerHTML = `<div style="font-size:40px;margin-bottom:10px">🔐</div>
      <p style="color:#16a34a;font-weight:600">تم مسح الرمز بنجاح!</p>
      <p style="color:var(--muted);font-size:12px;margin-top:8px">جاري تحميل المحادثات... قد يستغرق دقيقة</p>
      <div style="margin-top:12px;width:50px;height:50px;border:4px solid #e5e7eb;border-top-color:#16a34a;border-radius:50%;animation:spin 1s linear infinite;margin-inline:auto"></div>`;
  }
});

socket.on('whatsapp:ready', ({ phoneNumber }) => {
  waConnected = true;
  renderSidebar();
  if (state.view === 'settings') renderContent();
  showToast('✅ تم ربط الواتساب بنجاح!');
  const container = document.getElementById('qr-container');
  if (container) {
    container.innerHTML = `<div style="font-size:40px;margin-bottom:10px">✅</div><p style="color:#16a34a;font-weight:700">تم الربط بنجاح!</p>`;
    setTimeout(closeModal, 2000);
  }
});

socket.on('whatsapp:disconnected', () => {
  waConnected = false;
  renderSidebar();
  showToast('واتساب انقطع الاتصال', 'error');
});

socket.on('whatsapp:status', ({ initializing, error }) => {
  const container = document.getElementById('qr-container');
  if (container && initializing) {
    container.innerHTML = `<div style="font-size:40px;margin-bottom:10px">⏳</div>
      <p style="color:var(--muted);font-weight:600">جاري تشغيل محرك الواتساب...</p>
      <p style="color:var(--muted);font-size:11px;margin-top:8px">قد يستغرق 30-60 ثانية على السيرفر</p>
      <div style="margin-top:12px;width:60px;height:60px;border:4px solid #e5e7eb;border-top-color:#16a34a;border-radius:50%;animation:spin 1s linear infinite;margin-inline:auto"></div>`;
  }
  if (container && error) {
    container.innerHTML = `<div style="font-size:40px;margin-bottom:10px">❌</div><p style="color:#dc2626;font-weight:600">${error}</p>`;
  }
});

socket.on('customer:updated', ({ customer }) => {
  // Refresh list if on customers page
  if (state.view === 'customers') {
    const idx = state.customers.findIndex(c => c.id === customer.id);
    if (idx !== -1) {
      state.customers[idx] = { ...state.customers[idx], ...customer };
      renderContent();
    }
  }
  // Refresh detail if viewing this customer
  if (state.view === 'customerDetail' && state.selectedCustomer && state.selectedCustomer.id === customer.id) {
    selectCustomer(customer.id);
  }
});

socket.on('message:new', ({ customerId, customerName, message, isNewCustomer }) => {
  const isViewingThisChat = state.view === 'whatsappChat' && state.waSelectedChatId === customerId;

  if (message.direction === 'in') {
    if (!isViewingThisChat) {
      newMessageCount++;
      renderSidebar();

      // Play notification sound
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.frequency.value = 880; osc.type = 'sine';
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.5);
      } catch(e) {}

      const name = customerName || 'عميل';
      const preview = (message.text || '').substring(0, 80);

      // In-app big notification banner
      showWANotification(customerId, name, preview, isNewCustomer);

      // Browser notification (when tab not focused)
      if (document.hidden && Notification.permission === 'granted') {
        const n = new Notification(isNewCustomer ? '📱 عميل جديد من واتساب' : `📩 رسالة من ${name}`, {
          body: preview,
          icon: '🫒',
          tag: 'wa-' + customerId
        });
        n.onclick = () => { window.focus(); selectCustomer(customerId); n.close(); };
      }
    }
  }

  // Real-time update for WhatsApp Chat view
  if (state.view === 'whatsappChat') {
    // If viewing this customer's chat, append message directly
    if (isViewingThisChat) {
      state.waSelectedMessages.push(message);
      const chatArea = document.getElementById('wa-chat-messages');
      if (chatArea) {
        chatArea.insertAdjacentHTML('beforeend', `
          <div class="wa-msg-row ${message.direction === 'out' ? 'wa-msg-out' : 'wa-msg-in'}">
            <div class="${message.direction === 'out' ? 'bubble-out' : 'bubble-in'}">
              ${esc(message.text)}
              <div class="wa-msg-meta">${esc(message.user_name || '')} ${fmtTime(message.created_at)}</div>
            </div>
          </div>`);
        chatArea.scrollTop = chatArea.scrollHeight;
      }
    }
    // Refresh chat list in background
    loadWAChatList();
  }

  // If viewing this customer's detail chat tab, refresh
  if (state.selectedCustomer && state.selectedCustomer.id === customerId && state.activeTab === 'whatsapp') {
    selectCustomer(customerId);
  }
});

// ═══════════════ INIT ═══════════════
window.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
tryAutoLogin();
