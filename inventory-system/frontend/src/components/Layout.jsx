import { useState, useEffect, useRef } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import EmbeddedBar from './EmbeddedBar';
import PillNav from './PillNav';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';

const isEmbedded = () => new URLSearchParams(window.location.search).get('embedded') === '1';

const PILL_LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='#22c55e'><path d='M12 2C8.13 2 5 5.13 5 9c0 1.74.78 3.33 2 4.46V20a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-6.54c1.22-1.13 2-2.72 2-4.46 0-3.87-3.13-7-7-7zm0 12c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z'/></svg>`);

const PILL_ITEMS = [
  { label: 'الرئيسية', href: '/' },
  { label: 'المنتجات', href: '/products', perm: 'products:read' },
  { label: 'نقطة البيع', href: '/pos', perm: 'invoices:create' },
  { label: 'الفواتير', href: '/invoices', perm: 'invoices:read' },
  { label: 'المخزون', href: '/inventory', perm: 'inventory:read' },
  { label: 'التقارير', href: '/reports', perm: 'reports:read' },
];

function EmbeddedPillNav() {
  const { hasPermission } = useAuth();
  const location = useLocation();
  const items = PILL_ITEMS.filter(it => !it.perm || (hasPermission && hasPermission(it.perm)));
  return (
    <div className="flex justify-center py-3 px-3" style={{ background: 'linear-gradient(180deg, #fff, #f0fdf4)', borderBottom: '1px solid rgba(34,197,94,.2)' }}>
      <PillNav
        logo={PILL_LOGO}
        logoAlt="نظام المخزن"
        items={items}
        activeHref={location.pathname}
        baseColor="#22c55e"
        pillColor="#0a1f04"
        hoveredPillTextColor="#0a1f04"
        pillTextColor="#ffffff"
        initialLoadAnimation={false}
      />
    </div>
  );
}

function useLowStockAlert() {
  const hasLowStock = useRef(false);
  const soundPlayed = useRef(false);

  useEffect(() => {
    const checkLowStock = async () => {
      try {
        const { data } = await api.get('/reports/low-stock');
        hasLowStock.current = data?.length > 0;
      } catch (_) {}
    };

    // Play sound directly inside click handler - this is the ONLY way
    // browsers allow audio to play (AudioContext must be created in user gesture)
    const onClick = () => {
      if (hasLowStock.current && !soundPlayed.current) {
        soundPlayed.current = true;
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const now = ctx.currentTime;

          [
            [880, 0, 0.15],
            [880, 0.25, 0.15],
            [660, 0.5, 0.3],
          ].forEach(([freq, start, dur]) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'square';
            osc.frequency.value = freq;
            gain.gain.value = 0.25;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + start);
            osc.stop(now + start + dur);
          });

          setTimeout(() => ctx.close(), 2000);
        } catch (_) {}
      }
    };

    document.addEventListener('click', onClick);
    checkLowStock();

    const interval = setInterval(() => {
      soundPlayed.current = false;
      checkLowStock();
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
      document.removeEventListener('click', onClick);
    };
  }, []);
}

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const embedded = isEmbedded();

  useLowStockAlert();

  const toggleSidebar = () => setSidebarOpen((prev) => !prev);
  const closeSidebar = () => setSidebarOpen(false);

  if (embedded) {
    // Navigation handled by the parent CRM PillNav (postMessage bridge)
    return (
      <div dir="rtl" className="flex flex-col min-h-screen bg-gray-50 font-sans">
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div dir="rtl" className="flex h-screen bg-gray-50 font-sans">
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={closeSidebar} />

      {/* Main content area */}
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        {/* Header */}
        <Header onToggleSidebar={toggleSidebar} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
