const { create } = require('ipfs-http-client');

let ipfsClient = null;

/**
 * Get or initialize IPFS client
 */
function getIPFSClient() {
  if (ipfsClient) return ipfsClient;

  // Use port 5002 for IPFS to avoid conflict with crypto service on 5001
  const apiUrl = process.env.IPFS_API_URL || 'http://127.0.0.1:5002';
  
  try {
    ipfsClient = create({ url: apiUrl });
    console.log(`IPFS client connected to ${apiUrl}`);
  } catch (err) {
    console.error('Failed to connect to IPFS:', err.message);
    throw new Error('IPFS connection failed. Ensure your local IPFS daemon is running.');
  }

  return ipfsClient;
}

/**
 * Upload encrypted data to IPFS
 * @param {Buffer} encryptedData - The encrypted file buffer
 * @returns {string} IPFS CID
 */
async function uploadToIPFS(encryptedData) {
  const client = getIPFSClient();

  const result = await client.add(encryptedData, {
    pin: true,           // Pin so it's not garbage collected
    cidVersion: 1,       // Use CIDv1 for better compatibility
    hashAlg: 'sha2-256'
  });

  const cid = result.cid.toString();
  console.log(`File pinned to IPFS with CID: ${cid}`);
  return cid;
}

/**
 * Retrieve encrypted file from IPFS by CID
 * @param {string} cid - IPFS CID
 * @returns {Buffer} Encrypted file data
 */
async function retrieveFromIPFS(cid) {
  const client = getIPFSClient();

  const chunks = [];
  for await (const chunk of client.cat(cid)) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

/**
 * Pin an existing CID (useful when CID is already known)
 */
async function pinCID(cid) {
  const client = getIPFSClient();
  await client.pin.add(cid);
  return true;
}

/**
 * Unpin a CID (e.g., when a record is deleted)
 */
async function unpinCID(cid) {
  const client = getIPFSClient();
  await client.pin.rm(cid);
  return true;
}

/**
 * Get IPFS node info
 */
async function getNodeInfo() {
  const client = getIPFSClient();
  return await client.id();
}

module.exports = { uploadToIPFS, retrieveFromIPFS, pinCID, unpinCID, getNodeInfo };
