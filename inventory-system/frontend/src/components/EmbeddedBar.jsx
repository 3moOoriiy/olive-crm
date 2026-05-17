import { useLocation } from 'react-router-dom';
import { FiArrowRight, FiLogOut, FiMenu } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';
import PillNav from './PillNav';

// Olive icon as inline SVG data URI (no extra asset needed)
const LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(`
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='#22c55e'>
  <path d='M12 2C8.13 2 5 5.13 5 9c0 1.74.78 3.33 2 4.46V20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-6.54c1.22-1.13 2-2.72 2-4.46 0-3.87-3.13-7-7-7zm0 12c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z'/>
</svg>
`);

const NAV_ITEMS = [
  { label: 'الرئيسية', href: '/' },
  { label: 'المنتجات', href: '/products', perm: 'products:read' },
  { label: 'نقطة البيع', href: '/pos', perm: 'invoices:create' },
  { label: 'الفواتير', href: '/invoices', perm: 'invoices:read' },
  { label: 'المخزون', href: '/inventory', perm: 'inventory:read' },
  { label: 'التقارير', href: '/reports', perm: 'reports:read' },
];

export default function EmbeddedBar({ onToggleSidebar }) {
  const { user, hasPermission, logout } = useAuth();
  const location = useLocation();

  const goBack = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'inventory-back' }, '*');
    }
  };

  const handleLogout = async () => {
    try { await logout?.(); } catch (_) {}
    goBack();
  };

  const visibleItems = NAV_ITEMS.filter(it => !it.perm || (hasPermission && hasPermission(it.perm)));

  return (
    <header className="sticky top-0 z-30 bg-gradient-to-l from-[#0f2a06] via-[#143509] to-[#1a4a0d] shadow-lg">
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          onClick={goBack}
          className="flex items-center gap-1 px-3 py-2 rounded-full bg-white/15 hover:bg-white/25 transition text-sm font-semibold whitespace-nowrap text-white"
          title="رجوع للـ CRM"
        >
          <FiArrowRight size={16} />
          <span>رجوع</span>
        </button>

        <button
          onClick={onToggleSidebar}
          className="flex items-center justify-center w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 transition text-white"
          title="القائمة الكاملة"
        >
          <FiMenu size={18} />
        </button>

        <div className="flex-1 min-w-0">
          <PillNav
            logo={LOGO}
            logoAlt="نظام المخزن"
            items={visibleItems}
            activeHref={location.pathname}
            baseColor="#22c55e"
            pillColor="#0a1f04"
            hoveredPillTextColor="#0a1f04"
            pillTextColor="#ffffff"
            initialLoadAnimation={false}
          />
        </div>

        <div className="flex items-center gap-2 text-xs whitespace-nowrap text-white">
          <span className="opacity-80 hidden sm:inline">{user?.name}</span>
          <button onClick={handleLogout} title="تسجيل الخروج" className="p-2 rounded-full hover:bg-white/15">
            <FiLogOut size={16} />
          </button>
        </div>
      </div>
    </header>
  );
}
