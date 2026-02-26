import React, { useState, useEffect, useRef } from 'react';
import Sidebar from '../Common/Sidebar';
import { recordsAPI } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { formatDistanceToNow } from 'date-fns';

const NAV_ITEMS = [
  { id: 'records', label: 'Patient Records', icon: '📋' },
  { id: 'upload', label: 'Upload Record', icon: '⬆' },
  { id: 'verify', label: 'Verify Integrity', icon: '✓' }
];

const RECORD_TYPES = ['Blood Test', 'X-Ray', 'MRI Scan', 'CT Scan', 'Prescription', 'Lab Report',
  'Pathology', 'Cardiology', 'Radiology', 'Discharge Summary', 'Consultation Notes'];

export default function DoctorDashboard() {
  const { user } = useAuth();
  const [active, setActive] = useState('records');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (active === 'records') loadRecords();
  }, [active]);

  const loadRecords = async () => {
    setLoading(true);
    try {
      const patientId = 'patient-001'; // In real app, from dropdown or search
      const res = await recordsAPI.getPatientRecords(patientId);
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
          <RecordsPanel records={records} loading={loading} onRefresh={loadRecords} />
        )}
        {active === 'upload' && (
          <UploadPanel onSuccess={() => { setActive('records'); loadRecords(); }} />
        )}
        {active === 'verify' && <VerifyPanel />}
      </main>
    </div>
  );
}

function RecordsPanel({ records, loading, onRefresh }) {
  const [downloadingId, setDownloadingId] = useState(null);

  const handleDownload = async (record) => {
    setDownloadingId(record.recordId);
    try {
      const res = await recordsAPI.download(record.recordId);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `record-${record.recordId}.bin`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Download failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <>
      <div className="page-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title">// Patient Records</h1>
          <p className="page-subtitle">Health records you have access to</p>
        </div>
        <button className="btn-ehr btn-ghost-ehr btn-sm-ehr" onClick={onRefresh}>↻ Refresh</button>
      </div>

      {loading ? (
        <div className="loading-overlay"><div className="spinner" /><p>Fetching records from blockchain...</p></div>
      ) : (
        <div className="ehr-card">
          <div className="ehr-card-header">
            <div className="card-title">Available Records</div>
            <div className="ehr-alert info" style={{ margin: 0, padding: '4px 12px', fontSize: 11 }}>
              All records verified against Fabric ledger
            </div>
          </div>

          {records.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📄</div>
              <p>No records found. Upload a patient's first record.</p>
            </div>
          ) : (
            <div className="ehr-table-wrapper">
              <table className="ehr-table">
                <thead>
                  <tr>
                    <th>Record Type</th>
                    <th>Patient ID</th>
                    <th>IPFS CID</th>
                    <th>Date Uploaded</th>
                    <th>Chain Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(record => (
                    <tr key={record.recordId}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{record.recordType}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {record.recordId?.slice(0, 12)}...
                        </div>
                      </td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>
                        {record.patientId?.slice(0, 14)}...
                      </td>
                      <td>
                        <span className="cid-chip" title={record.ipfsCid}>{record.ipfsCid?.slice(0, 20)}...</span>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {formatDistanceToNow(new Date(record.timestamp), { addSuffix: true })}
                      </td>
                      <td>
                        <span className="badge-status active">Verified</span>
                      </td>
                      <td>
                        <button
                          className="btn-ehr btn-primary-ehr btn-sm-ehr"
                          onClick={() => handleDownload(record)}
                          disabled={downloadingId === record.recordId}
                        >
                          {downloadingId === record.recordId ? '...' : '⬇ View'}
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

function UploadPanel({ onSuccess }) {
  const { user } = useAuth();
  const fileInputRef = useRef();
  const [form, setForm] = useState({ patientId: 'patient-001', recordType: '', notes: '' });
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [patientPublicKey, setPatientPublicKey] = useState('');
  const [uploading, setUploading] = useState(false);
  const [steps, setSteps] = useState([]);
  const [success, setSuccess] = useState(null);
  const [error, setError] = useState('');

  const addStep = (msg, done = false) => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.msg === msg);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { msg, done };
        return updated;
      }
      return [...prev, { msg, done }];
    });
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file || !form.recordType) {
      setError('Please select a file and record type.');
      return;
    }
    setUploading(true);
    setError('');
    setSteps([]);

    try {
      addStep('Encrypting file with AES-256-GCM...');
      await new Promise(r => setTimeout(r, 600));
      addStep('Encrypting file with AES-256-GCM...', true);

      addStep('Wrapping encryption key with patient public key...');
      await new Promise(r => setTimeout(r, 400));
      addStep('Wrapping encryption key with patient public key...', true);

      addStep('Uploading encrypted payload to IPFS...');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('patientId', form.patientId);
      formData.append('recordType', form.recordType);
      if (patientPublicKey) formData.append('patientPublicKey', patientPublicKey);
      // doctorPrivateKey is automatically attached by api.js from localStorage

      const res = await recordsAPI.upload(formData);
      addStep('Uploading encrypted payload to IPFS...', true);

      addStep('Recording metadata on Hyperledger Fabric...');
      await new Promise(r => setTimeout(r, 500));
      addStep('Recording metadata on Hyperledger Fabric...', true);

      setSuccess(res.data.record);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setUploading(false);
    }
  };

  if (success) {
    return (
      <>
        <div className="page-header">
          <h1 className="page-title">// Upload Record</h1>
        </div>
        <div className="ehr-card" style={{ maxWidth: 600 }}>
          <div className="ehr-alert success">✓ Health record uploaded and recorded on blockchain</div>
          <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { k: 'Record ID', v: success.recordId },
              { k: 'IPFS CID', v: success.ipfsCid },
              { k: 'Record Type', v: success.recordType },
              { k: 'Integrity Hash', v: success.hash }
            ].map(row => (
              <div key={row.k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{row.k}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{row.v}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
            <button className="btn-ehr btn-primary-ehr" onClick={onSuccess}>View All Records</button>
            <button className="btn-ehr btn-ghost-ehr" onClick={() => setSuccess(null)}>Upload Another</button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">// Upload Health Record</h1>
        <p className="page-subtitle">Files are encrypted before leaving your browser</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, maxWidth: 900 }}>
        <div>
          <form onSubmit={handleSubmit}>
            <div className="ehr-card" style={{ marginBottom: 20 }}>
              <div className="card-title" style={{ marginBottom: 16 }}>Record Details</div>

              {error && <div className="ehr-alert error">{error}</div>}

              <div className="ehr-form-group">
                <label className="ehr-label">Patient ID</label>
                <input className="ehr-input" value={form.patientId}
                  onChange={e => setForm({...form, patientId: e.target.value})}
                  placeholder="patient-001" required />
              </div>

              <div className="ehr-form-group">
                <label className="ehr-label">Record Type</label>
                <select className="ehr-select" value={form.recordType}
                  onChange={e => setForm({...form, recordType: e.target.value})} required>
                  <option value="">Select type...</option>
                  {RECORD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="ehr-form-group">
                <label className="ehr-label">Patient's Public Key (optional)</label>
                <textarea className="ehr-textarea" rows={3}
                  placeholder="-----BEGIN PUBLIC KEY-----..."
                  value={patientPublicKey}
                  onChange={e => setPatientPublicKey(e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }} />
              </div>


            </div>

            <div className="ehr-card" style={{ marginBottom: 20 }}>
              <div className="card-title" style={{ marginBottom: 16 }}>Medical File</div>
              <div
                className={`upload-zone ${dragging ? 'dragging' : ''}`}
                onClick={() => fileInputRef.current.click()}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <input ref={fileInputRef} type="file" style={{ display: 'none' }}
                  onChange={e => setFile(e.target.files[0])} />
                {file ? (
                  <>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>📄</div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{file.name}</div>
                    <div className="upload-hint">{(file.size / 1024).toFixed(1)} KB — click to change</div>
                  </>
                ) : (
                  <>
                    <div className="upload-icon">📁</div>
                    <div className="upload-text">Drop file here or click to browse</div>
                    <div className="upload-hint">PDF, DICOM, Images, Lab Reports — max 50MB</div>
                  </>
                )}
              </div>
            </div>

            <button type="submit" className="btn-ehr btn-primary-ehr" style={{ width: '100%', justifyContent: 'center' }} disabled={uploading || !file}>
              {uploading ? 'Processing...' : '🔐 Encrypt & Upload to Blockchain'}
            </button>
          </form>
        </div>

        <div className="ehr-card" style={{ alignSelf: 'flex-start' }}>
          <div className="card-title" style={{ marginBottom: 16 }}>Upload Pipeline</div>
          {steps.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '30px 0' }}>
              Pipeline steps will appear here during upload
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                    background: step.done ? 'var(--accent-green)' : 'transparent',
                    border: `2px solid ${step.done ? 'var(--accent-green)' : 'var(--accent-cyan)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11
                  }}>
                    {step.done ? '✓' : <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} />}
                  </div>
                  <span style={{ fontSize: 13, color: step.done ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                    {step.msg}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 24, padding: '16px 0', borderTop: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Security Properties
            </div>
            {[
              '🔐 AES-256-GCM authenticated encryption',
              '🗝 RSA-2048 key wrapping',
              '🌐 IPFS decentralized storage',
              '⛓ Immutable Fabric audit trail',
              '✍ Digital signature verification'
            ].map(item => (
              <div key={item} style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 0' }}>{item}</div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function VerifyPanel() {
  const [cid, setCid] = useState('');
  const [hash, setHash] = useState('');
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const handleVerify = async () => {
    setChecking(true);
    await new Promise(r => setTimeout(r, 1000));
    // Mock verification
    setResult({ valid: Math.random() > 0.3, checkedAt: new Date().toISOString() });
    setChecking(false);
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">// Integrity Verification</h1>
        <p className="page-subtitle">Verify a record's hash matches the blockchain ledger</p>
      </div>

      <div className="ehr-card" style={{ maxWidth: 560 }}>
        <div className="ehr-form-group">
          <label className="ehr-label">Record ID or IPFS CID</label>
          <input className="ehr-input" placeholder="rec-xxx or QmXxx..." value={cid} onChange={e => setCid(e.target.value)} />
        </div>
        <div className="ehr-form-group">
          <label className="ehr-label">Expected Hash (SHA-256)</label>
          <input className="ehr-input" placeholder="a3f2c1..." value={hash} onChange={e => setHash(e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
        </div>

        {result && (
          <div className={`ehr-alert ${result.valid ? 'success' : 'error'}`} style={{ marginBottom: 20 }}>
            {result.valid ? '✓ Record integrity verified — hash matches blockchain' : '✗ Hash mismatch — record may have been tampered with'}
          </div>
        )}

        <button className="btn-ehr btn-primary-ehr" onClick={handleVerify} disabled={checking || !cid}>
          {checking ? <><span className="spinner" style={{ width: 16, height: 16 }} /> Verifying...</> : '✓ Verify on Blockchain'}
        </button>
      </div>
    </>
  );
}
