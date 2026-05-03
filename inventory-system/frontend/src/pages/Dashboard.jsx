import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const { data: res } = await api.get('/reports/dashboard');
      setData(res);
    } catch (error) {
      toast.error('فشل في تحميل بيانات لوحة التحكم');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
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

  const stats = [
    {
      title: 'إجمالي المنتجات',
      value: data?.stats?.totalProducts ?? 0,
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      ),
      color: 'bg-blue-500',
      lightColor: 'bg-blue-50',
      textColor: 'text-blue-600',
    },
    {
      title: 'إجمالي القطع بالمخزون',
      value: data?.stats?.totalStockQty ?? 0,
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
      color: 'bg-purple-500',
      lightColor: 'bg-purple-50',
      textColor: 'text-purple-600',
    },
    {
      title: 'قطع مباعة هذا الشهر',
      value: data?.stats?.monthSoldItems ?? 0,
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" />
        </svg>
      ),
      color: 'bg-indigo-500',
      lightColor: 'bg-indigo-50',
      textColor: 'text-indigo-600',
    },
    {
      title: 'مبيعات اليوم',
      value: data?.stats?.todaySalesTotal ?? 0,
      suffix: 'ج.م',
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'bg-green-500',
      lightColor: 'bg-green-50',
      textColor: 'text-green-600',
    },
    {
      title: 'مبيعات الشهر',
      value: data?.stats?.monthSalesTotal ?? 0,
      suffix: 'ج.م',
      icon: (
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      color: 'bg-amber-500',
      lightColor: 'bg-amber-50',
      textColor: 'text-amber-600',
    },
  ];

  const formatNumber = (num) => {
    if (num == null) return '0';
    return Number(num).toLocaleString('ar-EG');
  };

  const lowStockCount = data?.stats?.lowStockCount ?? 0;
  const lowStockProducts = data?.lowStockProducts ?? [];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">لوحة التحكم</h1>
        <p className="text-gray-500 text-sm mt-1">نظرة عامة على المخزون والمبيعات</p>
      </div>

      {/* Low Stock Alert Banner */}
      {lowStockCount > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="bg-red-100 p-2 rounded-lg shrink-0 mt-0.5">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <h3 className="text-red-800 font-bold text-base">
                تحذير: {lowStockCount} منتج وصل للحد الأدنى من المخزون!
              </h3>
              <p className="text-red-600 text-sm mt-1">
                يجب إعادة تموين المنتجات التالية في أقرب وقت لتجنب نفاد المخزون
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm min-w-[500px]">
                  <thead>
                    <tr className="border-b border-red-200">
                      <th className="text-right py-2 px-2 text-red-700 font-bold">المنتج</th>
                      <th className="text-right py-2 px-2 text-red-700 font-bold hidden sm:table-cell">SKU</th>
                      <th className="text-center py-2 px-2 text-red-700 font-bold">الكمية المتبقية</th>
                      <th className="text-center py-2 px-2 text-red-700 font-bold">حد التنبيه</th>
                      <th className="text-center py-2 px-2 text-red-700 font-bold">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockProducts.map((p) => (
                      <tr key={p.id} className="border-b border-red-100 last:border-0">
                        <td className="py-2 px-2 font-medium text-red-900">{p.name}</td>
                        <td className="py-2 px-2 font-mono text-red-700 hidden sm:table-cell">{p.sku}</td>
                        <td className="py-2 px-2 text-center">
                          <span className={`inline-block min-w-[2.5rem] px-2 py-0.5 rounded-full text-xs font-bold ${
                            p.quantity <= 0
                              ? 'bg-red-600 text-white'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {p.quantity}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center text-red-600">{p.alertQuantity}</td>
                        <td className="py-2 px-2 text-center">
                          {p.quantity <= 0 ? (
                            <span className="badge badge-danger">نفد</span>
                          ) : (
                            <span className="badge badge-warning">منخفض</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Link to="/inventory" className="inline-flex items-center gap-1 mt-3 text-red-700 hover:text-red-900 text-sm font-bold">
                إدارة المخزون
                <svg className="w-4 h-4 rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {stats.map((stat, index) => (
          <div key={index} className="stat-card">
            <div className={`${stat.lightColor} p-3 rounded-xl`}>
              <span className={stat.textColor}>{stat.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-500 truncate">{stat.title}</p>
              <p className="text-xl font-bold text-gray-800 mt-0.5">
                {formatNumber(stat.value)}
                {stat.suffix && <span className="text-sm font-normal text-gray-500 mr-1">{stat.suffix}</span>}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Stock Value Card */}
      <div className="card bg-gradient-to-l from-blue-50 to-white border border-blue-100">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-blue-600 font-medium">قيمة المخزون الإجمالية (بسعر التكلفة)</p>
            <p className="text-3xl font-bold text-blue-800 mt-1">
              {formatNumber(data?.stats?.totalStockValue ?? 0)} <span className="text-lg text-blue-500">ج.م</span>
            </p>
          </div>
          <div className="bg-blue-100 p-4 rounded-2xl">
            <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Trend Chart */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800">اتجاه المبيعات</h3>
            <span className="text-xs text-gray-400">آخر 30 يوم</span>
          </div>
          <div className="h-72">
            {data?.salesTrend?.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.salesTrend} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                  <defs>
                    <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toLocaleString()} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontFamily: 'Tajawal', direction: 'rtl' }}
                    formatter={(value) => [Number(value).toLocaleString('ar-EG') + ' ج.م', 'المبيعات']}
                    labelFormatter={(label) => `التاريخ: ${label}`}
                  />
                  <Area type="monotone" dataKey="total" stroke="#2563eb" strokeWidth={2.5} fill="url(#salesGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                لا توجد بيانات مبيعات
              </div>
            )}
          </div>
        </div>

        {/* Top Products Chart */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-gray-800">المنتجات الأكثر مبيعاً</h3>
            <span className="text-xs text-gray-400">حسب الكمية</span>
          </div>
          <div className="h-72">
            {data?.topProducts?.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.topProducts} margin={{ top: 5, right: 5, left: 5, bottom: 5 }} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={100} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontFamily: 'Tajawal', direction: 'rtl' }}
                    formatter={(value) => [Number(value).toLocaleString('ar-EG'), 'الكمية المباعة']}
                  />
                  <Bar dataKey="totalSold" fill="#2563eb" radius={[0, 6, 6, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                لا توجد بيانات منتجات
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Invoices */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-800">آخر الفواتير</h3>
          <Link to="/invoices" className="text-primary-600 hover:text-primary-700 text-sm font-medium">
            عرض الكل
          </Link>
        </div>
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full min-w-[600px]">
            <thead>
              <tr className="table-header">
                <th className="text-right px-4 py-3">رقم الفاتورة</th>
                <th className="text-right px-4 py-3">العميل</th>
                <th className="text-right px-4 py-3">الكاشير</th>
                <th className="text-right px-4 py-3">المبلغ</th>
                <th className="text-right px-4 py-3">الحالة</th>
                <th className="text-right px-4 py-3">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.recentInvoices?.length > 0 ? (
                data.recentInvoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <Link to={`/invoices/${invoice.id}`} className="font-mono text-sm text-primary-600 font-medium hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {invoice.customer?.name || 'عميل نقدي'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {invoice.user?.name || '-'}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-800">
                      {formatNumber(invoice.total)} ج.م
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${invoice.status === 'COMPLETED' ? 'badge-success' : invoice.status === 'CANCELLED' ? 'badge-danger' : 'badge-warning'}`}>
                        {invoice.status === 'COMPLETED' ? 'مكتملة' : invoice.status === 'CANCELLED' ? 'ملغاة' : 'معلقة'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {invoice.createdAt
                        ? new Date(invoice.createdAt).toLocaleDateString('ar-EG', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : '-'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-gray-400 text-sm">
                    لا توجد فواتير حديثة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
