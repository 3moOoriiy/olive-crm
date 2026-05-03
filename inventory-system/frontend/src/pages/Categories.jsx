import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiGrid, FiPlus, FiEdit, FiTrash2 } from 'react-icons/fi';

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });

  useEffect(() => { loadCategories(); }, []);

  const loadCategories = async () => {
    setLoading(true);
    try { const { data } = await api.get('/categories'); setCategories(data); }
    catch (err) { toast.error('خطأ في التحميل'); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editId) {
        await api.put(`/categories/${editId}`, form);
        toast.success('تم تحديث التصنيف');
      } else {
        await api.post('/categories', form);
        toast.success('تم إضافة التصنيف');
      }
      setShowForm(false); setEditId(null);
      setForm({ name: '', description: '' });
      loadCategories();
    } catch (err) { toast.error(err.response?.data?.message || 'خطأ'); }
  };

  const handleEdit = (c) => {
    setEditId(c.id); setForm({ name: c.name, description: c.description || '' }); setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!confirm('هل تريد حذف هذا التصنيف؟')) return;
    try { await api.delete(`/categories/${id}`); toast.success('تم الحذف'); loadCategories(); }
    catch (err) { toast.error(err.response?.data?.message || 'خطأ'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FiGrid /> التصنيفات</h1>
        <button onClick={() => { setShowForm(!showForm); setEditId(null); setForm({ name: '', description: '' }); }} className="btn-primary flex items-center gap-2"><FiPlus /> تصنيف جديد</button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <h3 className="font-bold">{editId ? 'تعديل تصنيف' : 'إضافة تصنيف جديد'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">اسم التصنيف *</label><input type="text" className="input-field" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="block text-sm font-medium mb-1">الوصف</label><input type="text" className="input-field" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <div className="flex gap-3">
            <button type="submit" className="btn-primary">{editId ? 'تحديث' : 'إضافة'}</button>
            <button type="button" onClick={() => { setShowForm(false); setEditId(null); }} className="btn-secondary">إلغاء</button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <p className="text-gray-400 col-span-full text-center py-10">جاري التحميل...</p>
        ) : categories.length === 0 ? (
          <p className="text-gray-400 col-span-full text-center py-10">لا يوجد تصنيفات</p>
        ) : categories.map(cat => (
          <div key={cat.id} className="card flex items-start justify-between">
            <div>
              <h3 className="font-bold text-lg">{cat.name}</h3>
              <p className="text-sm text-gray-500 mt-1">{cat.description || 'بدون وصف'}</p>
              <p className="text-xs text-gray-400 mt-2">{cat._count?.products || 0} منتج</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleEdit(cat)} className="text-primary-600"><FiEdit size={16} /></button>
              <button onClick={() => handleDelete(cat.id)} className="text-red-500"><FiTrash2 size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
