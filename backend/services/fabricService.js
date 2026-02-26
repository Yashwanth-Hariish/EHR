const { Gateway, Wallets } = require('fabric-network');
const path = require('path');
const fs = require('fs');

const CHANNEL_NAME = process.env.FABRIC_CHANNEL || 'healthcare-channel';
const CHAINCODE_NAME = process.env.FABRIC_CHAINCODE || 'ehr-contract';
const CONNECTION_PROFILE = process.env.FABRIC_CONNECTION_PROFILE || 
  path.resolve(__dirname, '../fabric/connection-profile.json');
const WALLET_PATH = process.env.FABRIC_WALLET_PATH || 
  path.resolve(__dirname, '../fabric/wallet');

/**
 * Get an authenticated gateway connection for a user
 */
async function getGateway(userId) {
  const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);

  const identity = await wallet.get(userId);
  if (!identity) {
    throw new Error(`Identity for user ${userId} not found in wallet. Please enroll first.`);
  }

  // Load connection profile
  let connectionProfile;
  try {
    const profileData = fs.readFileSync(CONNECTION_PROFILE, 'utf8');
    connectionProfile = JSON.parse(profileData);
  } catch (err) {
    // Use mock profile for development
    connectionProfile = getMockConnectionProfile();
  }

  const gateway = new Gateway();
  await gateway.connect(connectionProfile, {
    wallet,
    identity: userId,
    discovery: { enabled: true, asLocalhost: true }
  });

  return gateway;
}

/**
 * Invoke a chaincode transaction (write)
 */
async function invokeTransaction(userId, functionName, ...args) {
  const gateway = await getGateway(userId);
  try {
    const network = await gateway.getNetwork(CHANNEL_NAME);
    const contract = network.getContract(CHAINCODE_NAME);

    const stringArgs = args.map(a => 
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    );

    const result = await contract.submitTransaction(functionName, ...stringArgs);
    return result ? JSON.parse(result.toString()) : null;
  } finally {
    gateway.disconnect();
  }
}

/**
 * Query a chaincode function (read-only)
 */
async function queryChaincode(userId, functionName, ...args) {
  const gateway = await getGateway(userId);
  try {
    const network = await gateway.getNetwork(CHANNEL_NAME);
    const contract = network.getContract(CHAINCODE_NAME);

    const stringArgs = args.map(a => 
      typeof a === 'object' ? JSON.stringify(a) : String(a)
    );

    const result = await contract.evaluateTransaction(functionName, ...stringArgs);
    return result ? JSON.parse(result.toString()) : null;
  } finally {
    gateway.disconnect();
  }
}

/**
 * Enroll a user into the wallet (called during user registration)
 */
async function enrollUser(userId, certificate, privateKey) {
  const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);

  const identity = {
    credentials: { certificate, privateKey },
    mspId: process.env.FABRIC_MSP_ID || 'Org1MSP',
    type: 'X.509'
  };

  await wallet.put(userId, identity);
  return true;
}

/**
 * Mock connection profile for development/testing
 */
function getMockConnectionProfile() {
  return {
    name: 'healthcare-network',
    version: '1.0.0',
    client: {
      organization: 'Org1',
      connection: { timeout: { peer: { endorser: '300' } } }
    },
    organizations: {
      Org1: {
        mspid: 'Org1MSP',
        peers: ['peer0.org1.example.com'],
        certificateAuthorities: ['ca.org1.example.com']
      }
    },
    peers: {
      'peer0.org1.example.com': {
        url: process.env.FABRIC_PEER_URL || 'grpcs://localhost:7051',
        tlsCACerts: { pem: '-----BEGIN CERTIFICATE-----\nMOCK\n-----END CERTIFICATE-----\n' },
        grpcOptions: { 'ssl-target-name-override': 'peer0.org1.example.com' }
      }
    },
    certificateAuthorities: {
      'ca.org1.example.com': {
        url: process.env.FABRIC_CA_URL || 'https://localhost:7054',
        caName: 'ca-org1',
        httpOptions: { verify: false }
      }
    }
  };
}

module.exports = { invokeTransaction, queryChaincode, enrollUser };
