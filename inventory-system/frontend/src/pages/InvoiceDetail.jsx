import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import toast from 'react-hot-toast';
import { FiArrowRight, FiPrinter, FiDownload, FiSettings } from 'react-icons/fi';
import html2pdf from 'html2pdf.js';

const PAPER_SIZES = {
  A4: { label: 'A4 (21 × 29.7 سم)', width: '210mm', height: '297mm', cssSize: 'A4' },
  A5: { label: 'A5 (14.8 × 21 سم)', width: '148mm', height: '210mm', cssSize: 'A5' },
  A6: { label: 'A6 (10.5 × 14.8 سم)', width: '105mm', height: '148mm', cssSize: 'A6' },
  thermal80: { label: 'حراري 80mm', width: '80mm', height: 'auto', cssSize: '80mm auto' },
  thermal58: { label: 'حراري 58mm', width: '58mm', height: 'auto', cssSize: '58mm auto' },
};

export default function InvoiceDetail() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paperSize, setPaperSize] = useState(localStorage.getItem('invoicePaperSize') || 'A5');
  const [companyName, setCompanyName] = useState(localStorage.getItem('companyName') || 'اسم الشركة');
  const [companyPhone, setCompanyPhone] = useState(localStorage.getItem('companyPhone') || '');
  const [companyAddress, setCompanyAddress] = useState(localStorage.getItem('companyAddress') || '');
  const [showSettings, setShowSettings] = useState(false);
  const printRef = useRef(null);

  useEffect(() => { loadInvoice(); }, [id]);

  useEffect(() => { localStorage.setItem('invoicePaperSize', paperSize); }, [paperSize]);

  const loadInvoice = async () => {
    try {
      const { data } = await api.get(`/invoices/${id}`);
      setInvoice(data);
    } catch (err) {
      toast.error('خطأ في تحميل الفاتورة');
    } finally { setLoading(false); }
  };

  const saveCompanyName = (name) => {
    const trimmed = (name || '').trim() || 'اسم الشركة';
    setCompanyName(trimmed);
    localStorage.setItem('companyName', trimmed);
    toast.success('تم حفظ اسم الشركة');
  };

  const saveCompanyPhone = (phone) => {
    const trimmed = (phone || '').trim();
    setCompanyPhone(trimmed);
    localStorage.setItem('companyPhone', trimmed);
    toast.success('تم حفظ رقم الهاتف');
  };

  const saveCompanyAddress = (address) => {
    const trimmed = (address || '').trim();
    setCompanyAddress(trimmed);
    localStorage.setItem('companyAddress', trimmed);
    toast.success('تم حفظ العنوان');
  };

  const handlePrint = () => {
    // Inject dynamic @page size before print
    const style = document.createElement('style');
    style.id = 'dynamic-print-style';
    style.innerHTML = `@page { size: ${PAPER_SIZES[paperSize].cssSize}; margin: 5mm; }`;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => {
      const s = document.getElementById('dynamic-print-style');
      if (s) s.remove();
    }, 1000);
  };

  const handleDownloadPDF = () => {
    if (!printRef.current) return;
    const size = PAPER_SIZES[paperSize];
    const isThermal = paperSize.startsWith('thermal');
    const opt = {
      margin: isThermal ? 2 : 5,
      filename: `فاتورة-${invoice.invoiceNumber}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: isThermal
        ? { unit: 'mm', format: [parseInt(size.width), 297], orientation: 'portrait' }
        : { unit: 'mm', format: paperSize.toLowerCase(), orientation: 'portrait' },
    };
    toast.loading('جاري إنشاء PDF...', { id: 'pdf' });
    html2pdf().set(opt).from(printRef.current).save().then(() => {
      toast.success('تم حفظ PDF', { id: 'pdf' });
    }).catch(() => {
      toast.error('فشل حفظ PDF', { id: 'pdf' });
    });
  };

  if (loading) return <div className="text-center py-10 text-gray-400">جاري التحميل...</div>;
  if (!invoice) return <div className="text-center py-10 text-gray-400">الفاتورة غير موجودة</div>;

  const paymentMap = { CASH: 'نقدي', CARD: 'بطاقة', TRANSFER: 'تحويل', MIXED: 'مختلط' };
  const isThermal = paperSize.startsWith('thermal');
  const paperWidth = PAPER_SIZES[paperSize].width;

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Toolbar - not printed */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <Link to="/invoices" className="text-primary-600 hover:text-primary-800"><FiArrowRight size={20} /></Link>
        <h1 className="text-2xl font-bold flex-1">تفاصيل الفاتورة</h1>

        <select className="input-field w-auto" value={paperSize} onChange={e => setPaperSize(e.target.value)}>
          {Object.entries(PAPER_SIZES).map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
        </select>

        <button onClick={() => setShowSettings(!showSettings)} className="btn-secondary flex items-center gap-2" title="إعدادات"><FiSettings /></button>
        <button onClick={handleDownloadPDF} className="btn-secondary flex items-center gap-2"><FiDownload /> حفظ PDF</button>
        <button onClick={handlePrint} className="btn-primary flex items-center gap-2"><FiPrinter /> طباعة</button>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="card no-print space-y-3">
          <h3 className="font-bold">إعدادات الفاتورة</h3>
          <div>
            <label className="block text-sm font-medium mb-1">اسم الشركة</label>
            <input
              type="text"
              className="input-field"
              defaultValue={companyName}
              onBlur={e => saveCompanyName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
              placeholder="اكتب اسم الشركة"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">رقم هاتف الشركة</label>
            <input
              type="text"
              className="input-field"
              defaultValue={companyPhone}
              onBlur={e => saveCompanyPhone(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
              placeholder="مثال: 01000000000"
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">عنوان الشركة</label>
            <input
              type="text"
              className="input-field"
              defaultValue={companyAddress}
              onBlur={e => saveCompanyAddress(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
              placeholder="اكتب عنوان الشركة"
            />
          </div>
          <p className="text-xs text-gray-500">يتم الحفظ تلقائياً عند الخروج من الحقل أو الضغط على Enter.</p>
        </div>
      )}

      {/* Printable area */}
      <div className="print-wrapper">
        <div
          ref={printRef}
          id="invoice-print"
          className="bg-white mx-auto"
          style={{
            width: paperWidth,
            minHeight: isThermal ? 'auto' : PAPER_SIZES[paperSize].height,
            padding: isThermal ? '5mm 3mm' : '10mm',
            boxShadow: '0 0 10px rgba(0,0,0,0.1)',
            fontSize: isThermal ? '11px' : '13px',
            boxSizing: 'border-box',
          }}
        >
          {/* Header */}
          <div className="text-center pb-2 mb-3" style={{ borderBottom: '2px solid #333' }}>
            <h2 style={{ fontSize: isThermal ? '14px' : '20px', fontWeight: 'bold', margin: 0 }}>{companyName}</h2>
            {companyAddress && (
              <p style={{ fontSize: isThermal ? '10px' : '12px', margin: '4px 0 0 0', color: '#555' }}>{companyAddress}</p>
            )}
            {companyPhone && (
              <p style={{ fontSize: isThermal ? '10px' : '12px', margin: '2px 0 0 0', color: '#555' }} dir="ltr">📞 {companyPhone}</p>
            )}
          </div>

          {/* Invoice Info */}
          {isThermal ? (
            <div style={{ marginBottom: '8px', fontSize: '10px', lineHeight: '1.6' }}>
              <div><strong>رقم الفاتورة:</strong> {invoice.invoiceNumber}</div>
              <div><strong>التاريخ:</strong> {new Date(invoice.createdAt).toLocaleString('ar-EG')}</div>
              <div><strong>النوع:</strong> {invoice.type === 'SALE' ? 'بيع' : 'إرجاع'}</div>
              <div><strong>الدفع:</strong> {paymentMap[invoice.paymentMethod]}</div>
              <div><strong>الكاشير:</strong> {invoice.user?.name}</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px', fontSize: '13px' }}>
              <div>
                <p style={{ margin: '2px 0' }}><strong>رقم الفاتورة:</strong> {invoice.invoiceNumber}</p>
                <p style={{ margin: '2px 0' }}><strong>النوع:</strong> {invoice.type === 'SALE' ? 'بيع' : 'إرجاع'}</p>
                <p style={{ margin: '2px 0' }}><strong>الدفع:</strong> {paymentMap[invoice.paymentMethod]}</p>
              </div>
              <div style={{ textAlign: 'left' }}>
                <p style={{ margin: '2px 0' }}><strong>التاريخ:</strong> {new Date(invoice.createdAt).toLocaleString('ar-EG')}</p>
                <p style={{ margin: '2px 0' }}><strong>الكاشير:</strong> {invoice.user?.name}</p>
              </div>
            </div>
          )}

          {/* Customer Info */}
          {invoice.customer && (
            <div style={{
              marginBottom: '12px',
              padding: isThermal ? '4px 0' : '8px',
              border: isThermal ? 'none' : '1px solid #ddd',
              borderTop: isThermal ? '1px dashed #999' : '1px solid #ddd',
              borderBottom: isThermal ? '1px dashed #999' : '1px solid #ddd',
              borderRadius: isThermal ? 0 : '4px',
              fontSize: isThermal ? '10px' : '12px',
              lineHeight: '1.6',
            }}>
              <div style={{ fontWeight: 'bold', marginBottom: '2px' }}>بيانات العميل:</div>
              <div><strong>الاسم:</strong> {invoice.customer.name}</div>
              {invoice.customer.phone && <div><strong>الهاتف:</strong> <span dir="ltr">{invoice.customer.phone}</span></div>}
              {invoice.customer.address && <div><strong>العنوان:</strong> {invoice.customer.address}</div>}
            </div>
          )}

          {/* Items */}
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px', fontSize: isThermal ? '10px' : '12px' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #333' }}>
                <th style={{ padding: '4px', textAlign: 'right' }}>المنتج</th>
                <th style={{ padding: '4px', textAlign: 'center' }}>كمية</th>
                <th style={{ padding: '4px', textAlign: 'center' }}>سعر</th>
                {!isThermal && <th style={{ padding: '4px', textAlign: 'center' }}>خصم</th>}
                {!isThermal && <th style={{ padding: '4px', textAlign: 'center' }}>ضريبة</th>}
                <th style={{ padding: '4px', textAlign: 'left' }}>إجمالي</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items?.map((item) => (
                <tr key={item.id} style={{ borderBottom: '1px dashed #ccc' }}>
                  <td style={{ padding: '4px' }}>{item.product?.name}</td>
                  <td style={{ padding: '4px', textAlign: 'center' }}>{item.quantity}</td>
                  <td style={{ padding: '4px', textAlign: 'center' }}>{item.price?.toFixed(2)}</td>
                  {!isThermal && <td style={{ padding: '4px', textAlign: 'center' }}>{item.discount?.toFixed(2)}</td>}
                  {!isThermal && <td style={{ padding: '4px', textAlign: 'center' }}>{item.tax?.toFixed(2)}</td>}
                  <td style={{ padding: '4px', textAlign: 'left', fontWeight: 'bold' }}>{item.total?.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div style={{ borderTop: '2px solid #333', paddingTop: '8px', fontSize: isThermal ? '11px' : '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', margin: '2px 0' }}>
              <span>المجموع الفرعي:</span><span>{invoice.subtotal?.toFixed(2)} ج.م</span>
            </div>
            {invoice.taxAmount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '2px 0', color: '#666' }}>
                <span>الضريبة:</span><span>{invoice.taxAmount?.toFixed(2)} ج.م</span>
              </div>
            )}
            {invoice.discount > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', margin: '2px 0', color: '#c00' }}>
                <span>الخصم:</span><span>-{invoice.discount?.toFixed(2)} ج.م</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: isThermal ? '13px' : '16px', borderTop: '1px solid #333', paddingTop: '6px', marginTop: '4px' }}>
              <span>الإجمالي:</span><span>{invoice.total?.toFixed(2)} ج.م</span>
            </div>
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', marginTop: '16px', paddingTop: '8px', borderTop: '1px dashed #999', fontSize: isThermal ? '9px' : '11px', color: '#666' }}>
            <p style={{ margin: 0 }}>شكراً لتعاملكم معنا</p>
          </div>
        </div>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #invoice-print, #invoice-print * { visibility: visible !important; }
          #invoice-print {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            right: 0 !important;
            margin: 0 auto !important;
            box-shadow: none !important;
            width: ${paperWidth} !important;
            padding: ${isThermal ? '2mm' : '5mm'} !important;
          }
          .no-print { display: none !important; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          @page { margin: 0; }
        }
      `}</style>
    </div>
  );
}
