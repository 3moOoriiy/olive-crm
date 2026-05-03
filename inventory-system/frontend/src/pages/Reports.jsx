import { useState, useEffect } from 'react';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiBarChart2 } from 'react-icons/fi';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

export default function Reports() {
  const [activeReport, setActiveReport] = useState('sales');
  const [filters, setFilters] = useState({ from: '', to: '' });
  const [salesData, setSalesData] = useState(null);
  const [profitData, setProfitData] = useState(null);
  const [topProducts, setTopProducts] = useState([]);
  const [lowStock, setLowStock] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadReport(); }, [activeReport, filters]);

  const loadReport = async () => {
    setLoading(true);
    try {
      const params = { ...filters };
      Object.keys(params).forEach(k => !params[k] && delete params[k]);

      switch (activeReport) {
        case 'sales': {
          const { data } = await api.get('/reports/sales', { params });
          setSalesData(data);
          break;
        }
        case 'profit': {
          const { data } = await api.get('/reports/profit', { params });
          setProfitData(data);
          break;
        }
        case 'top-products': {
          const { data } = await api.get('/reports/top-products', { params: { ...params, limit: 20 } });
          setTopProducts(data);
          break;
        }
        case 'low-stock': {
          const { data } = await api.get('/reports/low-stock', { params });
          setLowStock(data);
          break;
        }
      }
    } catch (err) { toast.error('خطأ في تحميل التقرير'); }
    finally { setLoading(false); }
  };

  const reports = [
    { key: 'sales', label: 'المبيعات' },
    { key: 'profit', label: 'الأرباح' },
    { key: 'top-products', label: 'الأكثر مبيعاً' },
    { key: 'low-stock', label: 'المخزون المنخفض' },
  ];

  const formatNumber = (num) => {
    if (num == null) return '0';
    return Number(num).toLocaleString('ar-EG', { minimumFractionDigits: 2 });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold flex items-center gap-2"><FiBarChart2 /> التقارير</h1>

      {/* Report Tabs */}
      <div className="flex flex-wrap gap-2">
        {reports.map(r => (
          <button key={r.key} onClick={() => setActiveReport(r.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeReport === r.key ? 'bg-primary-600 text-white' : 'bg-white border hover:bg-gray-50'}`}
          >{r.label}</button>
        ))}
      </div>

      {/* Filters */}
      {activeReport !== 'low-stock' && (
        <div className="card flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-gray-500">من تاريخ</label>
            <input type="date" className="input-field" value={filters.from} onChange={e => setFilters(f => ({ ...f, from: e.target.value }))} />
          </div>
          <div>
            <label className="text-xs text-gray-500">إلى تاريخ</label>
            <input type="date" className="input-field" value={filters.to} onChange={e => setFilters(f => ({ ...f, to: e.target.value }))} />
          </div>
        </div>
      )}

      {loading ? (
        <div className="card text-center py-10 text-gray-400">جاري التحميل...</div>
      ) : (
        <>
          {/* Sales Report */}
          {activeReport === 'sales' && salesData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="stat-card"><div><p className="text-sm text-gray-500">إجمالي الإيرادات</p><p className="text-xl font-bold text-primary-600">{formatNumber(salesData.summary.totalRevenue)} ج.م</p></div></div>
                <div className="stat-card"><div><p className="text-sm text-gray-500">عدد الفواتير</p><p className="text-xl font-bold">{salesData.summary.invoiceCount}</p></div></div>
                <div className="stat-card"><div><p className="text-sm text-gray-500">إجمالي الخصومات</p><p className="text-xl font-bold text-red-500">{formatNumber(salesData.summary.totalDiscount)} ج.م</p></div></div>
                <div className="stat-card"><div><p className="text-sm text-gray-500">صافي الربح</p><p className="text-xl font-bold text-green-600">{formatNumber(salesData.summary.grossProfit)} ج.م</p></div></div>
              </div>
              {salesData.dailySales.length > 0 && (
                <div className="card">
                  <h3 className="font-bold mb-4">المبيعات اليومية</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={salesData.dailySales}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} name="الإجمالي" />
                      <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} name="عدد الفواتير" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Profit Report */}
          {activeReport === 'profit' && profitData && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {profitData.branches?.map((b, i) => (
                  <div key={i} className="space-y-2">
                    <div className="stat-card"><div><p className="text-sm text-gray-500">إجمالي الإيرادات</p><p className="text-xl font-bold text-primary-600">{formatNumber(b.revenue)} ج.م</p></div></div>
                    <div className="stat-card"><div><p className="text-sm text-gray-500">إجمالي التكلفة</p><p className="text-xl font-bold text-red-500">{formatNumber(b.cost)} ج.م</p></div></div>
                    <div className="stat-card"><div><p className="text-sm text-gray-500">صافي الربح</p><p className="text-xl font-bold text-green-600">{formatNumber(b.profit)} ج.م</p></div></div>
                  </div>
                ))}
              </div>
              {profitData.branches?.length > 0 && (
                <div className="card">
                  <h3 className="font-bold mb-4">ملخص الأرباح</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={profitData.branches}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="branchName" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="revenue" fill="#3b82f6" name="الإيرادات" />
                      <Bar dataKey="cost" fill="#ef4444" name="التكلفة" />
                      <Bar dataKey="profit" fill="#10b981" name="الربح" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          {/* Top Products */}
          {activeReport === 'top-products' && (
            <div className="space-y-4">
              {topProducts.length > 0 && (
                <div className="card">
                  <h3 className="font-bold mb-4">المنتجات الأكثر مبيعاً</h3>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={topProducts.slice(0, 10)} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" />
                      <YAxis dataKey="name" type="category" width={120} />
                      <Tooltip />
                      <Bar dataKey="totalSold" fill="#3b82f6" name="الكمية المباعة" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="card overflow-x-auto p-0">
                <table className="w-full">
                  <thead><tr className="table-header"><th className="p-3 text-right">#</th><th className="p-3 text-right">المنتج</th><th className="p-3 text-right">SKU</th><th className="p-3 text-center">الكمية المباعة</th><th className="p-3 text-right">الإيرادات</th><th className="p-3 text-right">الربح</th></tr></thead>
                  <tbody>
                    {topProducts.length === 0 ? (
                      <tr><td colSpan="6" className="p-8 text-center text-gray-400">لا توجد بيانات مبيعات</td></tr>
                    ) : topProducts.map((p, i) => (
                      <tr key={p.id} className="border-t"><td className="p-3">{i + 1}</td><td className="p-3 font-medium">{p.name}</td><td className="p-3 text-sm text-gray-500">{p.sku}</td><td className="p-3 text-center font-bold">{p.totalSold}</td><td className="p-3">{formatNumber(p.totalRevenue)} ج.م</td><td className="p-3 text-green-600">{formatNumber(p.profit)} ج.م</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Low Stock */}
          {activeReport === 'low-stock' && (
            <div className="card overflow-x-auto p-0">
              <table className="w-full">
                <thead><tr className="table-header"><th className="p-3 text-right">المنتج</th><th className="p-3 text-right">SKU</th><th className="p-3 text-center">الكمية المتبقية</th><th className="p-3 text-center">حد التنبيه</th><th className="p-3 text-right">الحالة</th></tr></thead>
                <tbody>
                  {lowStock.length === 0 ? (
                    <tr><td colSpan="5" className="p-8 text-center text-gray-400">لا يوجد مخزون منخفض - جميع المنتجات متوفرة</td></tr>
                  ) : lowStock.map((item, i) => (
                    <tr key={i} className={`border-t ${item.quantity <= 0 ? 'bg-red-50' : 'bg-amber-50'}`}>
                      <td className="p-3 font-medium">{item.name}</td>
                      <td className="p-3 text-sm text-gray-500 font-mono">{item.sku}</td>
                      <td className="p-3 text-center">
                        <span className={`inline-block min-w-[2.5rem] px-2 py-0.5 rounded-full text-xs font-bold ${item.quantity <= 0 ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-800'}`}>{item.quantity}</span>
                      </td>
                      <td className="p-3 text-center text-gray-400">{item.alertQuantity}</td>
                      <td className="p-3"><span className={`badge ${item.quantity <= 0 ? 'badge-danger' : 'badge-warning'}`}>{item.quantity <= 0 ? 'نفد المخزون' : 'منخفض'}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
