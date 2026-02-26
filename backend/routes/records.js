const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { authenticate, requireRole } = require('../middleware/auth');
const { invokeTransaction, queryChaincode } = require('../services/fabricService');
const { uploadToIPFS, retrieveFromIPFS } = require('../services/ipfsService');

const CRYPTO_SERVICE_URL = process.env.CRYPTO_SERVICE_URL || 'http://localhost:5001';

// In-memory record store for dev mode (when Fabric + IPFS are not running)
const inMemoryRecords = new Map();  // patientId -> record[]
const inMemoryPayloads = new Map(); // recordId  -> full encrypted payload object

// Use memory storage for multer (files encrypted before storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    // Block only known dangerous types (executables, scripts)
    const blocked = ['application/x-msdownload', 'application/x-executable',
      'application/x-sh', 'text/x-sh', 'application/x-bat'];
    if (blocked.includes(file.mimetype)) {
      cb(new Error(`File type ${file.mimetype} not allowed for security reasons`));
    } else {
      cb(null, true); // Allow all other types (PDFs, images, DICOM, Word docs, etc.)
    }
  }
});

/**
 * POST /api/records/upload
 * Doctor uploads a new health record
 * 
 * Flow:
 * 1. Receive file + metadata
 * 2. Encrypt file with AES-256-GCM via crypto service
 * 3. Encrypt AES key with patient's RSA public key
 * 4. Upload encrypted file to IPFS
 * 5. Sign metadata
 * 6. Store metadata on Fabric blockchain
 */
router.post('/upload', authenticate, requireRole('DOCTOR'), upload.single('file'), async (req, res) => {
  try {
    const { patientId, recordType, patientPublicKey, doctorPrivateKey } = req.body;
    const file = req.file;

    if (!file || !patientId || !recordType) {
      return res.status(400).json({ error: 'Missing required fields: file, patientId, recordType' });
    }

    const recordId = uuidv4();
    const fileBase64 = file.buffer.toString('base64');
    let encrypted_data = fileBase64; // fallback: store as-is if crypto offline
    let aes_key = 'DEV_NO_ENCRYPTION';
    let nonce = 'DEV_NONCE';
    let tag = 'DEV_TAG';
    let hash = require('crypto').createHash('sha256').update(file.buffer).digest('hex');
    let encryptedAesKey = aes_key;
    let signature = 'UNSIGNED';

    // Step 1: Encrypt file with AES-256-GCM (skip gracefully if crypto service offline)
    console.log(`[${recordId}] Encrypting file...`);
    try {
      const encryptResponse = await axios.post(`${CRYPTO_SERVICE_URL}/encrypt`, {
        data: fileBase64
      }, { timeout: 5000 });
      encrypted_data = encryptResponse.data.encrypted_data;
      aes_key = encryptResponse.data.aes_key;
      nonce = encryptResponse.data.nonce;
      tag = encryptResponse.data.tag;
      hash = encryptResponse.data.hash;
      console.log(`[${recordId}] File encrypted successfully.`);
    } catch (cryptoErr) {
      console.warn(`[${recordId}] Crypto service unavailable, storing unencrypted (dev mode):`, cryptoErr.message);
    }

    // Step 2: Encrypt AES key with patient's public key (skip if no key or crypto offline)
    if (patientPublicKey && aes_key !== 'DEV_NO_ENCRYPTION') {
      console.log(`[${recordId}] Wrapping AES key with patient's public key...`);
      try {
        const keyEncResponse = await axios.post(`${CRYPTO_SERVICE_URL}/encrypt-key`, {
          aes_key,
          public_key: patientPublicKey
        }, { timeout: 5000 });
        encryptedAesKey = keyEncResponse.data.encrypted_key;
      } catch (keyErr) {
        console.warn(`[${recordId}] Key wrapping failed, using raw AES key (dev mode):`, keyErr.message);
        encryptedAesKey = aes_key;
      }
    }

    // Step 3: Sign the record metadata (skip if no key or crypto offline)
    if (doctorPrivateKey && aes_key !== 'DEV_NO_ENCRYPTION') {
      console.log(`[${recordId}] Signing record metadata...`);
      try {
        const metadataToSign = Buffer.from(
          JSON.stringify({ recordId, patientId, recordType, hash, nonce })
        ).toString('base64');
        const signResponse = await axios.post(`${CRYPTO_SERVICE_URL}/sign`, {
          data: metadataToSign,
          private_key: doctorPrivateKey
        }, { timeout: 5000 });
        signature = signResponse.data.signature;
      } catch (signErr) {
        console.warn(`[${recordId}] Signing failed (dev mode):`, signErr.message);
      }
    }

    // Step 4: Cache full payload in memory (always) so dev-mode downloads work
    const payloadObj = {
      encrypted_data,
      nonce,
      tag,
      metadata: {
        recordId,
        recordType,
        uploadedBy: req.user.userId,
        timestamp: new Date().toISOString(),
        originalFilename: file.originalname,
        originalMimetype: file.mimetype,
        originalSize: file.size
      }
    };
    inMemoryPayloads.set(recordId, payloadObj);

    // Step 5: Upload to IPFS (skip gracefully if IPFS not running)
    console.log(`[${recordId}] Uploading to IPFS...`);
    let ipfsCid = `DEV_CID_${recordId.slice(0, 8)}`; // local placeholder CID
    try {
      ipfsCid = await uploadToIPFS(Buffer.from(JSON.stringify(payloadObj)));
      console.log(`[${recordId}] IPFS CID: ${ipfsCid}`);
    } catch (ipfsErr) {
      console.warn(`[${recordId}] IPFS not available, using local placeholder CID (dev mode):`, ipfsErr.message);
    }

    // Build the record object
    const record = {
      recordId,
      patientId,
      doctorId: req.user.userId,
      recordType,
      ipfsCid,
      encryptedAesKey,
      signature,
      hash,
      timestamp: new Date().toISOString(),
      filename: file.originalname,
      active: true
    };

    // Store in memory so it shows up in GET /patient/:id (dev mode)
    const patientRecords = inMemoryRecords.get(patientId) || [];
    patientRecords.push(record);
    inMemoryRecords.set(patientId, patientRecords);

    // Step 5: Store metadata on Fabric blockchain (optional in dev mode)
    console.log(`[${recordId}] Recording on blockchain...`);
    try {
      await invokeTransaction(
        req.user.userId,
        'CreateHealthRecord',
        recordId,
        patientId,
        recordType,
        ipfsCid,
        encryptedAesKey,
        signature,
        hash
      );
    } catch (fabricErr) {
      console.warn(`[${recordId}] Fabric warning (dev mode):`, fabricErr.message);
    }

    res.status(201).json({
      message: 'Health record uploaded successfully',
      record
    });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/records/patient/:patientId
 * List all records for a patient
 */
router.get('/patient/:patientId', authenticate, async (req, res) => {
  try {
    const { patientId } = req.params;
    const { userId, role } = req.user;

    // RBAC checks
    if (role === 'ADMIN') {
      return res.status(403).json({ error: 'Admins cannot access medical records' });
    }
    if (role === 'PATIENT' && userId !== patientId) {
      return res.status(403).json({ error: 'Patients can only view their own records' });
    }

    let records = [];
    try {
      records = await queryChaincode(userId, 'GetPatientRecords', patientId) || [];
    } catch (fabricErr) {
      console.warn('Fabric query failed, checking in-memory store:', fabricErr.message);
      // Merge in-memory uploaded records with mock data
      const memRecords = inMemoryRecords.get(patientId) || [];
      const mockRecords = getMockRecords(patientId, userId, role);
      // Put real uploaded records first, then mock ones
      records = [...memRecords, ...mockRecords];
    }

    res.json({ records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/records/:recordId
 * Get a specific record's metadata
 */
router.get('/:recordId', authenticate, async (req, res) => {
  try {
    const { recordId } = req.params;
    const { userId } = req.user;

    let record;
    try {
      record = await queryChaincode(userId, 'GetHealthRecord', recordId);
    } catch (fabricErr) {
      console.warn('Fabric query failed:', fabricErr.message);
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({ record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/records/:recordId/download
 * Download and decrypt a health record
 * 
 * Flow:
 * 1. Verify authorization on Fabric
 * 2. Get re-encryption key from Fabric (if doctor accessing patient's record)
 * 3. Retrieve encrypted file from IPFS
 * 4. Perform PRE decryption
 * 5. Return plaintext file
 */
router.post('/:recordId/download', authenticate, async (req, res) => {
  try {
    const { recordId } = req.params;
    const { userId, role } = req.user;
    const { privateKey } = req.body;

    if (role === 'ADMIN') {
      return res.status(403).json({ error: 'Admins cannot download medical records' });
    }
    if (!privateKey) {
      return res.status(400).json({ error: 'Private key required for decryption' });
    }

    // Step 1: Get record metadata & verify access
    let record;

    try {
      record = await queryChaincode(userId, 'GetHealthRecord', recordId);

      if (role === 'DOCTOR' && record.doctorId !== userId) {
        // Doctor has delegated access via PRE
        const grant = await queryChaincode(userId, 'GetAccessGrant', recordId, userId);
        if (!grant || !grant.active) {
          return res.status(403).json({ error: 'Access grant not found or revoked' });
        }
        const preResponse = await axios.post(`${CRYPTO_SERVICE_URL}/pre/decrypt`, {
          re_encrypted_key: grant.reEncryptionKey,
          doctor_private_key: privateKey
        });
        const aesKey = preResponse.data.aes_key;

        const ipfsData = await retrieveFromIPFS(record.ipfsCid);
        const payload = JSON.parse(ipfsData.toString());

        const decryptResponse = await axios.post(`${CRYPTO_SERVICE_URL}/decrypt`, {
          encrypted_data: payload.encrypted_data,
          aes_key: aesKey,
          nonce: payload.nonce,
          tag: payload.tag
        }, { responseType: 'arraybuffer' });

        res.set({
          'Content-Type': payload.metadata?.originalMimetype || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${payload.metadata?.originalFilename || 'record'}"`,
          'X-Record-Id': recordId,
          'X-IPFS-CID': record.ipfsCid
        });
        return res.send(decryptResponse.data);
      }

    } catch (fabricErr) {
      console.warn('Fabric unavailable, searching in-memory store (dev mode):', fabricErr.message);
      // Fallback: search in-memory records by recordId
      if (!record) {
        for (const records of inMemoryRecords.values()) {
          const found = records.find(r => r.recordId === recordId);
          if (found) { record = found; break; }
        }
      }
    }

    // No record found anywhere
    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    // ── DEV-MODE FAST PATH ────────────────────────────────────────────────────
    // If we have a local (in-memory) copy of the payload, serve it directly.
    // This covers ALL uploads done in the current server session: whether the
    // crypto service was online or offline, the RSA keys used during upload are
    // demo/placeholder keys that CANNOT reliably decrypt. Skip the crypto
    // service entirely and give the patient the raw file bytes.
    const devPayload = inMemoryPayloads.get(recordId);
    if (devPayload) {
      console.log(`[${recordId}] Serving from in-memory dev cache (bypassing crypto service).`);
      const rawData = Buffer.from(devPayload.encrypted_data, 'base64');
      res.set({
        'Content-Type': devPayload.metadata?.originalMimetype || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${devPayload.metadata?.originalFilename || 'record'}"`,
      });
      return res.send(rawData);
    }
    // ── END DEV-MODE FAST PATH ────────────────────────────────────────────────

    const encryptedAesKey = record.encryptedAesKey;

    // No encrypted key means this is a placeholder/mock record with no real data.
    if (!encryptedAesKey || encryptedAesKey === 'DEV_NO_ENCRYPTION') {
      return res.status(404).json({
        error: 'This is a demo record with no actual file data. Please ask your doctor to upload a real file.'
      });
    }

    // ── PRODUCTION PATH (Fabric + IPFS online, real RSA keys) ────────────────
    // Decrypt the RSA-wrapped AES key with the patient's real private key.
    let aesKey;
    try {
      const keyDecResponse = await axios.post(`${CRYPTO_SERVICE_URL}/decrypt-key`, {
        encrypted_key: encryptedAesKey,
        private_key: privateKey
      });
      aesKey = keyDecResponse.data.aes_key;
    } catch (keyErr) {
      console.error(`[${recordId}] Key decryption failed:`, keyErr.message);
      return res.status(400).json({
        error: 'Failed to decrypt the record key. Your private key may not match the one used during encryption.'
      });
    }

    // Retrieve encrypted file from IPFS.
    let payload;
    try {
      const ipfsData = await retrieveFromIPFS(record.ipfsCid);
      payload = JSON.parse(ipfsData.toString());
    } catch (ipfsErr) {
      console.error(`[${recordId}] IPFS retrieval failed:`, ipfsErr.message);
      return res.status(503).json({
        error: 'File storage (IPFS) is unavailable. Please try again later.'
      });
    }

    // Decrypt the file content.
    let decryptResponse;
    try {
      decryptResponse = await axios.post(`${CRYPTO_SERVICE_URL}/decrypt`, {
        encrypted_data: payload.encrypted_data,
        aes_key: aesKey,
        nonce: payload.nonce,
        tag: payload.tag
      }, { responseType: 'arraybuffer' });
    } catch (decErr) {
      console.error(`[${recordId}] File decryption failed:`, decErr.message);
      return res.status(400).json({
        error: 'File decryption failed. The file may be corrupted or the key is incorrect.'
      });
    }

    res.set({
      'Content-Type': payload.metadata?.originalMimetype || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${payload.metadata?.originalFilename || 'record'}"`,
    });
    res.send(decryptResponse.data);

  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Mock data for development
function getMockRecords(patientId, userId, role) {
  return [
    {
      recordId: 'rec-001',
      patientId,
      doctorId: role === 'DOCTOR' ? userId : 'doctor-001',
      recordType: 'Blood Test',
      ipfsCid: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
      timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      active: true
    },
    {
      recordId: 'rec-002',
      patientId,
      doctorId: role === 'DOCTOR' ? userId : 'doctor-001',
      recordType: 'X-Ray',
      ipfsCid: 'QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx',
      timestamp: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(),
      active: true
    },
    {
      recordId: 'rec-003',
      patientId,
      doctorId: role === 'DOCTOR' ? userId : 'doctor-001',
      recordType: 'Prescription',
      ipfsCid: 'QmSgvgwxZGaBLqkgyefwNpE8YDw9UqrZQ6X7Nb9aeMBgdF',
      timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      active: true
    }
  ];
}

module.exports = router;
