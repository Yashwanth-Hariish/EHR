import React, { useState, useEffect } from "react";
import Sidebar from "../Common/Sidebar";
import { adminAPI, authAPI } from "../../services/api";
import { formatDistanceToNow } from "date-fns";

const NAV_ITEMS = [
  { id: "overview", label: "System Overview", icon: "◈" },
  { id: "users", label: "User Management", icon: "⊞" },
  { id: "audit", label: "Audit Logs", icon: "📋" },
  { id: "network", label: "Network Status", icon: "⚡" },
];

const ACTION_COLORS = {
  CREATE_RECORD: "cyan",
  GET_RECORD: "text-secondary",
  GRANT_ACCESS: "green",
  REVOKE_ACCESS: "amber",
  CREATE_USER: "purple",
  DEACTIVATE_USER: "red",
  UNAUTHORIZED_ACCESS: "red",
  VERIFY_INTEGRITY: "cyan",
};

export default function AdminDashboard() {
  const [active, setActive] = useState("overview");
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, [active]);

  const loadData = async () => {
    setLoading(true);
    try {
      if (active === "overview" || active === "network") {
        const res = await adminAPI.getSystemStats();
        setStats(res.data.stats);
      }
      if (active === "users") {
        const res = await adminAPI.getUsers();
        setUsers(res.data.users);
      }
      if (active === "audit") {
        const res = await adminAPI.getAuditLogs(50);
        setAuditLogs(res.data.logs);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <Sidebar
        navItems={NAV_ITEMS}
        activeItem={active}
        onNavigate={setActive}
      />
      <main className="main-content">
        {loading && (
          <div className="loading-overlay">
            <div className="spinner" />
            <p>Loading...</p>
          </div>
        )}

        {!loading && active === "overview" && stats && (
          <OverviewPanel stats={stats} />
        )}
        {!loading && active === "users" && (
          <UsersPanel users={users} onRefresh={loadData} />
        )}
        {!loading && active === "audit" && <AuditPanel logs={auditLogs} />}
        {!loading && active === "network" && stats && (
          <NetworkPanel stats={stats} />
        )}
      </main>
    </div>
  );
}

function OverviewPanel({ stats }) {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">// System Overview</h1>
        <p className="page-subtitle">
          Administrative dashboard — medical record access restricted
        </p>
      </div>

      <div className="ehr-alert info" style={{ marginBottom: 24 }}>
        <span>🔒</span>
        As an administrator, you can manage users and view audit logs but cannot
        access or view any medical records.
      </div>

      <div className="stat-grid">
        <div className="stat-tile cyan">
          <div className="stat-icon">👥</div>
          <div className="stat-value">{stats.totalUsers}</div>
          <div className="stat-label">Total Users</div>
        </div>
        <div className="stat-tile green">
          <div className="stat-icon">📄</div>
          <div className="stat-value">{stats.totalRecords}</div>
          <div className="stat-label">Records on Chain</div>
        </div>
        <div className="stat-tile amber">
          <div className="stat-icon">⛓</div>
          <div className="stat-value">{stats.totalTransactions}</div>
          <div className="stat-label">Transactions</div>
        </div>
        <div className="stat-tile red">
          <div className="stat-icon">🌐</div>
          <div className="stat-value">{stats.blockchainHeight}</div>
          <div className="stat-label">Block Height</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="ehr-card">
          <div className="card-title">Fabric Network</div>
          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <InfoRow
              label="Channel"
              value={stats.fabricChannel?.name || "N/A"}
            />
            <InfoRow
              label="Status"
              value={
                <span
                  className={`chain-indicator ${stats.fabricChannel?.connected ? "online" : "offline"}`}
                >
                  <span className="dot" />
                  {stats.fabricChannel?.connected ? "ONLINE" : "DEV MODE"}
                </span>
              }
            />
            <InfoRow label="MSP" value="Org1MSP" mono />
            <InfoRow label="Chaincode" value="ehr-contract v1.0" mono />
          </div>
        </div>

        <div className="ehr-card">
          <div className="card-title">IPFS Node</div>
          <div
            style={{
              marginTop: 16,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <InfoRow
              label="Node ID"
              value={stats.ipfsNode?.id?.slice(0, 16) + "..." || "N/A"}
              mono
            />
            <InfoRow
              label="Status"
              value={
                <span
                  className={`chain-indicator ${stats.ipfsNode?.connected ? "online" : "offline"}`}
                >
                  <span className="dot" />
                  {stats.ipfsNode?.connected ? "ONLINE" : "NOT CONNECTED"}
                </span>
              }
            />
            <InfoRow label="Storage" value={stats.storageUsed || "0 B"} />
            <InfoRow label="Version" value={stats.ipfsNode?.version || "N/A"} />
          </div>
        </div>
      </div>
    </>
  );
}

function UsersPanel({ users, onRefresh }) {
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "PATIENT",
  });
  const [result, setResult] = useState(null);
  const [newUserPrivateKey, setNewUserPrivateKey] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const handleRegister = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    setNewUserPrivateKey(null);
    try {
      const res = await authAPI.register(form);
      const { user, privateKey } = res.data;
      setResult({
        success: true,
        message: `✅ User "${user.name}" (${user.role}) registered successfully! Share the private key below with them securely.`,
      });
      if (privateKey) setNewUserPrivateKey(privateKey);
      setForm({ name: "", email: "", password: "", role: "PATIENT" });
      onRefresh();
    } catch (err) {
      const msg = err.response?.data?.error || err.message;
      setResult({ success: false, message: `❌ Registration failed: ${msg}` });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCloseModal = () => {
    setShowRegister(false);
    setResult(null);
    setNewUserPrivateKey(null);
    setForm({ name: "", email: "", password: "", role: "PATIENT" });
  };

  return (
    <>
      <div
        className="page-header"
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 className="page-title">// User Management</h1>
          <p className="page-subtitle">
            Manage system users and role assignments
          </p>
        </div>
        <button
          className="btn-ehr btn-primary-ehr"
          onClick={() => setShowRegister(true)}
        >
          + Register User
        </button>
      </div>

      <div className="ehr-card">
        <div className="ehr-card-header">
          <div className="card-title">Registered Users</div>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {users.length} total
          </span>
        </div>
        <div className="ehr-table-wrapper">
          <table className="ehr-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.userId}>
                  <td>{u.name}</td>
                  <td
                    style={{
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                    }}
                  >
                    {u.email}
                  </td>
                  <td>
                    <span className={`badge-role ${u.role}`}>{u.role}</span>
                  </td>
                  <td>
                    <span
                      className={`badge-status ${u.active ? "active" : "revoked"}`}
                    >
                      {u.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {formatDistanceToNow(new Date(u.createdAt), {
                      addSuffix: true,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showRegister && (
        <div className="ehr-modal-backdrop">
          <div className="ehr-modal" style={{ maxWidth: 520 }}>
            <div className="ehr-modal-header">
              <div className="ehr-modal-title">Register New User</div>
              <button className="ehr-modal-close" onClick={handleCloseModal}>
                ×
              </button>
            </div>

            {result && (
              <div
                className={`ehr-alert ${result.success ? "success" : "error"}`}
                style={{ marginBottom: 16 }}
              >
                {result.message}
              </div>
            )}

            {newUserPrivateKey && (
              <div className="ehr-alert info" style={{ marginBottom: 16 }}>
                <div
                  style={{
                    marginBottom: 8,
                    fontWeight: 700,
                    color: "var(--accent-amber)",
                  }}
                >
                  ⚠️ Copy this Private Key NOW — it won't be shown again!
                </div>
                <textarea
                  readOnly
                  value={newUserPrivateKey}
                  style={{
                    width: "100%",
                    height: 120,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    background: "rgba(0,0,0,0.3)",
                    color: "var(--accent-cyan)",
                    border: "1px solid rgba(0,255,200,0.2)",
                    borderRadius: 6,
                    padding: 8,
                    resize: "none",
                  }}
                />
                <button
                  className="btn-ehr btn-ghost-ehr"
                  style={{ marginTop: 8, fontSize: 12 }}
                  onClick={() => {
                    navigator.clipboard.writeText(newUserPrivateKey);
                  }}
                >
                  📋 Copy to Clipboard
                </button>
              </div>
            )}

            {!result?.success && (
              <form onSubmit={handleRegister}>
                <div className="ehr-form-group">
                  <label className="ehr-label">Full Name</label>
                  <input
                    className="ehr-input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>
                <div className="ehr-form-group">
                  <label className="ehr-label">Email</label>
                  <input
                    type="email"
                    className="ehr-input"
                    value={form.email}
                    onChange={(e) =>
                      setForm({ ...form, email: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="ehr-form-group">
                  <label className="ehr-label">Password</label>
                  <input
                    type="password"
                    className="ehr-input"
                    value={form.password}
                    onChange={(e) =>
                      setForm({ ...form, password: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="ehr-form-group">
                  <label className="ehr-label">Role</label>
                  <select
                    className="ehr-select"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                  >
                    <option value="DOCTOR">Doctor</option>
                    <option value="PATIENT">Patient</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    justifyContent: "flex-end",
                  }}
                >
                  <button
                    type="button"
                    className="btn-ehr btn-ghost-ehr"
                    onClick={handleCloseModal}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-ehr btn-primary-ehr"
                    disabled={submitting}
                  >
                    {submitting ? "Registering..." : "Register User"}
                  </button>
                </div>
              </form>
            )}

            {result?.success && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: 16,
                }}
              >
                <button
                  className="btn-ehr btn-primary-ehr"
                  onClick={handleCloseModal}
                >
                  Done
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function AuditPanel({ logs }) {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">// Audit Logs</h1>
        <p className="page-subtitle">
          Immutable blockchain transaction history
        </p>
      </div>

      <div className="ehr-card">
        <div className="ehr-card-header">
          <div className="card-title">Transaction Log</div>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Showing {logs.length} entries
          </span>
        </div>
        <div className="ehr-table-wrapper">
          <table className="ehr-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Resource</th>
                <th>TX ID</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.logId}>
                  <td
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {new Date(log.timestamp).toLocaleString()}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {log.userId?.slice(0, 12)}...
                  </td>
                  <td>
                    <span
                      style={{
                        color:
                          log.action === "UNAUTHORIZED_ACCESS"
                            ? "var(--accent-red)"
                            : log.action.includes("CREATE")
                              ? "var(--accent-cyan)"
                              : log.action.includes("GRANT")
                                ? "var(--accent-green)"
                                : "var(--text-secondary)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {log.action}
                    </span>
                  </td>
                  <td
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--text-muted)",
                    }}
                  >
                    {log.resource}
                  </td>
                  <td>
                    <span className="cid-chip">
                      {log.txId?.slice(0, 16)}...
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function NetworkPanel({ stats }) {
  return (
    <>
      <div className="page-header">
        <h1 className="page-title">// Network Status</h1>
        <p className="page-subtitle">Infrastructure health monitoring</p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 20,
          maxWidth: 600,
        }}
      >
        {[
          {
            label: "Hyperledger Fabric",
            icon: "⛓",
            connected: stats.fabricChannel?.connected,
            details: [
              { k: "Channel", v: stats.fabricChannel?.name },
              { k: "Chaincode", v: "ehr-contract v1.0" },
              { k: "Endorsement Policy", v: "AND(Org1MSP.peer)" },
              { k: "Block Height", v: stats.blockchainHeight },
            ],
          },
          {
            label: "IPFS Node",
            icon: "🌐",
            connected: stats.ipfsNode?.connected,
            details: [
              { k: "Node ID", v: stats.ipfsNode?.id?.slice(0, 20) + "..." },
              { k: "Agent", v: stats.ipfsNode?.version },
              { k: "Stored Data", v: stats.storageUsed },
            ],
          },
          {
            label: "Crypto Service (Python)",
            icon: "🔐",
            connected: true,
            details: [
              { k: "Algorithm", v: "AES-256-GCM" },
              { k: "Key Exchange", v: "RSA-2048 OAEP" },
              { k: "PRE Scheme", v: "Simplified BBS98" },
              { k: "Signatures", v: "PKCS1-v1.5 + SHA-256" },
            ],
          },
        ].map((svc) => (
          <div className="ehr-card" key={svc.label}>
            <div className="ehr-card-header">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{svc.icon}</span>
                <span className="card-title">{svc.label}</span>
              </div>
              <span
                className={`chain-indicator ${svc.connected ? "online" : "offline"}`}
              >
                <span className="dot" />
                {svc.connected ? "ONLINE" : "OFFLINE"}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {svc.details.map((d) => (
                <InfoRow key={d.k} label={d.k} value={d.v} mono />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function InfoRow({ label, value, mono }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "8px 0",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <span
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          fontFamily: mono ? "var(--font-mono)" : "inherit",
        }}
      >
        {value}
      </span>
    </div>
  );
}
