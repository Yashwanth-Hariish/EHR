import React from 'react';
import { useAuth } from '../../contexts/AuthContext';

export default function Sidebar({ navItems, activeItem, onNavigate }) {
  const { user, logout } = useAuth();

  const initials = user?.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '??';

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-icon">🏥</div>
        <div className="brand-name">SecureEHR</div>
        <div className="brand-sub">Blockchain Health Records</div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Navigation</div>
        {navItems.map(item => (
          <button
            key={item.id}
            className={`sidebar-link ${activeItem === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="user-badge" style={{ marginBottom: 8 }}>
          <div className="user-avatar">{initials}</div>
          <div className="user-info">
            <div className="user-name">{user?.name || 'User'}</div>
            <div className="user-role">
              <span className={`badge-role ${user?.role}`}>{user?.role}</span>
            </div>
          </div>
        </div>
        <button
          className="btn-ehr btn-ghost-ehr btn-sm-ehr"
          style={{ width: '100%', justifyContent: 'center' }}
          onClick={logout}
        >
          ⎋ Sign Out
        </button>
      </div>
    </aside>
  );
}
