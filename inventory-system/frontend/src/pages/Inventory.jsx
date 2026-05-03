import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiPackage, FiRefreshCw, FiSearch, FiTrash2 } from 'react-icons/fi';

export default function Inventory() {
  const [branchId, setBranchId] = useState('');
  const [stock, setStock] = useState([]);
  const [movements, setMovements] = useState([]);
  const [tab, setTab] = useState('stock');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [adjustModal, setAdjustModal] = useState(null);
  const [adjustData, setAdjustData] = useState({ quantity: 0, type: 'IN', notes: '' });

  useEffect(() => {
    // Auto-select the first (only) branch
    const loadBranch = async () => {
      try {
        const { data } = await api.get('/branches');
        const branches = data.data || [];
        if (branches.length > 0) setBranchId(branches[0].id);
      } catch (_) {}
    };
    loadBranch();
  }, []);

  useEffect(() => {
    if (branchId) { loadStock(); loadMovements(); }
  }, [branchId]);

  const loadStock = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/inventory/stock/${branchId}`);
      setStock(data);
    } catch (err) { toast.error('خطأ في تحميل المخزون'); }
    finally { setLoading(false); }
  };

  const loadMovements = async () => {
    try {
      const { data } = await api.get('/inventory/movements', { params: { branchId, limit: 50 } });
      setMovements(data.data || []);
    } catch (_) {}
  };

  const handleAdjust = async () => {
    try {
      await api.post('/inventory/adjust', {
        branchId,
        productId: adjustModal.product.id,
        ...adjustData,
        quantity: parseInt(adjustData.quantity),
      });
      toast.success('تم تعديل المخزون');
      setAdjustModal(null);
      setAdjustData({ quantity: 0, type: 'IN', notes: '' });
      loadStock();
      loadMovements();
    } catch (err) {
      toast.error(err.response?.data?.message || 'خطأ في التعديل');
    }
  };

  const handleDelete = async (item) => {
    const name = item.product?.name || 'المنتج';
    if (!window.confirm(`هل أنت متأكد من حذف "${name}" من المخزون نهائياً؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;
    try {
      await api.delete(`/products/${item.product.id}`);
      toast.success(`تم حذف "${name}" بنجاح`);
      loadStock();
    } catch (err) {
      toast.error(err.response?.data?.message || 'خطأ في حذف المنتج');
    }
  };

  const movementTypeMap = {
    IN: { label: 'إدخال', class: 'badge-success' },
    OUT: { label: 'إخراج', class: 'badge-danger' },
    SALE: { label: 'بيع', class: 'badge-info' },
    REFUND: { label: 'إرجاع', class: 'badge-warning' },
    TRANSFER_IN: { label: 'تحويل وارد', class: 'badge-success' },
    TRANSFER_OUT: { label: 'تحويل صادر', class: 'badge-danger' },
    ADJUSTMENT: { label: 'تسوية', class: 'badge-gray' },
  };

  const filteredStock = stock.filter(item => {
    if (!search) return true;
    const s = search.toLowerCase();
    return item.product?.name?.toLowerCase().includes(s) ||
           item.product?.sku?.toLowerCase().includes(s) ||
           item.product?.barcode?.toLowerCase().includes(s);
  });

  const lowCount = stock.filter(i => i.quantity <= (i.product?.alertQuantity || 0)).length;
  const outCount = stock.filter(i => i.quantity <= 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><FiPackage /> إدارة المخزون</h1>
          <p className="text-gray-500 text-sm mt-1">
            {stock.length} منتج في المخزون
            {lowCount > 0 && <span className="text-red-500 font-bold mr-2">({lowCount} منخفض{outCount > 0 ? ` / ${outCount} نفد` : ''})</span>}
          </p>
        </div>
      </div>

      {/* Tabs + Search */}
      <div className="card flex flex-wrap items-center gap-4">
        <div className="flex gap-2">
          <button onClick={() => setTab('stock')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'stock' ? 'bg-primary-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
            المخزون الحالي
          </button>
          <button onClick={() => setTab('movements')} className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === 'movements' ? 'bg-primary-600 text-white' : 'bg-gray-100 hover:bg-gray-200'}`}>
            حركة المخزون
          </button>
        </div>
        {tab === 'stock' && (
          <div className="flex-1 relative min-w-[200px]">
            <FiSearch className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالاسم أو SKU أو الباركود..."
              className="input-field pr-10"
            />
          </div>
        )}
      </div>

      {tab === 'stock' ? (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="table-header">
                <th className="p-3 text-right">المنتج</th>
                <th className="p-3 text-right">SKU</th>
                <th className="p-3 text-right">التصنيف</th>
                <th className="p-3 text-center">الكمية المتاحة</th>
                <th className="p-3 text-center">حد التنبيه</th>
                <th className="p-3 text-right">الحالة</th>
                <th className="p-3 text-right">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="7" className="p-8 text-center text-gray-400">جاري التحميل...</td></tr>
              ) : filteredStock.length === 0 ? (
                <tr><td colSpan="7" className="p-8 text-center text-gray-400">لا يوجد مخزون</td></tr>
              ) : filteredStock.map(item => {
                const qty = item.quantity;
                const alert = item.product?.alertQuantity || 0;
                const isOut = qty <= 0;
                const isLow = qty <= alert && qty > 0;

                return (
                  <tr key={item.id} className={`border-t hover:bg-gray-50 ${isOut ? 'bg-red-50' : isLow ? 'bg-amber-50' : ''}`}>
                    <td className="p-3 font-medium">{item.product?.name}</td>
                    <td className="p-3 text-sm text-gray-500 font-mono">{item.product?.sku}</td>
                    <td className="p-3 text-sm">{item.product?.category?.name || '-'}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-block min-w-[3rem] px-3 py-1 rounded-full text-sm font-bold ${
                        isOut ? 'bg-red-100 text-red-800' : isLow ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'
                      }`}>
                        {qty}
                      </span>
                    </td>
                    <td className="p-3 text-center text-sm text-gray-400">{alert}</td>
                    <td className="p-3">
                      {isOut ? (
                        <span className="badge badge-danger">نفد المخزون</span>
                      ) : isLow ? (
                        <span className="badge badge-warning">منخفض</span>
                      ) : (
                        <span className="badge badge-success">متوفر</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => setAdjustModal(item)} className="btn-secondary text-xs flex items-center gap-1">
                          <FiRefreshCw size={12} /> تعديل
                        </button>
                        <button onClick={() => handleDelete(item)} className="text-xs flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                          <FiTrash2 size={12} /> حذف
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[650px]">
            <thead>
              <tr className="table-header">
                <th className="p-3 text-right">المنتج</th>
                <th className="p-3 text-right">النوع</th>
                <th className="p-3 text-center">الكمية</th>
                <th className="p-3 text-right">المرجع</th>
                <th className="p-3 text-right">ملاحظات</th>
                <th className="p-3 text-right">بواسطة</th>
                <th className="p-3 text-right">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr><td colSpan="7" className="p-8 text-center text-gray-400">لا توجد حركات</td></tr>
              ) : movements.map(m => (
                <tr key={m.id} className="border-t hover:bg-gray-50">
                  <td className="p-3">{m.product?.name}</td>
                  <td className="p-3"><span className={`badge ${movementTypeMap[m.type]?.class}`}>{movementTypeMap[m.type]?.label}</span></td>
                  <td className="p-3 text-center font-bold">{m.quantity}</td>
                  <td className="p-3 text-sm text-gray-500 font-mono">{m.reference || '-'}</td>
                  <td className="p-3 text-sm text-gray-500">{m.notes || '-'}</td>
                  <td className="p-3 text-sm">{m.user?.name}</td>
                  <td className="p-3 text-sm text-gray-500">{new Date(m.createdAt).toLocaleString('ar-EG')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Adjust Modal */}
      {adjustModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold">تعديل مخزون: {adjustModal.product?.name}</h3>
            <p className="text-sm text-gray-500">الكمية الحالية: <strong className="text-gray-800 text-base">{adjustModal.quantity}</strong> قطعة</p>
            <select className="input-field" value={adjustData.type} onChange={e => setAdjustData(d => ({ ...d, type: e.target.value }))}>
              <option value="IN">إدخال (إضافة للمخزون)</option>
              <option value="OUT">إخراج (سحب من المخزون)</option>
              <option value="ADJUSTMENT">تسوية (تعيين الكمية الفعلية)</option>
            </select>
            <input type="number" min="0" className="input-field" placeholder="الكمية" value={adjustData.quantity} onChange={e => setAdjustData(d => ({ ...d, quantity: e.target.value }))} />
            <textarea className="input-field" placeholder="ملاحظات (اختياري) - مثال: جرد شهري" value={adjustData.notes} onChange={e => setAdjustData(d => ({ ...d, notes: e.target.value }))} />
            <div className="flex gap-3">
              <button onClick={handleAdjust} className="btn-primary flex-1">حفظ التعديل</button>
              <button onClick={() => { setAdjustModal(null); setAdjustData({ quantity: 0, type: 'IN', notes: '' }); }} className="btn-secondary flex-1">إلغاء</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
