import { FiArrowRight, FiLogOut, FiMenu } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';

export default function EmbeddedBar({ onToggleSidebar }) {
  const { user, logout } = useAuth();

  const goBack = () => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'inventory-back' }, '*');
    }
  };

  const handleLogout = async () => {
    try { await logout?.(); } catch (_) {}
    goBack();
  };

  return (
    <header className="sticky top-0 z-30 bg-[#1e4d0f] text-white shadow-md">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={goBack}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-sm font-semibold whitespace-nowrap"
          title="رجوع للـ CRM"
        >
          <FiArrowRight size={16} />
          <span>رجوع</span>
        </button>

        <button
          onClick={onToggleSidebar}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition text-sm font-semibold whitespace-nowrap"
          title="القائمة"
        >
          <FiMenu size={16} />
          <span>القائمة</span>
        </button>

        <div className="text-sm font-bold flex-1 text-center">
          🏭 نظام المخزن
        </div>

        <div className="flex items-center gap-2 text-xs whitespace-nowrap">
          <span className="opacity-80 hidden sm:inline">{user?.name}</span>
          <button onClick={handleLogout} title="تسجيل الخروج" className="p-1.5 rounded hover:bg-white/10">
            <FiLogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
