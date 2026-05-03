import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiSearch, FiPlus, FiMinus, FiTrash2, FiPrinter, FiShoppingCart, FiBox } from 'react-icons/fi';

export default function POS() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [customers, setCustomers] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [loading, setLoading] = useState(false);
  const [mobileTab, setMobileTab] = useState('products');
  const searchRef = useRef(null);
  const barcodeRef = useRef(null);

  const branchId = user?.branchId || user?.branch?.id;

  useEffect(() => {
    if (branchId) {
      loadProducts();
      loadCustomers();
    }
    if (barcodeRef.current) barcodeRef.current.focus();
  }, [branchId]);

  const loadProducts = async () => {
    try {
      const { data } = await api.get('/products', { params: { branchId, limit: 200 } });
      setProducts(data.data || []);
    } catch (err) {
      toast.error('خطأ في تحميل المنتجات');
    }
  };

  const loadCustomers = async () => {
    try {
      const { data } = await api.get('/customers', { params: { limit: 100 } });
      setCustomers(data.data || []);
    } catch (_) {}
  };

  const handleBarcodeInput = async (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      const code = e.target.value.trim();
      try {
        const { data } = await api.get(`/products/barcode/${code}`);
        addToCart(data);
        e.target.value = '';
      } catch {
        toast.error('المنتج غير موجود');
      }
    }
  };

  const addToCart = (product) => {
    const branchStock = product.branchProducts?.find(bp => bp.branchId === branchId);
    const available = branchStock?.quantity || 0;

    setCart(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        if (existing.quantity >= available) {
          toast.error('الكمية غير كافية');
          return prev;
        }
        return prev.map(item =>
          item.productId === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      if (available <= 0) {
        toast.error('المنتج غير متوفر في هذا الفرع');
        return prev;
      }
      return [...prev, {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        taxRate: product.taxRate || 0,
        quantity: 1,
        maxQuantity: available,
        discount: 0,
      }];
    });
  };

  const updateQuantity = (productId, delta) => {
    setCart(prev => prev.map(item => {
      if (item.productId !== productId) return item;
      const newQty = item.quantity + delta;
      if (newQty < 1 || newQty > item.maxQuantity) return item;
      return { ...item, quantity: newQty };
    }));
  };

  const removeFromCart = (productId) => {
    setCart(prev => prev.filter(item => item.productId !== productId));
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const totalTax = cart.reduce((sum, item) => {
    const itemTotal = item.price * item.quantity - item.discount;
    return sum + (itemTotal * item.taxRate / 100);
  }, 0);
  const total = subtotal - discount + totalTax;

  const handleSubmit = async () => {
    if (!branchId) return toast.error('يجب تحديد الفرع');
    if (cart.length === 0) return toast.error('السلة فارغة');

    setLoading(true);
    try {
      const { data } = await api.post('/invoices', {
        branchId,
        customerId: selectedCustomer || null,
        discount,
        paymentMethod,
        items: cart.map(item => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          discount: item.discount,
        })),
      });

      toast.success(`تم إنشاء الفاتورة ${data.invoiceNumber}`);
      setCart([]);
      setDiscount(0);
      setSelectedCustomer('');
      loadProducts();
      setMobileTab('products');
    } catch (err) {
      toast.error(err.response?.data?.message || 'خطأ في إنشاء الفاتورة');
    } finally {
      setLoading(false);
    }
  };

  const filteredProducts = products.filter(p =>
    p.name.includes(search) || p.sku.includes(search) || p.barcode?.includes(search)
  );

  if (!branchId) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <FiShoppingCart className="mx-auto text-6xl text-gray-300 mb-4" />
          <h2 className="text-xl font-bold text-gray-500">يجب تعيين فرع لحسابك لاستخدام نقطة البيع</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-7rem)]">
      {/* Mobile Tabs */}
      <div className="flex gap-2 lg:hidden">
        <button
          onClick={() => setMobileTab('products')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors ${
            mobileTab === 'products' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <FiBox size={16} /> المنتجات
        </button>
        <button
          onClick={() => setMobileTab('cart')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-colors relative ${
            mobileTab === 'cart' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          <FiShoppingCart size={16} /> السلة
          {cart.length > 0 && (
            <span className={`absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full text-xs flex items-center justify-center font-bold ${
              mobileTab === 'cart' ? 'bg-white text-primary-600' : 'bg-red-500 text-white'
            }`}>
              {cart.length}
            </span>
          )}
        </button>
      </div>

      {/* Products Panel */}
      <div className={`flex-1 flex flex-col bg-white rounded-xl shadow-sm border overflow-hidden ${
        mobileTab !== 'products' ? 'hidden lg:flex' : 'flex'
      }`}>
        <div className="p-3 sm:p-4 border-b space-y-2 sm:space-y-3">
          <h2 className="text-lg font-bold hidden sm:block">المنتجات</h2>
          <div className="relative">
            <input
              ref={barcodeRef}
              type="text"
              placeholder="امسح الباركود هنا..."
              className="input-field pl-10 bg-yellow-50 border-yellow-300 font-mono text-sm"
              onKeyDown={handleBarcodeInput}
            />
            <span className="absolute left-3 top-2.5 text-yellow-500 text-xs">Barcode</span>
          </div>
          <div className="relative">
            <FiSearch className="absolute right-3 top-2.5 text-gray-400" />
            <input
              ref={searchRef}
              type="text"
              placeholder="بحث بالاسم أو الكود..."
              className="input-field pr-10 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 sm:p-4 grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 content-start">
          {filteredProducts.map(product => {
            const stock = product.branchProducts?.find(bp => bp.branchId === branchId)?.quantity || 0;
            return (
              <button
                key={product.id}
                onClick={() => { addToCart(product); }}
                disabled={stock <= 0}
                className={`p-2 sm:p-3 rounded-lg border text-right transition-all hover:shadow-md ${
                  stock <= 0 ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:border-primary-300 bg-white active:scale-95'
                }`}
              >
                <p className="font-medium text-xs sm:text-sm truncate">{product.name}</p>
                <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">{product.sku}</p>
                <div className="flex justify-between items-center mt-1 sm:mt-2">
                  <span className="text-primary-600 font-bold text-xs sm:text-sm">{product.price} ج.م</span>
                  <span className={`text-[10px] sm:text-xs ${stock <= 5 ? 'text-red-500' : 'text-gray-400'}`}>{stock}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cart Panel */}
      <div className={`w-full lg:w-96 flex flex-col bg-white rounded-xl shadow-sm border overflow-hidden ${
        mobileTab !== 'cart' ? 'hidden lg:flex' : 'flex flex-1'
      }`}>
        <div className="p-3 sm:p-4 border-b">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <FiShoppingCart /> سلة المشتريات
            <span className="badge badge-info mr-auto">{cart.length}</span>
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-2">
          {cart.length === 0 ? (
            <p className="text-center text-gray-400 mt-10">السلة فارغة</p>
          ) : (
            cart.map(item => (
              <div key={item.productId} className="border rounded-lg p-2 sm:p-3">
                <div className="flex justify-between items-start">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{item.name}</p>
                    <p className="text-xs text-gray-400">{item.sku}</p>
                  </div>
                  <button onClick={() => removeFromCart(item.productId)} className="text-red-400 hover:text-red-600 mr-2 shrink-0">
                    <FiTrash2 size={16} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1 sm:gap-2">
                    <button onClick={() => updateQuantity(item.productId, -1)} className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                      <FiMinus size={14} />
                    </button>
                    <span className="w-8 text-center font-bold">{item.quantity}</span>
                    <button onClick={() => updateQuantity(item.productId, 1)} className="w-7 h-7 rounded bg-gray-100 flex items-center justify-center hover:bg-gray-200">
                      <FiPlus size={14} />
                    </button>
                  </div>
                  <span className="font-bold text-primary-600 text-sm">{(item.price * item.quantity).toFixed(2)} ج.م</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Totals & Payment */}
        <div className="border-t p-3 sm:p-4 space-y-2 sm:space-y-3 bg-gray-50">
          <div className="grid grid-cols-2 gap-2">
            <select className="input-field text-sm" value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)}>
              <option value="">بدون عميل</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name} - {c.phone}</option>)}
            </select>
            <select className="input-field text-sm" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
              <option value="CASH">نقدي</option>
              <option value="CARD">بطاقة</option>
              <option value="TRANSFER">تحويل</option>
              <option value="MIXED">مختلط</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">خصم:</label>
            <input type="number" min="0" className="input-field text-sm" value={discount} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} />
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span>المجموع الفرعي:</span><span>{subtotal.toFixed(2)} ج.م</span></div>
            {totalTax > 0 && <div className="flex justify-between text-gray-500"><span>الضريبة:</span><span>{totalTax.toFixed(2)} ج.م</span></div>}
            {discount > 0 && <div className="flex justify-between text-red-500"><span>الخصم:</span><span>-{discount.toFixed(2)} ج.م</span></div>}
            <div className="flex justify-between font-bold text-lg border-t pt-2">
              <span>الإجمالي:</span>
              <span className="text-primary-600">{total.toFixed(2)} ج.م</span>
            </div>
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || cart.length === 0}
            className="btn-primary w-full py-3 text-lg flex items-center justify-center gap-2"
          >
            {loading ? 'جاري المعالجة...' : (
              <>
                <FiPrinter /> إتمام البيع
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
