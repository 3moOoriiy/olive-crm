import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiUserCheck, FiPlus, FiEdit, FiTrash2 } from 'react-icons/fi';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '' });

  useEffect(() => { loadCustomers(); }, [search]);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/customers', { params: { search: search || undefined } });
      setCustomers(data.data || []);
    } catch (err) { toast.error('خطأ في التحميل'); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editId) {
        await api.put(`/customers/${editId}`, form);
        toast.success('تم تحديث العميل');
      } else {
        await api.post('/customers', form);
        toast.success('تم إضافة العميل');
      }
      setShowForm(false); setEditId(null);
      setForm({ name: '', phone: '', email: '', address: '' });
      loadCustomers();
    } catch (err) { toast.error(err.response?.data?.message || 'خطأ'); }
  };

  const handleEdit = (c) => {
    setEditId(c.id);
    setForm({ name: c.name, phone: c.phone || '', email: c.email || '', address: c.address || '' });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('هل تريد حذف هذا العميل؟')) return;
    try { await api.delete(`/customers/${id}`); toast.success('تم حذف العميل'); loadCustomers(); }
    catch (err) { toast.error(err.response?.data?.message || 'خطأ'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FiUserCheck /> العملاء</h1>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ name: '', phone: '', email: '', address: '' }); }} className="btn-primary flex items-center gap-2"><FiPlus /> عميل جديد</button>
      </div>

      <input type="text" className="input-field max-w-md" placeholder="بحث بالاسم أو الهاتف..." value={search} onChange={e => setSearch(e.target.value)} />

      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h3 className="font-bold">{editId ? 'تعديل عميل' : 'إضافة عميل جديد'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">الاسم *</label><input type="text" className="input-field" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">الهاتف</label><input type="text" className="input-field" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">البريد الإلكتروني</label><input type="email" className="input-field" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">العنوان</label><input type="text" className="input-field" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="btn-primary">{editId ? 'تحديث' : 'إضافة'}</button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full">
          <thead><tr className="table-header"><th className="p-3 text-right">الاسم</th><th className="p-3 text-right">الهاتف</th><th className="p-3 text-right">البريد</th><th className="p-3 text-right">العنوان</th><th className="p-3 text-center">الفواتير</th><th className="p-3 text-right">إجراءات</th></tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" className="p-8 text-center text-gray-400">جاري التحميل...</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan="6" className="p-8 text-center text-gray-400">لا يوجد عملاء</td></tr>
            ) : customers.map(c => (
              <tr key={c.id} className="border-t hover:bg-gray-50">
                <td className="p-3 font-medium">{c.name}</td>
                <td className="p-3 text-sm">{c.phone || '-'}</td>
                <td className="p-3 text-sm text-gray-500">{c.email || '-'}</td>
                <td className="p-3 text-sm">{c.address || '-'}</td>
                <td className="p-3 text-center">{c._count?.invoices || 0}</td>
                <td className="p-3">
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(c)} className="text-primary-600"><FiEdit size={16} /></button>
                    <button onClick={() => handleDelete(c.id)} className="text-red-500"><FiTrash2 size={16} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
