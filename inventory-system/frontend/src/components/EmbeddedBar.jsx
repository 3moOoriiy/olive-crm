import { NavLink } from 'react-router-dom';
import { FiArrowRight, FiHome, FiGrid, FiBox, FiShoppingCart, FiFileText, FiPackage, FiBarChart2, FiUsers, FiUserCheck, FiActivity, FiLayers, FiLogOut } from 'react-icons/fi';
import { useAuth } from '../context/AuthContext';

const menuItems = [
  { label: 'الرئيسية', icon: FiHome, path: '/', permission: null },
  { label: 'التصنيفات', icon: FiGrid, path: '/categories', permission: 'categories:read' },
  { label: 'المنتجات', icon: FiBox, path: '/products', permission: 'products:read' },
  { label: 'نقطة البيع', icon: FiShoppingCart, path: '/pos', permission: 'invoices:create' },
  { label: 'الفواتير', icon: FiFileText, path: '/invoices', permission: 'invoices:read' },
  { label: 'المخزون', icon: FiPackage, path: '/inventory', permission: 'inventory:read' },
  { label: 'المكونات', icon: FiLayers, path: '/components', permission: 'products:read' },
  { label: 'التقارير', icon: FiBarChart2, path: '/reports', permission: 'reports:read' },
  { label: 'المستخدمين', icon: FiUsers, path: '/users', permission: 'users:read' },
  { label: 'العملاء', icon: FiUserCheck, path: '/customers', permission: 'customers:read' },
  { label: 'النشاطات', icon: FiActivity, path: '/activity', permission: 'activity:read' },
];

export default function EmbeddedBar() {
  const { user, hasPermission, logout } = useAuth();

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

        <div className="text-sm font-bold whitespace-nowrap px-2 border-r border-white/20">
          🏭 المخزن
        </div>

        <nav className="flex-1 overflow-x-auto custom-scrollbar">
          <ul className="flex items-center gap-1 min-w-max">
            {menuItems.map((item) => {
              if (item.permission && hasPermission && !hasPermission(item.permission)) return null;
              const Icon = item.icon;
              return (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition ${
                        isActive ? 'bg-white text-[#1e4d0f]' : 'hover:bg-white/10'
                      }`
                    }
                  >
                    <Icon size={14} />
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="hidden sm:flex items-center gap-2 text-xs whitespace-nowrap pr-2 border-r border-white/20">
          <span className="opacity-80">{user?.name}</span>
          <button onClick={handleLogout} title="تسجيل الخروج" className="p-1.5 rounded hover:bg-white/10">
            <FiLogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
