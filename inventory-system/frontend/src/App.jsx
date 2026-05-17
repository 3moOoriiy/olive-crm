import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import ProductForm from './pages/ProductForm';
import Branches from './pages/Branches';
import Categories from './pages/Categories';
import POS from './pages/POS';
import Invoices from './pages/Invoices';
import InvoiceDetail from './pages/InvoiceDetail';
import Inventory from './pages/Inventory';
import ProductComponents from './pages/ProductComponents';
import Transfers from './pages/Transfers';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Customers from './pages/Customers';
import ActivityLog from './pages/ActivityLog';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Bridges parent CRM <-> inventory iframe via postMessage
function ParentBridge() {
  const navigate = useNavigate();
  const location = useLocation();

  // Listen for navigation requests from CRM parent
  useEffect(() => {
    const onMsg = (e) => {
      if (e.data && e.data.type === 'inventory-navigate' && typeof e.data.path === 'string') {
        navigate(e.data.path);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [navigate]);

  // Notify CRM parent of route changes
  useEffect(() => {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'inventory-route', path: location.pathname }, '*');
    }
  }, [location.pathname]);

  return null;
}

export default function App() {
  return (
    <><ParentBridge /><Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="branches" element={<Branches />} />
        <Route path="categories" element={<Categories />} />
        <Route path="products" element={<Products />} />
        <Route path="products/new" element={<ProductForm />} />
        <Route path="products/:id/edit" element={<ProductForm />} />
        <Route path="pos" element={<POS />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/:id" element={<InvoiceDetail />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="components" element={<ProductComponents />} />
        <Route path="transfers" element={<Transfers />} />
        <Route path="reports" element={<Reports />} />
        <Route path="users" element={<Users />} />
        <Route path="customers" element={<Customers />} />
        <Route path="activity" element={<ActivityLog />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes></>
  );
}
