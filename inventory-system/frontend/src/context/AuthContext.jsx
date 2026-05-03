import { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/axios';

const AuthContext = createContext(null);

export const useAuth = () => useContext(AuthContext);

const DEFAULT_PERMISSIONS = {
  ADMIN: [
    'users:read', 'users:create', 'users:update', 'users:delete',
    'branches:read', 'branches:create', 'branches:update', 'branches:delete',
    'products:read', 'products:create', 'products:update', 'products:delete',
    'invoices:read', 'invoices:create', 'invoices:refund', 'invoices:delete',
    'inventory:read', 'inventory:adjust', 'inventory:count',
    'transfers:read', 'transfers:create', 'transfers:approve',
    'reports:read', 'reports:export',
    'activity:read',
    'customers:read', 'customers:create', 'customers:update', 'customers:delete',
    'categories:read', 'categories:create', 'categories:update', 'categories:delete',
  ],
  BRANCH_MANAGER: [
    'users:read', 'branches:read',
    'products:read', 'products:create', 'products:update',
    'invoices:read', 'invoices:create', 'invoices:refund',
    'inventory:read', 'inventory:adjust', 'inventory:count',
    'transfers:read', 'transfers:create', 'transfers:approve',
    'reports:read', 'reports:export', 'activity:read',
    'customers:read', 'customers:create', 'customers:update',
    'categories:read',
  ],
  CASHIER: [
    'products:read', 'invoices:read', 'invoices:create',
    'inventory:read', 'customers:read', 'customers:create', 'categories:read',
  ],
  WAREHOUSE: [
    'products:read', 'products:create', 'products:update',
    'inventory:read', 'inventory:adjust', 'inventory:count',
    'transfers:read', 'transfers:create', 'categories:read',
  ],
  VIEWER: [
    'products:read', 'invoices:read', 'inventory:read',
    'branches:read', 'reports:read', 'categories:read',
  ],
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('sso=')) {
      try {
        const data = JSON.parse(decodeURIComponent(hash.slice(4)));
        if (data.accessToken && data.refreshToken && data.user) {
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);
          localStorage.setItem('user', JSON.stringify(data.user));
        }
      } catch (_) {}
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    const storedUser = localStorage.getItem('user');
    const token = localStorage.getItem('accessToken');
    if (storedUser && token) {
      setUser(JSON.parse(storedUser));
    }
    setLoading(false);
  }, []);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      const refreshToken = localStorage.getItem('refreshToken');
      await api.post('/auth/logout', { refreshToken });
    } catch (_) { /* ignore */ }
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setUser(null);
  };

  const hasPermission = (permission) => {
    if (!user) return false;

    // Check custom permissions first
    if (user.permissions) {
      try {
        const custom = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions;
        if (Array.isArray(custom)) {
          return custom.includes(permission);
        }
      } catch (_) {}
    }

    // Fall back to role defaults
    const rolePerms = DEFAULT_PERMISSIONS[user.role] || [];
    return rolePerms.includes(permission);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}
