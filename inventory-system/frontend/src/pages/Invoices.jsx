import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiEye, FiRotateCcw, FiFilter, FiTrash2 } from 'react-icons/fi';

const statusMap = { COMPLETED: 'مكتملة', CANCELLED: 'ملغاة', PENDING: 'معلقة' };
const statusClass = { COMPLETED: 'badge-success', CANCELLED: 'badge-danger', PENDING: 'badge-warning' };
const typeMap = { SALE: 'بيع', REFUND: 'إرجاع' };
const paymentMap = { CASH: 'نقدي', CARD: 'بطاقة', TRANSFER: 'تحويل', MIXED: 'مختلط' };

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ type: '', status: '', from: '', to: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadInvoices(); }, [page, filters]);

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20, ...filters };
      Object.keys(params).forEach(k => !params[k] && delete params[k]);
      const { data } = await api.get('/invoices', { params });
      setInvoices(data.data);
      setTotal(data.total);
    } catch (err) {
      toast.error('خطأ في تحميل الفواتير');
    } finally { setLoading(false); }
  };

  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const handleRefund = async (id) => {
    if (!confirm('هل تريد إرجاع هذه الفاتورة؟')) return;
    try {
      await api.post(`/invoices/${id}/refund`);
      toast.success('تم إرجاع الفاتورة بنجاح');
      loadInvoices();
    } catch (err) {
      toast.error(err.response?.data?.message || 'خطأ في الإرجاع');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('هل تريد حذف هذه الفاتورة نهائياً؟ لا يمكن التراجع عن هذا الإجراء.')) return;
    try {
      await api.delete(`/invoices/${id}`);
      toast.success('تم حذف الفاتورة بنجاح');
      loadInvoices();
    } catch (err) {
      toast.error(err.response?.data?.message || 'خطأ في حذف الفاتورة');
    }
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">الفواتير</h1>
        <Link to="/pos" className="btn-primary">فاتورة جديدة</Link>
      </div>

      {/* Filters */}
      <div className="card flex flex-wrap gap-3 items-end">
        <FiFilter className="text-gray-400" />
        <select className="input-field w-auto" value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value }))}>
          <option value="">كل الأنواع</option>
          <option value="SALE">بيع</option>
          <option value="REFUND">إرجاع</option>
        </select>
        <select className="input-field w-auto" value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">كل الحالات</option>
          <option value="COMPLETED">مكتملة</option>
          <option value="CANCELLED">ملغاة</option>
        </select>
        <input type="date" className="input-field w-auto" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
        <input type="date" className="input-field w-auto" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
      </div>

      {/* Table */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[650px]">
          <thead>
            <tr className="table-header">
              <th className="p-3 text-right">رقم الفاتورة</th>
              <th className="p-3 text-right">النوع</th>
              <th className="p-3 text-right">الكاشير</th>
              <th className="p-3 text-right">الإجمالي</th>
              <th className="p-3 text-right">الدفع</th>
              <th className="p-3 text-right">الحالة</th>
              <th className="p-3 text-right">التاريخ</th>
              <th className="p-3 text-right">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="8" className="p-8 text-center text-gray-400">جاري التحميل...</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan="8" className="p-8 text-center text-gray-400">لا توجد فواتير</td></tr>
            ) : invoices.map(inv => (
              <tr key={inv.id} className="border-t hover:bg-gray-50">
                <td className="p-3 font-mono text-sm">{inv.invoiceNumber}</td>
                <td className="p-3"><span className={`badge ${inv.type === 'SALE' ? 'badge-info' : 'badge-warning'}`}>{typeMap[inv.type]}</span></td>
                <td className="p-3">{inv.user?.name}</td>
                <td className="p-3 font-bold">{inv.total?.toFixed(2)} ج.م</td>
                <td className="p-3">{paymentMap[inv.paymentMethod]}</td>
                <td className="p-3"><span className={`badge ${statusClass[inv.status]}`}>{statusMap[inv.status]}</span></td>
                <td className="p-3 text-sm text-gray-500">{new Date(inv.createdAt).toLocaleDateString('ar')}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <Link to={`/invoices/${inv.id}`} className="text-primary-600 hover:text-primary-800"><FiEye /></Link>
                    {inv.type === 'SALE' && inv.status === 'COMPLETED' && (
                      <button onClick={() => handleRefund(inv.id)} className="text-red-500 hover:text-red-700" title="إرجاع"><FiRotateCcw /></button>
                    )}
                    {user.role === 'ADMIN' && (
                      <button onClick={() => handleDelete(inv.id)} className="text-red-500 hover:text-red-700" title="حذف"><FiTrash2 /></button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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
