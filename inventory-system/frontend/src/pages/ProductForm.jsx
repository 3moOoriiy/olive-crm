import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';

const initialForm = {
  name: '',
  sku: '',
  barcode: '',
  price: '',
  cost: '',
  category: '',
  unit: 'piece',
  alertQuantity: '',
  taxRate: '',
  description: '',
};

export default function ProductForm() {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(initialForm);
  const [categories, setCategories] = useState([]);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEditing);

  useEffect(() => {
    fetchCategories();
    if (isEditing) fetchProduct();
  }, [id]);

  const fetchCategories = async () => {
    try {
      const { data } = await api.get('/categories');
      setCategories(data.categories || data.data || data || []);
    } catch (_) {}
  };

  const fetchProduct = async () => {
    setFetching(true);
    try {
      const { data } = await api.get(`/products/${id}`);
      const product = data.product || data;
      setForm({
        name: product.name || '',
        sku: product.sku || '',
        barcode: product.barcode || '',
        price: product.price ?? '',
        cost: product.cost ?? '',
        category: product.category?._id || product.category || '',
        unit: product.unit || 'piece',
        alertQuantity: product.alertQuantity ?? '',
        taxRate: product.taxRate ?? '',
        description: product.description || '',
      });
      if (product.image) setImagePreview(product.image);
    } catch (error) {
      toast.error('فشل في تحميل بيانات المنتج');
      navigate('/products');
    } finally {
      setFetching(false);
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast.error('حجم الصورة يجب أن لا يتجاوز 5 ميغابايت');
      return;
    }
    setImageFile(file);
    const reader = new FileReader();
    reader.onloadend = () => setImagePreview(reader.result);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.name) {
      toast.error('اسم المنتج مطلوب');
      return;
    }
    if (!form.price || Number(form.price) < 0) {
      toast.error('يرجى إدخال سعر صحيح');
      return;
    }

    setLoading(true);

    try {
      const formData = new FormData();
      Object.keys(form).forEach((key) => {
        if (form[key] !== '' && form[key] != null) {
          formData.append(key, form[key]);
        }
      });
      if (imageFile) {
        formData.append('image', imageFile);
      }

      const config = { headers: { 'Content-Type': 'multipart/form-data' } };

      if (isEditing) {
        await api.put(`/products/${id}`, formData, config);
        toast.success('تم تحديث المنتج بنجاح');
      } else {
        await api.post('/products', formData, config);
        toast.success('تم إنشاء المنتج بنجاح');
      }
      navigate('/products');
    } catch (error) {
      const message = error.response?.data?.message || 'فشل في حفظ المنتج';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const units = [
    { value: 'piece', label: 'قطعة' },
    { value: 'kg', label: 'كيلوغرام' },
    { value: 'g', label: 'غرام' },
    { value: 'liter', label: 'لتر' },
    { value: 'ml', label: 'مليلتر' },
    { value: 'meter', label: 'متر' },
    { value: 'cm', label: 'سنتيمتر' },
    { value: 'box', label: 'صندوق' },
    { value: 'pack', label: 'عبوة' },
    { value: 'dozen', label: 'دزينة' },
  ];

  if (fetching) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-10 w-10 text-primary-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-gray-500 text-sm">جاري تحميل البيانات...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/products')}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">
            {isEditing ? 'تعديل المنتج' : 'إضافة منتج جديد'}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {isEditing ? 'قم بتحديث بيانات المنتج' : 'أدخل بيانات المنتج الجديد'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Info */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information Card */}
            <div className="card">
              <h3 className="text-lg font-bold text-gray-800 mb-4">المعلومات الأساسية</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Name - full width */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    اسم المنتج <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="مثال: قهوة عربية فاخرة"
                    className="input-field"
                    required
                  />
                </div>

                {/* SKU */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">SKU</label>
                  <input
                    type="text"
                    name="sku"
                    value={form.sku}
                    onChange={handleChange}
                    placeholder="PRD-001"
                    className="input-field font-mono text-left"
                    dir="ltr"
                  />
                </div>

                {/* Barcode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">باركود</label>
                  <input
                    type="text"
                    name="barcode"
                    value={form.barcode}
                    onChange={handleChange}
                    placeholder="6281234567890"
                    className="input-field font-mono text-left"
                    dir="ltr"
                  />
                </div>

                {/* Description - full width */}
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">الوصف</label>
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    rows={3}
                    placeholder="وصف مختصر للمنتج..."
                    className="input-field resize-none"
                  />
                </div>
              </div>
            </div>

            {/* Pricing Card */}
            <div className="card">
              <h3 className="text-lg font-bold text-gray-800 mb-4">التسعير والتصنيف</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Price */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    سعر البيع <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      name="price"
                      value={form.price}
                      onChange={handleChange}
                      placeholder="0.00"
                      className="input-field pl-12 text-left"
                      dir="ltr"
                      step="0.01"
                      min="0"
                      required
                    />
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 text-sm">
                      ج.م
                    </span>
                  </div>
                </div>

                {/* Cost */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">سعر التكلفة</label>
                  <div className="relative">
                    <input
                      type="number"
                      name="cost"
                      value={form.cost}
                      onChange={handleChange}
                      placeholder="0.00"
                      className="input-field pl-12 text-left"
                      dir="ltr"
                      step="0.01"
                      min="0"
                    />
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 text-sm">
                      ج.م
                    </span>
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">التصنيف</label>
                  <select
                    name="category"
                    value={form.category}
                    onChange={handleChange}
                    className="input-field"
                  >
                    <option value="">اختر التصنيف</option>
                    {categories.map((cat) => (
                      <option key={cat._id || cat.id} value={cat._id || cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Unit */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">وحدة القياس</label>
                  <select
                    name="unit"
                    value={form.unit}
                    onChange={handleChange}
                    className="input-field"
                  >
                    {units.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Alert Quantity */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">حد التنبيه</label>
                  <input
                    type="number"
                    name="alertQuantity"
                    value={form.alertQuantity}
                    onChange={handleChange}
                    placeholder="10"
                    className="input-field text-left"
                    dir="ltr"
                    min="0"
                  />
                  <p className="text-xs text-gray-400 mt-1">تنبيه عند وصول المخزون لهذا الحد</p>
                </div>

                {/* Tax Rate */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">نسبة الضريبة (%)</label>
                  <div className="relative">
                    <input
                      type="number"
                      name="taxRate"
                      value={form.taxRate}
                      onChange={handleChange}
                      placeholder="15"
                      className="input-field pl-8 text-left"
                      dir="ltr"
                      step="0.01"
                      min="0"
                      max="100"
                    />
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400 text-sm">
                      %
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar - Image Upload */}
          <div className="space-y-6">
            <div className="card">
              <h3 className="text-lg font-bold text-gray-800 mb-4">صورة المنتج</h3>
              <div className="space-y-4">
                {imagePreview ? (
                  <div className="relative group">
                    <img
                      src={imagePreview}
                      alt="معاينة المنتج"
                      className="w-full aspect-square object-cover rounded-xl border border-gray-200"
                    />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute top-2 left-2 p-1.5 bg-red-500 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center w-full aspect-square border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-primary-400 hover:bg-primary-50/50 transition-colors">
                    <svg className="w-12 h-12 text-gray-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm text-gray-400">اضغط لرفع صورة</span>
                    <span className="text-xs text-gray-300 mt-1">PNG, JPG حتى 5MB</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                    />
                  </label>
                )}

                {imagePreview && (
                  <label className="flex items-center justify-center gap-2 w-full py-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 text-sm text-gray-600 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    تغيير الصورة
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageChange}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            {/* Price Summary Card */}
            {(form.price || form.cost) && (
              <div className="card bg-gray-50 border-gray-200">
                <h3 className="text-sm font-bold text-gray-600 mb-3">ملخص التسعير</h3>
                <div className="space-y-2 text-sm">
                  {form.price && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">سعر البيع</span>
                      <span className="font-medium">{Number(form.price).toLocaleString('ar-EG')} ج.م</span>
                    </div>
                  )}
                  {form.cost && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">سعر التكلفة</span>
                      <span className="font-medium">{Number(form.cost).toLocaleString('ar-EG')} ج.م</span>
                    </div>
                  )}
                  {form.price && form.cost && Number(form.price) > 0 && (
                    <>
                      <hr className="border-gray-200" />
                      <div className="flex justify-between">
                        <span className="text-gray-500">هامش الربح</span>
                        <span className="font-medium text-green-600">
                          {(Number(form.price) - Number(form.cost)).toLocaleString('ar-EG')} ج.م
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">نسبة الربح</span>
                        <span className="font-medium text-green-600">
                          {(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </>
                  )}
                  {form.taxRate && form.price && (
                    <>
                      <hr className="border-gray-200" />
                      <div className="flex justify-between">
                        <span className="text-gray-500">الضريبة</span>
                        <span className="font-medium">
                          {((Number(form.price) * Number(form.taxRate)) / 100).toLocaleString('ar-EG')} ج.م
                        </span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span className="text-gray-700">السعر شامل الضريبة</span>
                        <span className="text-primary-600">
                          {(Number(form.price) * (1 + Number(form.taxRate) / 100)).toLocaleString('ar-EG')} ج.م
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="btn-primary flex items-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>جاري الحفظ...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span>{isEditing ? 'تحديث المنتج' : 'إنشاء المنتج'}</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/products')}
            className="btn-secondary"
          >
            إلغاء
          </button>
        </div>
      </form>
    </div>
  );
}
