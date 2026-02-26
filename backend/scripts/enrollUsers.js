const fs = require('fs');
const path = require('path');
const { Wallets } = require('fabric-network');

const WALLET_PATH = path.resolve(__dirname, '../fabric/wallet');
const CRYPTO_PATH = path.resolve(__dirname, '../../network/crypto-config/peerOrganizations/org1.example.com/users');

// Ensure wallet directory exists
const walletDir = path.dirname(WALLET_PATH);
if (!fs.existsSync(walletDir)) {
  fs.mkdirSync(walletDir, { recursive: true });
}

// Map demo users to crypto-config users
const userMapping = {
  'admin-001': 'Admin@org1.example.com',
  'doctor-001': 'User1@org1.example.com',
  'patient-001': 'User2@org1.example.com'
};

async function enrollUser(userId, mspUserId) {
  const wallet = await Wallets.newFileSystemWallet(WALLET_PATH);
  
  // Check if already enrolled
  const existingIdentity = await wallet.get(userId);
  if (existingIdentity) {
    console.log(`User ${userId} already enrolled`);
    return;
  }

  // Read certificate
  const certPath = path.join(CRYPTO_PATH, mspUserId, 'msp', 'signcerts');
  const certFiles = fs.readdirSync(certPath);
  const certFile = certFiles.find(f => f.endsWith('.pem'));
  const certificate = fs.readFileSync(path.join(certPath, certFile)).toString();

  // Read private key
  const keyPath = path.join(CRYPTO_PATH, mspUserId, 'msp', 'keystore');
  const keyFiles = fs.readdirSync(keyPath);
  const privateKeyFile = keyFiles.find(f => f.endsWith('.pem') || f.includes('priv_sk'));
  const privateKey = fs.readFileSync(path.join(keyPath, privateKeyFile)).toString();

  // Create identity
  const identity = {
    credentials: {
      certificate: certificate,
      privateKey: privateKey
    },
    mspId: 'Org1MSP',
    type: 'X.509'
  };

  // Put in wallet
  await wallet.put(userId, identity);
  console.log(`Successfully enrolled user: ${userId}`);
}

async function main() {
  try {
    console.log('Enrolling users into Fabric wallet...');
    
    for (const [userId, mspUserId] of Object.entries(userMapping)) {
      await enrollUser(userId, mspUserId);
    }
    
    console.log('All users enrolled successfully!');
  } catch (error) {
    console.error('Enrollment failed:', error);
    process.exit(1);
  }
}

main();
