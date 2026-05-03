import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotConfirmPassword, setForgotConfirmPassword] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('يرجى إدخال البريد الإلكتروني وكلمة المرور');
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      toast.success('تم تسجيل الدخول بنجاح');
      navigate('/');
    } catch (error) {
      const message =
        error.response?.data?.message || 'فشل تسجيل الدخول، يرجى المحاولة مرة أخرى';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!forgotEmail || !forgotNewPassword) {
      toast.error('يرجى ملء جميع الحقول');
      return;
    }
    if (forgotNewPassword.length < 6) {
      toast.error('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }
    if (forgotNewPassword !== forgotConfirmPassword) {
      toast.error('كلمة المرور غير متطابقة');
      return;
    }
    setForgotLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail, newPassword: forgotNewPassword });
      toast.success('تم إعادة تعيين كلمة المرور بنجاح! يمكنك تسجيل الدخول الآن');
      setShowForgot(false);
      setEmail(forgotEmail);
      setForgotEmail('');
      setForgotNewPassword('');
      setForgotConfirmPassword('');
    } catch (error) {
      toast.error(error.response?.data?.message || 'خطأ في إعادة تعيين كلمة المرور');
    } finally {
      setForgotLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '10px 40px 10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
    textAlign: 'left',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s, box-shadow 0.2s',
  };

  const handleFocus = (e) => {
    e.target.style.borderColor = '#3b82f6';
    e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.15)';
  };
  const handleBlur = (e) => {
    e.target.style.borderColor = '#d1d5db';
    e.target.style.boxShadow = 'none';
  };

  return (
    <div dir="rtl" style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 40%, #2563eb 100%)',
      padding: '16px',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: 'Tajawal, sans-serif',
    }}>
      {/* Decorative circles */}
      <div style={{ position:'absolute', top:'-80px', left:'-80px', width:'280px', height:'280px', background:'rgba(59,130,246,0.15)', borderRadius:'50%', filter:'blur(80px)', pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'-80px', right:'-80px', width:'320px', height:'320px', background:'rgba(96,165,250,0.12)', borderRadius:'50%', filter:'blur(80px)', pointerEvents:'none' }} />

      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: '420px', margin: '0 auto' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: '72px', height: '72px', background: 'rgba(255,255,255,0.12)',
            backdropFilter: 'blur(8px)', borderRadius: '16px', marginBottom: '16px',
            border: '1px solid rgba(255,255,255,0.2)',
          }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
          </div>
          <h1 style={{ fontSize: '28px', fontWeight: 700, color: '#fff', margin: '0 0 4px 0' }}>نظام إدارة المخزون</h1>
          <p style={{ color: '#bfdbfe', fontSize: '14px', margin: 0 }}>قم بتسجيل الدخول للوصول إلى لوحة التحكم</p>
        </div>

        {/* Card */}
        <div style={{
          background: '#fff', borderRadius: '16px', padding: '32px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
        }}>
          {!showForgot ? (
            <>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1f2937', margin: 0 }}>تسجيل الدخول</h2>
                <p style={{ color: '#6b7280', fontSize: '14px', margin: '4px 0 0 0' }}>أدخل بيانات الاعتماد الخاصة بك</p>
              </div>

              <form onSubmit={handleSubmit}>
                {/* Email */}
                <div style={{ marginBottom: '20px' }}>
                  <label htmlFor="email" style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                    البريد الإلكتروني
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', top: '50%', right: '12px', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none', display: 'flex' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </span>
                    <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                      placeholder="example@company.com" dir="ltr" autoComplete="email"
                      style={inputStyle} onFocus={handleFocus} onBlur={handleBlur} />
                  </div>
                </div>

                {/* Password */}
                <div style={{ marginBottom: '24px' }}>
                  <label htmlFor="password" style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                    كلمة المرور
                  </label>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', top: '50%', right: '12px', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none', display: 'flex' }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </span>
                    <input id="password" type={showPassword ? 'text' : 'password'} value={password}
                      onChange={(e) => setPassword(e.target.value)} placeholder="********" dir="ltr" autoComplete="current-password"
                      style={{ ...inputStyle, paddingLeft: '40px', paddingRight: '40px' }}
                      onFocus={handleFocus} onBlur={handleBlur} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', top: '50%', left: '12px', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: 0, display: 'flex' }}>
                      {showPassword ? (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.59 6.59m7.532 7.532l3.29 3.29M3 3l18 18" />
                        </svg>
                      ) : (
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Submit */}
                <button type="submit" disabled={loading} style={{
                  width: '100%', padding: '12px', backgroundColor: loading ? '#93c5fd' : '#2563eb',
                  color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 600,
                  cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: '8px', transition: 'background-color 0.2s', fontFamily: 'inherit',
                }}
                  onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                  onMouseLeave={(e) => { if (!loading) e.currentTarget.style.backgroundColor = '#2563eb'; }}>
                  {loading ? (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity="0.75" />
                      </svg>
                      <span>جاري تسجيل الدخول...</span>
                    </>
                  ) : (
                    <>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                      </svg>
                      <span>تسجيل الدخول</span>
                    </>
                  )}
                </button>
              </form>

              <div style={{ textAlign: 'center', marginTop: '16px' }}>
                <button onClick={() => setShowForgot(true)} style={{
                  background: 'none', border: 'none', color: '#2563eb', fontSize: '13px',
                  cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline',
                }}>
                  نسيت كلمة المرور؟
                </button>
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: '24px' }}>
                <h2 style={{ fontSize: '20px', fontWeight: 700, color: '#1f2937', margin: 0 }}>إعادة تعيين كلمة المرور</h2>
                <p style={{ color: '#6b7280', fontSize: '14px', margin: '4px 0 0 0' }}>أدخل بريدك الإلكتروني وكلمة المرور الجديدة</p>
              </div>

              <form onSubmit={handleForgotPassword}>
                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                    البريد الإلكتروني
                  </label>
                  <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)}
                    placeholder="example@company.com" dir="ltr" required
                    style={{ ...inputStyle, paddingRight: '12px' }} onFocus={handleFocus} onBlur={handleBlur} />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                    كلمة المرور الجديدة
                  </label>
                  <input type="password" value={forgotNewPassword} onChange={(e) => setForgotNewPassword(e.target.value)}
                    placeholder="6 أحرف على الأقل" dir="ltr" required minLength="6"
                    style={{ ...inputStyle, paddingRight: '12px' }} onFocus={handleFocus} onBlur={handleBlur} />
                </div>

                <div style={{ marginBottom: '24px' }}>
                  <label style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#374151', marginBottom: '6px' }}>
                    تأكيد كلمة المرور
                  </label>
                  <input type="password" value={forgotConfirmPassword} onChange={(e) => setForgotConfirmPassword(e.target.value)}
                    placeholder="أعد إدخال كلمة المرور" dir="ltr" required minLength="6"
                    style={{ ...inputStyle, paddingRight: '12px' }} onFocus={handleFocus} onBlur={handleBlur} />
                </div>

                <button type="submit" disabled={forgotLoading} style={{
                  width: '100%', padding: '12px', backgroundColor: forgotLoading ? '#93c5fd' : '#2563eb',
                  color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 600,
                  cursor: forgotLoading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: '8px', transition: 'background-color 0.2s', fontFamily: 'inherit',
                  marginBottom: '12px',
                }}
                  onMouseEnter={(e) => { if (!forgotLoading) e.currentTarget.style.backgroundColor = '#1d4ed8'; }}
                  onMouseLeave={(e) => { if (!forgotLoading) e.currentTarget.style.backgroundColor = '#2563eb'; }}>
                  {forgotLoading ? 'جاري إعادة التعيين...' : 'إعادة تعيين كلمة المرور'}
                </button>

                <button type="button" onClick={() => { setShowForgot(false); setForgotEmail(''); setForgotNewPassword(''); setForgotConfirmPassword(''); }}
                  style={{
                    width: '100%', padding: '12px', backgroundColor: '#f3f4f6',
                    color: '#374151', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 500,
                    cursor: 'pointer', fontFamily: 'inherit', transition: 'background-color 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e5e7eb'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}>
                  العودة لتسجيل الدخول
                </button>
              </form>
            </>
          )}
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', color: '#bfdbfe', fontSize: '12px', margin: '24px 0 0 0' }}>
          &copy; {new Date().getFullYear()} نظام إدارة المخزون. جميع الحقوق محفوظة.
        </p>
        <p style={{ textAlign: 'center', color: '#93c5fd', fontSize: '11px', margin: '4px 0 0 0' }}>
          تم التطوير بواسطة AmrAlaa
        </p>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
