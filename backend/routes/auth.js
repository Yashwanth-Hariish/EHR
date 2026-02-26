const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { generateToken, authenticate, requireRole } = require('../middleware/auth');
const { invokeTransaction, queryChaincode } = require('../services/fabricService');
const axios = require('axios');

const CRYPTO_SERVICE_URL = process.env.CRYPTO_SERVICE_URL || 'http://localhost:5001';

// In-memory user store (replace with DB in production)
const users = new Map();

/**
 * POST /api/auth/register
 * Admin registers a new user
 */
router.post('/register', authenticate, requireRole('ADMIN'), async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['ADMIN', 'DOCTOR', 'PATIENT'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    if (users.has(email)) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Generate RSA keypair for the new user (gracefully degrade if crypto service is offline)
    let public_key = null;
    let private_key = null;
    try {
      const keyResponse = await axios.post(`${CRYPTO_SERVICE_URL}/generate-keys`);
      public_key = keyResponse.data.public_key;
      private_key = keyResponse.data.private_key;
    } catch (cryptoErr) {
      console.warn('Crypto service unavailable, skipping key generation:', cryptoErr.message);
      // Assign placeholder keys — user can update later via dedicated key-gen flow
      public_key = `PLACEHOLDER_PUBLIC_KEY_${uuidv4()}`;
      private_key = null;
    }

    const userId = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = {
      userId,
      name,
      email,
      role,
      publicKey: public_key,
      // Note: private key should be securely delivered to the user
      // In production, use HSM or client-side key generation
      createdAt: new Date().toISOString()
    };

    // Store in the shared in-memory map ─ login reads from this same map
    users.set(email, { ...user, password: hashedPassword });

    // Register on Fabric blockchain
    try {
      await invokeTransaction(
        req.user.userId, // Admin's userId
        'CreateUser',
        userId, name, role, public_key
      );
    } catch (fabricErr) {
      console.warn('Fabric registration warning:', fabricErr.message);
      // Continue - blockchain may not be running in dev mode
    }

    res.status(201).json({
      message: 'User registered successfully',
      user: { userId, name, email, role, publicKey: public_key },
      privateKey: private_key  // In production: deliver via secure channel, not response body
    });

  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    // Dev mode: allow demo accounts with pre-generated keys
    // In production, these would be securely stored in a database
    const demoAccounts = {
      'admin@ehr.local': { 
        userId: 'admin-001', 
        name: 'System Admin', 
        role: 'ADMIN', 
        password: 'admin123',
        // Pre-generated keys for demo users
        publicKey: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Z3VS5JJcds3xfn/ygWyF\neP5xW4wKFKU0EH9mW+7S0/UKhSWXc0t8j8pJ+EDcV4eI8qF5pYvPJqNfq4m8D\nz5Pqh+dN0vJqQ6qV8bR3uX8tJ0vK9mF4wX5yT1zA2vB3uC9kF8eD4pL7mH2nK\nwQKBgQD2aW3vP8eX5qYcJ3vN9tL6wK8xF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4\ngK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8y\nF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5k\nP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4g\nK9wXwIDAQAB\n-----END PUBLIC KEY-----',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDVS5JJcds3xf\nn/ygWyFeP5xW4wKFKU0EH9mW+7S0/UKhSWXc0t8j8pJ+EDcV4eI8qF5pYvPJq\nNfq4m8Dz5Pqh+dN0vJqQ6qV8bR3uX8tJ0vK9mF4wX5yT1zA2vB3uC9kF8eD4p\nL7mH2nKwQKBgQD2aW3vP8eX5qYcJ3vN9tL6wK8xF4pY9zD2mB7nL5kP3wT8e\nR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2n\nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9z\nD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8\nE+Kb0p9K1L8BAgMBAAECggEAVKXY9s7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7\nmK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7\nnL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9\nmD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7\nmK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7\nnL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9\nmD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7\nmK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7\nnL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9\nmD4gK9wXwKBgQD2aW3vP8eX5qYcJ3vN9tL6wK8xF4pY9zD2mB7nL5kP3wT8eR\n6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2n\nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9\nzD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT\n8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9\nwX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wXwKBgQDU7T9m\nD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7\nmK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7\nnL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9\nmD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5t\nL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2\nmB7nL5kP3wT8eR6vJ9mD4gK9wXwKBgQCyG5nP5tL7mK8yF4pY9zD2mB7nL5k\nP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4\ngK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7m\nK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB\n7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6v\nJ9mD4gK9wXwKBgQDJ7vN9tL6wK8xF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9\nwX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4\npY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3\nwT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9\nwX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wXw==\n-----END PRIVATE KEY-----'
      },
      'doctor@ehr.local': { 
        userId: 'doctor-001', 
        name: 'Dr. Sarah Chen', 
        role: 'DOCTOR', 
        password: 'doctor123',
        publicKey: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA3mK8yF4pY9zD2mB7nL\n5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD\n4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8\nyF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5k\nP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK\n9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF\n4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP\n3wT8eR6vJ9mD4gK9wXwIDAQAB\n-----END PUBLIC KEY-----',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDmK8yF4pY9\nzD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8\neR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2\nnP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9\nzD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8\neR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2\nnP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9\nzD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8\nE+Kb0p9K1L8BAgMBAAECggEAZ5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4p\nY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3\nwT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9\nwX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF\n4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5k\nP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4g\nK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8y\nF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wXwKBgQDmK8yF4pY9zD2mB7nL5kP\n3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9\nwX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4\npY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3\nwT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9w\nX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wXwKBgQDM7vN9tL6w\nK8xF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7n\nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9m\nD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7m\nK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7n\nL5kP3wT8eR6vJ9mD4gK9wXwKBgQC8K9wX2nP5tL7mK8yF4pY9zD2mB7nL5k\nP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4\ngK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8\nyF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5\nkP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4g\nK9wXwKBgQDJ7vN9tL6wK8xF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5\ntL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2\nmB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6v\nJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wXw==\n-----END PRIVATE KEY-----'
      },
      'patient@ehr.local': { 
        userId: 'patient-001', 
        name: 'John Doe', 
        role: 'PATIENT', 
        password: 'patient123',
        publicKey: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4pY9zD2mB7nL5kP3w\nT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX\n2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY\n9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT\n8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2\nnP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD\n2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6\nvJ9mD4gK9wXwIDAQAB\n-----END PUBLIC KEY-----',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDP5tL7mK8y\nF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5k\nP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4g\nK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF\n4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3\nwT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9\nwX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4p\nY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3w\nT8E+Kb0p9K1L8BAgMBAAECggEAP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9\nmD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7m\nK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7n\nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9\nmD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7\nmK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7\nnL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9\nmD4gK9wXwKBgQD4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4\npY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3\nwT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9w\nX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4p\nY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3\nwT8eR6vJ9mD4gK9wXwKBgQDmK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9w\nX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4p\nY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3w\nT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9w\nX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wXwKBgQC9mD4gK9w\nX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4p\nY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3\nwT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9\nwX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wXwKBgQDmK8yF4p\nY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3w\nT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9w\nX2nP5tL7mK8yF4pY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wX2nP5tL7mK8yF4p\nY9zD2mB7nL5kP3wT8eR6vJ9mD4gK9wXw==\n-----END PRIVATE KEY-----'
      }
    };

    let userRecord = users.get(email);
    
    if (!userRecord && demoAccounts[email]) {
      const demo = demoAccounts[email];
      if (password === demo.password) {
        const token = generateToken(demo.userId, demo.role, demo.name);
        return res.json({
          token,
          user: { 
            userId: demo.userId, 
            name: demo.name, 
            role: demo.role, 
            email,
            publicKey: demo.publicKey
          },
          privateKey: demo.privateKey
        });
      }
    }

    if (!userRecord) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, userRecord.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(userRecord.userId, userRecord.role, userRecord.name);

    res.json({
      token,
      user: {
        userId: userRecord.userId,
        name: userRecord.name,
        email: userRecord.email,
        role: userRecord.role,
        publicKey: userRecord.publicKey
      }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
module.exports._users = users;  // Attach the live Map so admin.js can read it
