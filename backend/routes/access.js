const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { authenticate, requireRole } = require('../middleware/auth');
const { invokeTransaction, queryChaincode } = require('../services/fabricService');

const CRYPTO_SERVICE_URL = process.env.CRYPTO_SERVICE_URL || 'http://localhost:5001';

/**
 * POST /api/access/grant
 * Patient grants a doctor access to a specific record
 * 
 * Flow:
 * 1. Patient provides their private key + doctor's public key
 * 2. Generate PRE re-encryption key rk_{Patient -> Doctor}
 * 3. Store grant + re-encryption key on Fabric
 */
router.post('/grant', authenticate, requireRole('PATIENT'), async (req, res) => {
  try {
    const { recordId, doctorId, patientPrivateKey, doctorPublicKey } = req.body;
    const patientId = req.user.userId;

    if (!recordId || !doctorId || !patientPrivateKey || !doctorPublicKey) {
      return res.status(400).json({
        error: 'Missing required fields: recordId, doctorId, patientPrivateKey, doctorPublicKey'
      });
    }

    // Generate PRE re-encryption key
    console.log(`[GRANT] Generating re-encryption key for doctor ${doctorId}...`);
    const preResponse = await axios.post(`${CRYPTO_SERVICE_URL}/pre/keygen`, {
      patient_private_key: patientPrivateKey,
      doctor_public_key: doctorPublicKey
    });
    const { re_encryption_key } = preResponse.data;

    const grantId = uuidv4();

    // Store on Fabric
    try {
      await invokeTransaction(
        patientId,
        'GrantAccess',
        grantId,
        recordId,
        doctorId,
        re_encryption_key
      );
    } catch (fabricErr) {
      console.warn('Fabric grant warning (dev mode):', fabricErr.message);
    }

    res.json({
      message: `Access granted to doctor ${doctorId} for record ${recordId}`,
      grant: { grantId, recordId, doctorId, patientId, grantedAt: new Date().toISOString() }
    });

  } catch (err) {
    console.error('Grant access error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/access/revoke
 * Patient revokes a doctor's access to a specific record
 */
router.post('/revoke', authenticate, requireRole('PATIENT'), async (req, res) => {
  try {
    const { recordId, doctorId } = req.body;
    const patientId = req.user.userId;

    if (!recordId || !doctorId) {
      return res.status(400).json({ error: 'Missing recordId or doctorId' });
    }

    try {
      await invokeTransaction(patientId, 'RevokeAccess', recordId, doctorId);
    } catch (fabricErr) {
      console.warn('Fabric revoke warning (dev mode):', fabricErr.message);
    }

    res.json({
      message: `Access revoked from doctor ${doctorId} for record ${recordId}`,
      revokedAt: new Date().toISOString()
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/access/record/:recordId
 * Patient views all active grants for a record
 */
router.get('/record/:recordId', authenticate, requireRole('PATIENT'), async (req, res) => {
  try {
    const { recordId } = req.params;
    const patientId = req.user.userId;

    let grants = [];
    try {
      grants = await queryChaincode(patientId, 'GetMyAccessGrants', recordId) || [];
    } catch (fabricErr) {
      console.warn('Fabric grants query warning (dev mode):', fabricErr.message);
      grants = getMockGrants(recordId);
    }

    res.json({ grants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/access/reencrypt
 * Proxy endpoint: re-encrypt an AES key for an authorized doctor
 * This is the "proxy" step in Proxy Re-Encryption
 */
router.post('/reencrypt', authenticate, async (req, res) => {
  try {
    const { recordId, encryptedAesKey, patientPrivateKey } = req.body;
    const doctorId = req.user.userId;

    if (req.user.role !== 'DOCTOR') {
      return res.status(403).json({ error: 'Only doctors can request re-encryption' });
    }

    // Verify access grant exists on chain
    let reEncryptionKey;
    try {
      const grant = await queryChaincode(doctorId, 'GetAccessGrant', recordId, doctorId);
      if (!grant?.active) {
        return res.status(403).json({ error: 'No active access grant found' });
      }
      reEncryptionKey = grant.reEncryptionKey;
    } catch (fabricErr) {
      console.warn('Fabric check failed (dev mode):', fabricErr.message);
      reEncryptionKey = null;
    }

    if (!reEncryptionKey && !patientPrivateKey) {
      return res.status(400).json({ error: 'Re-encryption key or patient private key required' });
    }

    // Perform proxy re-encryption
    const preResponse = await axios.post(`${CRYPTO_SERVICE_URL}/pre/reencrypt`, {
      encrypted_aes_key: encryptedAesKey,
      re_encryption_key: reEncryptionKey,
      patient_private_key: patientPrivateKey // Only in simplified scheme
    });

    res.json({
      re_encrypted_key: preResponse.data.re_encrypted_key,
      recordId,
      doctorId
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getMockGrants(recordId) {
  return [
    {
      grantId: 'grant-001',
      recordId,
      doctorId: 'doctor-001',
      doctorName: 'Dr. Sarah Chen',
      grantedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      active: true
    }
  ];
}

module.exports = router;
