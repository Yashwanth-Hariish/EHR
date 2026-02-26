import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

const DEMO_ACCOUNTS = [
  { email: 'admin@ehr.local', password: 'admin123', role: 'ADMIN', label: 'Admin' },
  { email: 'doctor@ehr.local', password: 'doctor123', role: 'DOCTOR', label: 'Doctor' },
  { email: 'patient@ehr.local', password: 'patient123', role: 'PATIENT', label: 'Patient' }
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      navigate(user.role === 'ADMIN' ? '/admin' : user.role === 'DOCTOR' ? '/doctor' : '/patient');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const fillDemo = (account) => {
    setEmail(account.email);
    setPassword(account.password);
    setError('');
  };

  return (
    <div className="login-page">
      <style>{`
        .login-page {
          min-height: 100vh;
          background: var(--bg-primary);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          position: relative;
          overflow: hidden;
        }
        .login-bg {
          position: absolute;
          inset: 0;
          background: radial-gradient(ellipse at 20% 50%, rgba(0,212,255,0.04) 0%, transparent 60%),
                      radial-gradient(ellipse at 80% 20%, rgba(124,77,255,0.04) 0%, transparent 60%);
          pointer-events: none;
        }
        .login-grid {
          position: absolute;
          inset: 0;
          background-image: linear-gradient(var(--border-color) 1px, transparent 1px),
                            linear-gradient(90deg, var(--border-color) 1px, transparent 1px);
          background-size: 40px 40px;
          opacity: 0.4;
          pointer-events: none;
        }
        .login-container {
          width: 100%;
          max-width: 420px;
          position: relative;
          z-index: 1;
        }
        .login-logo {
          text-align: center;
          margin-bottom: 40px;
        }
        .logo-icon {
          width: 56px;
          height: 56px;
          background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple));
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 28px;
          margin: 0 auto 16px;
          box-shadow: 0 8px 32px rgba(0,212,255,0.2);
        }
        .logo-title {
          font-family: var(--font-mono);
          font-size: 20px;
          font-weight: 700;
          color: var(--text-primary);
          letter-spacing: 0.05em;
        }
        .logo-sub {
          font-size: 12px;
          color: var(--text-muted);
          margin-top: 4px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }
        .login-card {
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: var(--radius);
          padding: 32px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.4);
        }
        .login-title {
          font-family: var(--font-mono);
          font-size: 13px;
          font-weight: 700;
          color: var(--accent-cyan);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin-bottom: 24px;
        }
        .demo-chips {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-bottom: 24px;
        }
        .demo-chip {
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--border-color);
          background: var(--bg-secondary);
          color: var(--text-secondary);
          transition: all 0.2s;
        }
        .demo-chip:hover { border-color: var(--accent-cyan); color: var(--accent-cyan); }
        .demo-label {
          font-size: 11px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: 8px;
        }
        .login-footer {
          text-align: center;
          margin-top: 20px;
          font-size: 12px;
          color: var(--text-muted);
        }
        .security-badges {
          display: flex;
          justify-content: center;
          gap: 12px;
          margin-top: 24px;
        }
        .sec-badge {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 11px;
          color: var(--text-muted);
        }
      `}</style>

      <div className="login-bg" />
      <div className="login-grid" />

      <div className="login-container">
        <div className="login-logo">
          <div className="logo-icon">🏥</div>
          <div className="logo-title">SecureEHR</div>
          <div className="logo-sub">Blockchain Health Records</div>
        </div>

        <div className="login-card">
          <div className="login-title">// System Access</div>

          <div className="demo-label">Quick access — demo accounts</div>
          <div className="demo-chips">
            {DEMO_ACCOUNTS.map(acc => (
              <button key={acc.role} className="demo-chip" onClick={() => fillDemo(acc)}>
                {acc.label}
              </button>
            ))}
          </div>

          {error && (
            <div className="ehr-alert error" style={{ marginBottom: 20 }}>
              <span>⚠</span> {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="ehr-form-group">
              <label className="ehr-label">Email Address</label>
              <input
                type="email"
                className="ehr-input"
                placeholder="user@ehr.local"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="ehr-form-group">
              <label className="ehr-label">Password</label>
              <input
                type="password"
                className="ehr-input"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="btn-ehr btn-primary-ehr"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              disabled={loading}
            >
              {loading ? (
                <><span className="spinner" style={{ width: 16, height: 16 }} /> Authenticating...</>
              ) : (
                '→ Sign In'
              )}
            </button>
          </form>
        </div>

        <div className="security-badges">
          <span className="sec-badge">🔐 AES-256-GCM</span>
          <span className="sec-badge">⛓ Hyperledger Fabric</span>
          <span className="sec-badge">🌐 IPFS Storage</span>
        </div>

        <div className="login-footer">
          All data encrypted end-to-end. Access logged immutably on blockchain.
        </div>
      </div>
    </div>
  );
}
