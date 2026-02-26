const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { queryChaincode } = require('../services/fabricService');
const { getNodeInfo } = require('../services/ipfsService');
const authRoute = require('./auth');  // access the shared users Map

/**
 * GET /api/admin/audit-logs
 * Admin only: view system audit logs from blockchain
 */
router.get('/audit-logs', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    
    let logs = [];
    try {
      logs = await queryChaincode(req.user.userId, 'GetAuditLogs', limit) || [];
    } catch (fabricErr) {
      console.warn('Fabric audit log query failed, using mock:', fabricErr.message);
      logs = getMockAuditLogs();
    }

    res.json({ logs, total: logs.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/users
 * Admin only: list all users
 */
router.get('/users', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    // Base demo accounts always present
    const demoUsers = [
      { userId: 'admin-001', name: 'System Admin', email: 'admin@ehr.local', role: 'ADMIN', active: true, createdAt: new Date(Date.now() - 90 * 86400000).toISOString() },
      { userId: 'doctor-001', name: 'Dr. Sarah Chen', email: 'doctor@ehr.local', role: 'DOCTOR', active: true, createdAt: new Date(Date.now() - 60 * 86400000).toISOString() },
      { userId: 'doctor-002', name: 'Dr. James Wilson', email: 'jwilson@ehr.local', role: 'DOCTOR', active: true, createdAt: new Date(Date.now() - 45 * 86400000).toISOString() },
      { userId: 'patient-001', name: 'John Doe', email: 'patient@ehr.local', role: 'PATIENT', active: true, createdAt: new Date(Date.now() - 30 * 86400000).toISOString() },
      { userId: 'patient-002', name: 'Jane Smith', email: 'jsmith@ehr.local', role: 'PATIENT', active: true, createdAt: new Date(Date.now() - 20 * 86400000).toISOString() }
    ];

    // Merge with dynamically registered users from auth module
    const registeredUsers = authRoute._users
      ? [...authRoute._users.values()].map(u => ({
          userId: u.userId,
          name: u.name,
          email: u.email,
          role: u.role,
          active: true,
          createdAt: u.createdAt
        }))
      : [];

    // Combine: demo first, then registered (avoiding demo email duplicates)
    const demoEmails = new Set(demoUsers.map(u => u.email));
    const allUsers = [
      ...demoUsers,
      ...registeredUsers.filter(u => !demoEmails.has(u.email))
    ];

    res.json({ users: allUsers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/system-stats
 * Admin only: system health and statistics
 */
router.get('/system-stats', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    let ipfsInfo = null;
    try {
      ipfsInfo = await getNodeInfo();
    } catch (e) {
      ipfsInfo = { id: 'not-connected', agentVersion: 'N/A' };
    }

    res.json({
      stats: {
        totalUsers: 5,
        totalRecords: 12,
        totalTransactions: 47,
        storageUsed: '2.3 MB',
        blockchainHeight: 24,
        ipfsNode: {
          id: ipfsInfo?.id || 'N/A',
          version: ipfsInfo?.agentVersion || 'N/A',
          connected: !!ipfsInfo
        },
        fabricChannel: {
          name: process.env.FABRIC_CHANNEL || 'healthcare-channel',
          connected: false // Will be true when Fabric is running
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getMockAuditLogs() {
  const actions = ['CREATE_RECORD', 'GET_RECORD', 'GRANT_ACCESS', 'REVOKE_ACCESS', 'CREATE_USER', 'LOGIN'];
  const users = ['admin-001', 'doctor-001', 'patient-001'];
  const resources = ['RECORD_rec-001', 'USER_patient-001', 'RECORD_rec-002'];

  return Array.from({ length: 20 }, (_, i) => ({
    logId: `log-${String(i + 1).padStart(3, '0')}`,
    userId: users[i % users.length],
    action: actions[i % actions.length],
    resource: resources[i % resources.length],
    timestamp: new Date(Date.now() - i * 3600000).toISOString(),
    txId: `tx${Math.random().toString(36).substr(2, 16)}`,
    details: `Operation ${i + 1}`
  }));
}

module.exports = router;
