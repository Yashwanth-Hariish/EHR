const express = require('express');
const router = express.Router();
const axios = require('axios');
const { authenticate } = require('../middleware/auth');

const CRYPTO_SERVICE_URL = process.env.CRYPTO_SERVICE_URL || 'http://localhost:5001';

/**
 * POST /api/crypto/generate-keys
 * Generate RSA keypair for a user
 */
router.post('/generate-keys', authenticate, async (req, res) => {
  try {
    const response = await axios.post(`${CRYPTO_SERVICE_URL}/generate-keys`);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/crypto/sign
 * Sign data with private key
 */
router.post('/sign', authenticate, async (req, res) => {
  try {
    const response = await axios.post(`${CRYPTO_SERVICE_URL}/sign`, req.body);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/crypto/verify
 * Verify a digital signature
 */
router.post('/verify', authenticate, async (req, res) => {
  try {
    const response = await axios.post(`${CRYPTO_SERVICE_URL}/verify`, req.body);
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/crypto/health
 * Check crypto service status
 */
router.get('/health', async (req, res) => {
  try {
    const response = await axios.get(`${CRYPTO_SERVICE_URL}/health`);
    res.json({ status: 'ok', cryptoService: response.data });
  } catch (err) {
    res.status(503).json({ status: 'unavailable', error: err.message });
  }
});

module.exports = router;
