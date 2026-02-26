import React, { useState, useEffect } from 'react';
import Sidebar from '../Common/Sidebar';
import { recordsAPI, accessAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';

const NAV_ITEMS = [
  { id: 'records', label: 'My Records', icon: '📋' },
  { id: 'access', label: 'Access Control', icon: '🔑' },
  { id: 'keys', label: 'My Keys', icon: '🗝' }
];

export default function PatientDashboard() {
  const { user } = useAuth();
  const [active, setActive] = useState('records');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (active === 'records' || active === 'access') loadRecords();
  }, [active]);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const res = await recordsAPI.getPatientRecords(user.userId);
      setRecords(res.data.records || []);
    } catch (err) {
      console.error(err);
      setRecords([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar navItems={NAV_ITEMS} activeItem={active} onNavigate={setActive} />
      <main className="main-content">
        {active === 'records' && (
          <RecordsPanel records={records} loading={loading} user={user} onRefresh={loadRecords} />
        )}
        {active === 'access' && (
          <AccessPanel records={records} loading={loading} user={user} />
        )}
        {active === 'keys' && <KeysPanel user={user} />}
      </main>
    </div>
  );
}

function RecordsPanel({ records, loading, user, onRefresh }) {
  const [downloadingId, setDownloadingId] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const handleDownload = async (record) => {
    setDownloadingId(record.recordId);
    setDownloadError(null);

    // Check that the patient has a private key stored
    const privateKey = localStorage.getItem('ehr_private_key');
    if (!privateKey) {
      setDownloadError('No private key found. Please generate your RSA keypair under the "My Keys" tab and save it to your browser before downloading.');
      setDownloadingId(null);
      return;
    }

    try {
      const res = await recordsAPI.download(record.recordId);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = record.filename || `${record.recordType.replace(/\s/g, '_')}.bin`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Download failed';
      setDownloadError(msg);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">// My Health Records</h1>
          <p className="page-subtitle">Your medical records, encrypted and stored on IPFS</p>
        </div>
        <button className="btn-ehr btn-ghost-ehr btn-sm-ehr" onClick={onRefresh}>↻ Refresh</button>
      </div>

      {downloadError && (
        <div className="ehr-alert error" style={{ marginBottom: 16 }}>
          <span>⚠ {downloadError}</span>
          <button
            onClick={() => setDownloadError(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 16 }}
          >×</button>
        </div>
      )}

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', maxWidth: 600, marginBottom: 24 }}>
        <div className="stat-tile cyan">
          <div className="stat-icon">📄</div>
          <div className="stat-value">{records.length}</div>
          <div className="stat-label">Total Records</div>
        </div>
        <div className="stat-tile green">
          <div className="stat-icon">🔐</div>
          <div className="stat-value">All</div>
          <div className="stat-label">Encrypted</div>
        </div>
        <div className="stat-tile amber">
          <div className="stat-icon">⛓</div>
          <div className="stat-value">✓</div>
          <div className="stat-label">On-Chain</div>
        </div>
      </div>

      {loading ? (
        <div className="loading-overlay"><div className="spinner" /><p>Loading your records...</p></div>
      ) : (
        <div className="ehr-card">
          <div className="card-title" style={{ marginBottom: 16 }}>Health Records</div>
          {records.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>🏥</div>
              <p>No records yet. Your doctor will upload records here.</p>
            </div>
          ) : (
            <div className="ehr-table-wrapper">
              <table className="ehr-table">
                <thead>
                  <tr>
                    <th>Record Type</th>
                    <th>Uploaded By</th>
                    <th>IPFS CID</th>
                    <th>Date</th>
                    <th>Integrity</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(record => (
                    <tr key={record.recordId}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{record.recordType}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          #{record.recordId?.slice(-8)}
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                        Dr. {record.doctorId?.slice(0, 10)}...
                      </td>
                      <td>
                        <span className="cid-chip" title={record.ipfsCid}>{record.ipfsCid?.slice(0, 18)}...</span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatDistanceToNow(new Date(record.timestamp), { addSuffix: true })}
                      </td>
                      <td><span className="badge-status active">Verified</span></td>
                      <td>
                        <button
                          className="btn-ehr btn-primary-ehr btn-sm-ehr"
                          onClick={() => handleDownload(record)}
                          disabled={downloadingId === record.recordId}
                        >
                          {downloadingId === record.recordId ? '...' : '⬇ Download'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function AccessPanel({ records, loading, user }) {
  const [selectedRecord, setSelectedRecord] = useState('');
  const [grants, setGrants] = useState([]);
  const [loadingGrants, setLoadingGrants] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [grantForm, setGrantForm] = useState({ doctorId: '', doctorPublicKey: '' });
  const [submitting, setSubmitting] = useState(false);
  const [grantResult, setGrantResult] = useState(null);

  const loadGrants = async (recordId) => {
    setSelectedRecord(recordId);
    setLoadingGrants(true);
    try {
      const res = await accessAPI.getGrants(recordId);
      setGrants(res.data.grants || []);
    } catch (err) {
      console.error(err);
      setGrants([]);
    } finally {
      setLoadingGrants(false);
    }
  };

  const handleGrant = async () => {
    setSubmitting(true);
    setGrantResult(null);
    // Auto-read the patient's private key from localStorage (stored at login)
    const patientPrivateKey = localStorage.getItem('ehr_private_key') || '';
    try {
      await accessAPI.grant({
        recordId: selectedRecord,
        doctorId: grantForm.doctorId,
        patientPrivateKey,
        doctorPublicKey: grantForm.doctorPublicKey
      });
      setGrantResult({ success: true, msg: 'Access granted successfully' });
      setShowGrantModal(false);
      loadGrants(selectedRecord);
    } catch (err) {
      setGrantResult({ success: false, msg: err.response?.data?.error || err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (doctorId) => {
    if (!window.confirm(`Revoke access for doctor ${doctorId}?`)) return;
    try {
      await accessAPI.revoke({ recordId: selectedRecord, doctorId });
      loadGrants(selectedRecord);
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">// Access Control</h1>
        <p className="page-subtitle">Control who can access your medical records using Proxy Re-Encryption</p>
      </div>

      <div className="ehr-alert info" style={{ marginBottom: 24 }}>
        <span>🔒</span>
        <span>Proxy Re-Encryption allows doctors to access your data without ever exposing your private key or the plaintext. A cryptographic re-encryption key is computed and stored on the blockchain.</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        <div className="ehr-card" style={{ alignSelf: 'flex-start' }}>
          <div className="card-title" style={{ marginBottom: 14 }}>Select Record</div>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading...</div>
          ) : records.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No records available</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {records.map(r => (
                <button
                  key={r.recordId}
                  className={`sidebar-link ${selectedRecord === r.recordId ? 'active' : ''}`}
                  onClick={() => loadGrants(r.recordId)}
                  style={{ fontSize: 13 }}
                >
                  <span>📄</span>
                  <div>
                    <div>{r.recordType}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>#{r.recordId?.slice(-8)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="ehr-card">
          {!selectedRecord ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.2 }}>←</div>
              <p>Select a record to manage its access permissions</p>
            </div>
          ) : (
            <>
              <div className="ehr-card-header">
                <div className="card-title">Access Grants</div>
                <button className="btn-ehr btn-success-ehr btn-sm-ehr" onClick={() => setShowGrantModal(true)}>
                  + Grant Access
                </button>
              </div>

              {grantResult && (
                <div className={`ehr-alert ${grantResult.success ? 'success' : 'error'}`}>
                  {grantResult.msg}
                </div>
              )}

              {loadingGrants ? (
                <div className="loading-overlay"><div className="spinner" /></div>
              ) : grants.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
                  No active access grants for this record.
                </div>
              ) : (
                <div className="ehr-table-wrapper">
                  <table className="ehr-table">
                    <thead>
                      <tr>
                        <th>Doctor</th>
                        <th>Granted</th>
                        <th>PRE Key</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grants.map(grant => (
                        <tr key={grant.grantId}>
                          <td>
                            <div style={{ fontWeight: 600 }}>{grant.doctorName || grant.doctorId}</div>
                          </td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {formatDistanceToNow(new Date(grant.grantedAt), { addSuffix: true })}
                          </td>
                          <td>
                            <span className="cid-chip">rk_{grant.grantId?.slice(0, 8)}...</span>
                          </td>
                          <td>
                            <span className={`badge-status ${grant.active ? 'active' : 'revoked'}`}>
                              {grant.active ? 'Active' : 'Revoked'}
                            </span>
                          </td>
                          <td>
                            {grant.active && (
                              <button
                                className="btn-ehr btn-danger-ehr btn-sm-ehr"
                                onClick={() => handleRevoke(grant.doctorId)}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showGrantModal && (
        <div className="ehr-modal-backdrop">
          <div className="ehr-modal">
            <div className="ehr-modal-header">
              <div className="ehr-modal-title">Grant Doctor Access</div>
              <button className="ehr-modal-close" onClick={() => setShowGrantModal(false)}>×</button>
            </div>
            <div className="ehr-alert info" style={{ marginBottom: 16 }}>
              A Proxy Re-Encryption key will be computed from your private key and the doctor's public key. The doctor can then decrypt your record without seeing your private key.
            </div>
            <div className="ehr-form-group">
              <label className="ehr-label">Doctor ID</label>
              <input className="ehr-input" placeholder="doctor-001" value={grantForm.doctorId}
                onChange={e => setGrantForm({...grantForm, doctorId: e.target.value})} />
            </div>
            <div className="ehr-form-group">
              <label className="ehr-label">Doctor's Public Key (PEM)</label>
              <textarea className="ehr-textarea" rows={4}
                placeholder="-----BEGIN PUBLIC KEY-----..."
                value={grantForm.doctorPublicKey}
                onChange={e => setGrantForm({...grantForm, doctorPublicKey: e.target.value})}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
            </div>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button className="btn-ehr btn-ghost-ehr" onClick={() => setShowGrantModal(false)}>Cancel</button>
              <button className="btn-ehr btn-success-ehr" onClick={handleGrant} disabled={submitting || !grantForm.doctorId}>
                {submitting ? 'Processing PRE...' : '🔑 Grant Access'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function KeysPanel({ user }) {
  const [keys, setKeys] = useState(null);
  const [generating, setGenerating] = useState(false);

  const generateKeys = async () => {
    setGenerating(true);
    try {
      // Simulate key generation
      await new Promise(r => setTimeout(r, 1000));
      setKeys({
        publicKey: `-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...DEMO_PUBLIC_KEY...\n-----END PUBLIC KEY-----`,
        privateKey: `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...DEMO_PRIVATE_KEY_STORE_SECURELY...\n-----END RSA PRIVATE KEY-----`
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">// Cryptographic Keys</h1>
        <p className="page-subtitle">Manage your RSA keypair for encrypting and decrypting records</p>
      </div>

      <div className="ehr-alert warning" style={{ marginBottom: 24, maxWidth: 700 }}>
        ⚠ Your private key must be stored securely and never shared. Loss of your private key means you cannot decrypt your records.
      </div>

      <div className="ehr-card" style={{ maxWidth: 700 }}>
        <div className="ehr-card-header">
          <div className="card-title">RSA-2048 Keypair</div>
          <button className="btn-ehr btn-primary-ehr btn-sm-ehr" onClick={generateKeys} disabled={generating}>
            {generating ? 'Generating...' : '⟳ Generate New Keypair'}
          </button>
        </div>

        {user.publicKey && (
          <div className="ehr-form-group">
            <label className="ehr-label">Registered Public Key</label>
            <textarea className="ehr-textarea" rows={4} readOnly value={user.publicKey}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
          </div>
        )}

        {keys && (
          <>
            <div className="ehr-alert success">New keypair generated. Download and store your private key securely.</div>
            <div className="ehr-form-group" style={{ marginTop: 16 }}>
              <label className="ehr-label">New Public Key</label>
              <textarea className="ehr-textarea" rows={4} readOnly value={keys.publicKey}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
            </div>
            <div className="ehr-form-group">
              <label className="ehr-label" style={{ color: 'var(--accent-amber)' }}>Private Key — Store Securely!</label>
              <textarea className="ehr-textarea" rows={6} readOnly value={keys.privateKey}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 11, borderColor: 'var(--accent-amber)' }} />
            </div>
            <button className="btn-ehr btn-success-ehr" onClick={() => {
              const blob = new Blob([keys.privateKey], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = 'ehr-private-key.pem'; a.click();
              URL.revokeObjectURL(url);
            }}>
              ⬇ Download Private Key
            </button>
          </>
        )}
      </div>
    </>
  );
}
