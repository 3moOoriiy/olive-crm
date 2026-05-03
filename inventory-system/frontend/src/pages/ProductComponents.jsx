import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiLayers, FiPlus, FiTrash2, FiSave, FiSearch } from 'react-icons/fi';

export default function ProductComponents() {
  const [products, setProducts] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [components, setComponents] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [overview, setOverview] = useState([]);

  useEffect(() => {
    loadProducts();
    loadOverview();
  }, []);

  const loadProducts = async () => {
    try {
      const { data } = await api.get('/products', { params: { limit: 500 } });
      const list = data.data || [];
      setProducts(list);
      setAllProducts(list);
    } catch (err) { toast.error('خطأ في تحميل المنتجات'); }
  };

  const loadOverview = async () => {
    try {
      const { data } = await api.get('/components/overview');
      setOverview(data);
    } catch (_) {}
  };

  const selectProduct = async (product) => {
    setSelectedProduct(product);
    setLoading(true);
    try {
      const { data } = await api.get(`/components/${product.id}`);
      setComponents(data.map(c => ({
        componentId: c.componentId,
        name: c.component.name,
        sku: c.component.sku,
        quantity: c.quantity,
      })));
    } catch (err) {
      toast.error('خطأ في تحميل المكونات');
      setComponents([]);
    } finally { setLoading(false); }
  };

  const addComponent = (product) => {
    if (product.id === selectedProduct?.id) {
      toast.error('لا يمكن إضافة المنتج كمكون لنفسه');
      return;
    }
    if (components.find(c => c.componentId === product.id)) {
      toast.error('المكون موجود بالفعل');
      return;
    }
    setComponents(prev => [...prev, {
      componentId: product.id,
      name: product.name,
      sku: product.sku,
      quantity: 1,
    }]);
  };

  const removeComponent = (componentId) => {
    setComponents(prev => prev.filter(c => c.componentId !== componentId));
  };

  const updateQuantity = (componentId, qty) => {
    setComponents(prev => prev.map(c =>
      c.componentId === componentId ? { ...c, quantity: parseFloat(qty) || 1 } : c
    ));
  };

  const saveComponents = async () => {
    if (!selectedProduct) return;
    setSaving(true);
    try {
      await api.put(`/components/${selectedProduct.id}`, {
        components: components.map(c => ({
          componentId: c.componentId,
          quantity: c.quantity,
        })),
      });
      toast.success('تم حفظ المكونات بنجاح');
      loadOverview();
    } catch (err) {
      toast.error(err.response?.data?.message || 'خطأ في الحفظ');
    } finally { setSaving(false); }
  };

  const filteredProducts = allProducts.filter(p => {
    if (!search) return true;
    const s = search.toLowerCase();
    return p.name?.toLowerCase().includes(s) || p.sku?.toLowerCase().includes(s);
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><FiLayers /> مكونات المنتجات (BOM)</h1>
        <p className="text-gray-500 text-sm mt-1">ربط كل منتج بمكوناته - عند البيع يتم خصم المكونات تلقائياً من المخزون</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Product Selection */}
        <div className="card space-y-3">
          <h3 className="font-bold text-gray-700">اختر المنتج الرئيسي</h3>
          <div className="relative">
            <FiSearch className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث..."
              className="input-field pr-10"
            />
          </div>
          <div className="max-h-[400px] overflow-y-auto space-y-1">
            {filteredProducts.map(p => (
              <button
                key={p.id}
                onClick={() => selectProduct(p)}
                className={`w-full text-right px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedProduct?.id === p.id
                    ? 'bg-primary-100 text-primary-700 font-bold'
                    : 'hover:bg-gray-100'
                }`}
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-400">{p.sku} - {p.category?.name || ''}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Component Editor */}
        <div className="lg:col-span-2 card space-y-4">
          {!selectedProduct ? (
            <div className="text-center text-gray-400 py-16">
              <FiLayers className="mx-auto text-5xl mb-3" />
              <p>اختر منتج من القائمة لتعديل مكوناته</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-lg">{selectedProduct.name}</h3>
                  <p className="text-sm text-gray-400">{selectedProduct.sku}</p>
                </div>
                <button
                  onClick={saveComponents}
                  disabled={saving}
                  className="btn-primary flex items-center gap-2"
                >
                  <FiSave /> {saving ? 'جاري الحفظ...' : 'حفظ المكونات'}
                </button>
              </div>

              {/* Current Components */}
              <div>
                <h4 className="font-medium text-gray-600 mb-2">المكونات ({components.length})</h4>
                {loading ? (
                  <p className="text-gray-400 text-center py-4">جاري التحميل...</p>
                ) : components.length === 0 ? (
                  <p className="text-gray-400 text-center py-4 bg-gray-50 rounded-lg">
                    لا توجد مكونات - أضف مكونات من القائمة أدناه
                  </p>
                ) : (
                  <div className="space-y-2">
                    {components.map(c => (
                      <div key={c.componentId} className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                        <div className="flex-1">
                          <span className="font-medium text-sm">{c.name}</span>
                          <span className="text-xs text-gray-400 mr-2">({c.sku})</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="text-xs text-gray-500">الكمية:</label>
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={c.quantity}
                            onChange={(e) => updateQuantity(c.componentId, e.target.value)}
                            className="w-20 input-field text-center text-sm"
                          />
                        </div>
                        <button
                          onClick={() => removeComponent(c.componentId)}
                          className="text-red-400 hover:text-red-600 p-1"
                        >
                          <FiTrash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Add Components */}
              <div>
                <h4 className="font-medium text-gray-600 mb-2">إضافة مكون</h4>
                <div className="max-h-[200px] overflow-y-auto border rounded-lg">
                  {allProducts
                    .filter(p => p.id !== selectedProduct.id && !components.find(c => c.componentId === p.id))
                    .map(p => (
                      <button
                        key={p.id}
                        onClick={() => addComponent(p)}
                        className="w-full text-right px-3 py-2 border-b last:border-b-0 hover:bg-green-50 flex items-center justify-between text-sm transition-colors"
                      >
                        <div>
                          <span className="font-medium">{p.name}</span>
                          <span className="text-xs text-gray-400 mr-2">{p.sku}</span>
                        </div>
                        <FiPlus className="text-green-500" />
                      </button>
                    ))
                  }
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Overview */}
      {overview.length > 0 && (
        <div className="card">
          <h3 className="font-bold text-gray-700 mb-3">المنتجات المرتبطة بمكونات</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="table-header">
                  <th className="p-3 text-right">المنتج</th>
                  <th className="p-3 text-right">التصنيف</th>
                  <th className="p-3 text-right">المكونات</th>
                </tr>
              </thead>
              <tbody>
                {overview.map(p => (
                  <tr key={p.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 font-medium">{p.name}</td>
                    <td className="p-3 text-sm text-gray-500">{p.category?.name || '-'}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {p.components.map(c => (
                          <span key={c.id} className="badge badge-info text-xs">
                            {c.component.name} × {c.quantity}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
