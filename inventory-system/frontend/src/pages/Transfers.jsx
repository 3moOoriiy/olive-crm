import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiRepeat, FiCheck, FiX, FiPlus, FiTrash2 } from 'react-icons/fi';

const statusMap = { PENDING: 'قيد الانتظار', APPROVED: 'موافق عليه', COMPLETED: 'مكتمل', REJECTED: 'مرفوض' };
const statusClass = { PENDING: 'badge-warning', APPROVED: 'badge-info', COMPLETED: 'badge-success', REJECTED: 'badge-danger' };

export default function Transfers() {
  const [transfers, setTransfers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fromBranchId: '', toBranchId: '', notes: '', items: [] });
  const [newItem, setNewItem] = useState({ productId: '', quantity: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadTransfers(); loadBranches(); loadProducts(); }, []);

  const loadTransfers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/transfers');
      setTransfers(data.data || []);
    } catch (err) { toast.error('خطأ في التحميل'); }
    finally { setLoading(false); }
  };

  const loadBranches = async () => {
    try { const { data } = await api.get('/branches'); setBranches(data.data || []); } catch (_) {}
  };

  const loadProducts = async () => {
    try { const { data } = await api.get('/products', { params: { limit: 200 } }); setProducts(data.data || []); } catch (_) {}
  };

  const addItem = () => {
    if (!newItem.productId) return toast.error('اختر منتج');
    if (form.items.find(i => i.productId === newItem.productId)) return toast.error('المنتج مضاف بالفعل');
    const product = products.find(p => p.id === newItem.productId);
    setForm(f => ({ ...f, items: [...f.items, { ...newItem, productName: product?.name }] }));
    setNewItem({ productId: '', quantity: 1 });
  };

  const removeItem = (productId) => {
    setForm(f => ({ ...f, items: f.items.filter(i => i.productId !== productId) }));
  };

  const handleSubmit = async () => {
    if (!form.fromBranchId || !form.toBranchId) return toast.error('اختر الفروع');
    if (form.items.length === 0) return toast.error('أضف منتجات');
    try {
      await api.post('/transfers', {
        fromBranchId: form.fromBranchId,
        toBranchId: form.toBranchId,
        notes: form.notes,
        items: form.items.map(i => ({ productId: i.productId, quantity: parseInt(i.quantity) })),
      });
      toast.success('تم إنشاء طلب التحويل');
      setShowForm(false);
      setForm({ fromBranchId: '', toBranchId: '', notes: '', items: [] });
      loadTransfers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'خطأ');
    }
  };

  const handleAction = async (id, action) => {
    const msg = action === 'approve' ? 'الموافقة على' : 'رفض';
    if (!confirm(`هل تريد ${msg} هذا التحويل؟`)) return;
    try {
      await api.put(`/transfers/${id}/approve`, { action });
      toast.success(action === 'approve' ? 'تم التحويل بنجاح' : 'تم رفض التحويل');
      loadTransfers();
    } catch (err) {
      toast.error(err.response?.data?.message || 'خطأ');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FiRepeat /> التحويلات بين الفروع</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2"><FiPlus /> تحويل جديد</button>
      </div>

      {showForm && (
        <div className="card space-y-4">
          <h3 className="font-bold text-lg">طلب تحويل جديد</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">من فرع</label>
              <select className="input-field" value={form.fromBranchId} onChange={e => setForm(f => ({ ...f, fromBranchId: e.target.value }))}>
                <option value="">اختر الفرع المصدر</option>
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">إلى فرع</label>
              <select className="input-field" value={form.toBranchId} onChange={e => setForm(f => ({ ...f, toBranchId: e.target.value }))}>
                <option value="">اختر الفرع الهدف</option>
                {branches.filter(b => b.id !== form.fromBranchId).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          <textarea className="input-field" placeholder="ملاحظات" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          {/* Add items */}
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <select className="input-field" value={newItem.productId} onChange={e => setNewItem(n => ({ ...n, productId: e.target.value }))}>
                <option value="">اختر منتج</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>)}
              </select>
            </div>
            <input type="number" min="1" className="input-field w-24" placeholder="الكمية" value={newItem.quantity} onChange={e => setNewItem(n => ({ ...n, quantity: e.target.value }))} />
            <button onClick={addItem} className="btn-primary"><FiPlus /></button>
          </div>
          {form.items.length > 0 && (
            <div className="space-y-2">
              {form.items.map(item => (
                <div key={item.productId} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                  <span>{item.productName}</span>
                  <div className="flex items-center gap-3">
                    <span className="font-bold">{item.quantity}</span>
                    <button onClick={() => removeItem(item.productId)} className="text-red-500"><FiTrash2 /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={handleSubmit} className="btn-primary">إرسال طلب التحويل</button>
            <button onClick={() => setShowForm(false)} className="btn-secondary">إلغاء</button>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead>
            <tr className="table-header">
              <th className="p-3 text-right">من فرع</th>
              <th className="p-3 text-right">إلى فرع</th>
              <th className="p-3 text-center">عدد الأصناف</th>
              <th className="p-3 text-right">بواسطة</th>
              <th className="p-3 text-right">الحالة</th>
              <th className="p-3 text-right">التاريخ</th>
              <th className="p-3 text-right">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" className="p-8 text-center text-gray-400">جاري التحميل...</td></tr>
            ) : transfers.length === 0 ? (
              <tr><td colSpan="7" className="p-8 text-center text-gray-400">لا توجد تحويلات</td></tr>
            ) : transfers.map(t => (
              <tr key={t.id} className="border-t hover:bg-gray-50">
                <td className="p-3">{t.fromBranch?.name}</td>
                <td className="p-3">{t.toBranch?.name}</td>
                <td className="p-3 text-center">{t._count?.items || 0}</td>
                <td className="p-3 text-sm">{t.createdBy?.name}</td>
                <td className="p-3"><span className={`badge ${statusClass[t.status]}`}>{statusMap[t.status]}</span></td>
                <td className="p-3 text-sm text-gray-500">{new Date(t.createdAt).toLocaleDateString('ar')}</td>
                <td className="p-3">
                  {t.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button onClick={() => handleAction(t.id, 'approve')} className="text-green-600 hover:text-green-800" title="موافقة"><FiCheck /></button>
                      <button onClick={() => handleAction(t.id, 'reject')} className="text-red-500 hover:text-red-700" title="رفض"><FiX /></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
