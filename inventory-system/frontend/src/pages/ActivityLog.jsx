import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiActivity } from 'react-icons/fi';

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ entity: '', action: '', from: '', to: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadLogs(); }, [page, filters]);

  const loadLogs = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 30, ...filters };
      Object.keys(params).forEach(k => !params[k] && delete params[k]);
      const { data } = await api.get('/users/activity-logs', { params });
      setLogs(data.data || []);
      setTotal(data.total || 0);
    } catch (err) { toast.error('خطأ في التحميل'); }
    finally { setLoading(false); }
  };

  const totalPages = Math.ceil(total / 30);

  const actionMap = {
    LOGIN: 'تسجيل دخول', LOGOUT: 'تسجيل خروج', CREATE: 'إنشاء', UPDATE: 'تعديل', DELETE: 'حذف',
    REFUND: 'إرجاع', ADJUST_STOCK: 'تعديل مخزون', CREATE_COUNT: 'جرد', COMPLETE_COUNT: 'إتمام جرد',
    APPROVE_TRANSFER: 'موافقة تحويل', REJECT_TRANSFER: 'رفض تحويل', CHANGE_PASSWORD: 'تغيير كلمة المرور',
  };

  const entityMap = {
    User: 'مستخدم', Branch: 'فرع', Product: 'منتج', Invoice: 'فاتورة', Customer: 'عميل',
    Category: 'تصنيف', Inventory: 'مخزون', StockTransfer: 'تحويل', InventoryCount: 'جرد',
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><FiActivity /> سجل النشاطات</h1>

      <div className="card flex flex-wrap gap-3 items-end">
        <select className="input-field w-auto" value={filters.entity} onChange={e => setFilters(f => ({ ...f, entity: e.target.value }))}>
          <option value="">كل الكيانات</option>
          {Object.entries(entityMap).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="date" className="input-field w-auto" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
        <input type="date" className="input-field w-auto" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="p-3 text-right">المستخدم</th>
              <th className="p-3 text-right">الإجراء</th>
              <th className="p-3 text-right">الكيان</th>
              <th className="p-3 text-right">التفاصيل</th>
              <th className="p-3 text-right">IP</th>
              <th className="p-3 text-right">التاريخ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="p-8 text-center text-gray-400">جاري التحميل...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan="6" className="p-8 text-center text-gray-400">لا توجد سجلات</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="border-t hover:bg-gray-50">
                <td className="p-3 font-medium">{log.user?.name}</td>
                <td className="p-3"><span className="badge badge-info">{actionMap[log.action] || log.action}</span></td>
                <td className="p-3 text-sm">{entityMap[log.entity] || log.entity}</td>
                <td className="p-3 text-xs text-gray-500 max-w-xs truncate">{log.details || '-'}</td>
                <td className="p-3 text-xs font-mono text-gray-400">{log.ipAddress}</td>
                <td className="p-3 text-sm text-gray-500">{new Date(log.createdAt).toLocaleString('ar')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary text-sm">السابق</button>
          <span className="px-4 py-2 text-sm">{page} من {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-secondary text-sm">التالي</button>
        </div>
      )}
    </div>
  );
}
