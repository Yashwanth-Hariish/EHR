# 🏥 SecureEHR — Blockchain-Enabled Privacy-Preserving Health Records

A production-grade Electronic Health Record (EHR) system combining **Hyperledger Fabric**, **IPFS**, **AES-256-GCM encryption**, and **Proxy Re-Encryption** into a secure, decentralized platform.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React.js)                      │
│   Admin Dashboard │ Doctor Dashboard │ Patient Dashboard         │
└───────────────────────────────┬─────────────────────────────────┘
                                │ REST API
┌───────────────────────────────▼─────────────────────────────────┐
│                     BACKEND (Node.js / Express)                  │
│   Auth  │  Records  │  Access Delegation  │  Admin               │
└────┬──────────────────────────┬────────────────────┬────────────┘
     │                          │                    │
     ▼                          ▼                    ▼
┌─────────────┐    ┌──────────────────────┐  ┌─────────────────┐
│  Hyperledger│    │   Python Crypto Svc   │  │   IPFS Node     │
│   Fabric    │    │  AES-256-GCM + PRE    │  │  Off-chain EHR  │
│  (Chaincode)│    │  PyCryptodome         │  │  encrypted blobs│
└─────────────┘    └──────────────────────┘  └─────────────────┘
```

---

## Security Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| File Encryption | AES-256-GCM | Authenticated encryption of EHR files |
| Key Wrapping | RSA-2048 OAEP | Secure storage of AES keys |
| Access Delegation | Proxy Re-Encryption (PRE) | Share access without exposing private keys |
| Digital Signatures | PKCS1-v1.5 + SHA-256 | Authenticate record uploads |
| Audit Trail | Hyperledger Fabric | Immutable, tamper-proof access logs |
| Decentralized Storage | IPFS | Censorship-resistant file storage |
| Access Control | RBAC Smart Contracts | Role enforcement on-chain |

---

## Project Structure

```
ehr-system/
├── chaincode/
│   ├── ehr_contract.go        # Hyperledger Fabric chaincode (smart contract)
│   └── go.mod
│
├── backend/
│   ├── server.js              # Express server entry point
│   ├── .env                   # Environment configuration
│   ├── requirements.txt       # Python dependencies
│   ├── middleware/
│   │   └── auth.js            # JWT authentication + RBAC middleware
│   ├── routes/
│   │   ├── auth.js            # Login / registration endpoints
│   │   ├── records.js         # Record upload / download / list
│   │   ├── access.js          # PRE grant / revoke delegation
│   │   ├── admin.js           # Audit logs / user management
│   │   └── crypto.js          # Proxy to Python crypto service
│   └── services/
│       ├── fabricService.js   # Hyperledger Fabric gateway client
│       ├── ipfsService.js     # IPFS upload / download client
│       └── cryptoService.py   # Python: AES-GCM, RSA, PRE, signatures
│
├── frontend/
│   └── src/
│       ├── App.js             # Router + protected routes
│       ├── App.css            # Dark healthcare theme
│       ├── contexts/
│       │   └── AuthContext.js # Auth state + JWT management
│       ├── services/
│       │   └── api.js         # Axios API client layer
│       └── components/
│           ├── Common/
│           │   ├── LoginPage.js
│           │   └── Sidebar.js
│           ├── Admin/
│           │   └── AdminDashboard.js  # User mgmt + audit logs
│           ├── Doctor/
│           │   └── DoctorDashboard.js # Upload + view records
│           └── Patient/
│               └── PatientDashboard.js # View records + PRE delegation
│
├── scripts/
│   ├── bootstrap-network.sh   # Full Fabric network setup
│   └── setup-ipfs.sh          # IPFS node initialization
│
├── docker-compose.fabric.yml  # Fabric network containers
└── README.md
```

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 18.x | Backend + Frontend |
| Go | >= 1.21 | Chaincode compilation |
| Python | >= 3.9 | Crypto service |
| Docker | >= 24.x | Fabric containers |
| Docker Compose | >= 2.x | Orchestration |

---

## Step-by-Step Setup

### Step 1 — Initialize the Local IPFS Node

```bash
# Option A: Use the setup script (Linux/macOS)
chmod +x scripts/setup-ipfs.sh
./scripts/setup-ipfs.sh

# Option B: Manual setup
# 1. Download Kubo (go-ipfs) from https://dist.ipfs.tech/#kubo
# 2. Install and initialize:
ipfs init --profile server
ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:3000","http://localhost:5000"]'

# Start the daemon
ipfs daemon &

# Test it works
echo "Hello EHR" | ipfs add
# Should return: added QmXxx...  Hello_EHR
```

### Step 2 — Deploy the Fabric Chaincode

**Option A — Automated (Recommended)**

```bash
chmod +x scripts/bootstrap-network.sh
./scripts/bootstrap-network.sh
```

**Option B — Manual step-by-step**

```bash
# 1. Download Fabric binaries (first time only)
curl -sSL https://bit.ly/2ysbOFE | bash -s -- 2.5.4 1.5.7 -d -s
export PATH=$PATH:$(pwd)/bin

# 2. Generate crypto material
cryptogen generate \
  --config=./network/crypto-config.yaml \
  --output=./network/crypto-config

# 3. Generate genesis block
export FABRIC_CFG_PATH=$(pwd)/network
configtxgen -profile TwoOrgsOrdererGenesis \
  -channelID system-channel \
  -outputBlock ./network/genesis.block

# 4. Generate channel transaction
configtxgen -profile TwoOrgsChannel \
  -outputCreateChannelTx ./network/channel-artifacts/channel.tx \
  -channelID healthcare-channel

# 5. Start the network
docker-compose -f docker-compose.fabric.yml up -d
sleep 10

# 6. Create channel
docker exec cli peer channel create \
  -o orderer.example.com:7050 \
  -c healthcare-channel \
  -f ./channel-artifacts/channel.tx \
  --tls --cafile /path/to/orderer/tlscacerts/...

# 7. Join peer to channel
docker exec cli peer channel join -b healthcare-channel.block

# 8. Package chaincode
docker exec cli peer lifecycle chaincode package ehr-contract.tar.gz \
  --path /opt/gopath/.../chaincode \
  --lang golang \
  --label ehr-contract_1.0

# 9. Install chaincode
docker exec cli peer lifecycle chaincode install ehr-contract.tar.gz

# 10. Get package ID
PKG_ID=$(docker exec cli peer lifecycle chaincode queryinstalled | grep ehr-contract | awk '{print $3}')

# 11. Approve + commit
docker exec cli peer lifecycle chaincode approveformyorg \
  -o orderer.example.com:7050 --channelID healthcare-channel \
  --name ehr-contract --version 1.0 --sequence 1 \
  --package-id $PKG_ID --tls --cafile ...

docker exec cli peer lifecycle chaincode commit \
  -o orderer.example.com:7050 --channelID healthcare-channel \
  --name ehr-contract --version 1.0 --sequence 1 --tls --cafile ...
```

### Step 3 — Start the Python Crypto Service

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # Linux/macOS
# venv\Scripts\activate   # Windows

# Install dependencies
pip install -r requirements.txt

# Start service
python services/cryptoService.py
# Running on http://0.0.0.0:5001
```

### Step 4 — Start the Node.js Backend

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cp .env .env.local
# Edit .env.local with your settings

# Start server
npm run dev
# Backend running on port 5000
```

### Step 5 — Start the React Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm start
# Frontend at http://localhost:3000
```

---

## Demo Accounts

| Role | Email | Password | Capabilities |
|------|-------|----------|--------------|
| **Admin** | admin@ehr.local | admin123 | User management, audit logs (no medical data) |
| **Doctor** | doctor@ehr.local | doctor123 | Upload records, view authorized patient records |
| **Patient** | patient@ehr.local | patient123 | View own records, delegate access via PRE |

---

## Key Workflows Explained

### 1. Secure File Upload (Doctor)

```
Doctor UI → Select Patient + File
    → POST /api/records/upload (multipart)
    → Python Crypto: AES-256-GCM encrypt file
    → RSA-2048 OAEP: wrap AES key with patient's public key
    → Upload encrypted blob to IPFS → get CID
    → Sign metadata (RecordID + CID + Hash) with doctor's private key
    → Invoke Fabric chaincode: CreateHealthRecord
        (RecordID, PatientID, CID, EncryptedKey, Signature, Hash)
    → Blockchain stores immutable record
```

### 2. Proxy Re-Encryption Grant (Patient)

```
Patient UI → Choose Record + Doctor
    → POST /api/access/grant
    → Python Crypto PRE:
        rk = keygen(patient_private_key, doctor_public_key)
    → Invoke Fabric: GrantAccess(recordID, doctorID, rk)
    → Blockchain stores re-encryption key
    → Doctor can now decrypt record without patient's private key
```

### 3. Authorized Download (Doctor)

```
Doctor → Click "View Record"
    → POST /api/records/:id/download { privateKey }
    → Backend queries Fabric: GetHealthRecord (checks RBAC)
    → If delegated: GetAccessGrant → get re-encryption key
    → Proxy re-encryption: re-encrypt AES key for doctor
    → Retrieve encrypted blob from IPFS
    → Python Crypto: PRE decrypt → AES-256-GCM decrypt
    → Return plaintext file
```

---

## Chaincode Functions Reference

| Function | Role | Description |
|----------|------|-------------|
| `CreateUser` | Admin | Register user on ledger |
| `DeactivateUser` | Admin | Deactivate a user |
| `CreateHealthRecord` | Doctor | Store EHR metadata on-chain |
| `GetHealthRecord` | Patient/Doctor | Retrieve record (RBAC enforced) |
| `GetPatientRecords` | Patient/Doctor | List all records for patient |
| `GrantAccess` | Patient | Create PRE delegation |
| `RevokeAccess` | Patient | Remove PRE delegation |
| `GetAccessGrant` | Patient/Doctor | Retrieve active grant |
| `GetAuditLogs` | Admin | Read-only audit trail |
| `VerifyRecordIntegrity` | Doctor | Verify record hash |

---

## API Endpoints Reference

### Auth
```
POST /api/auth/login          { email, password }
POST /api/auth/register       { name, email, password, role }  [ADMIN]
GET  /api/auth/me
```

### Records
```
POST /api/records/upload              multipart/form-data  [DOCTOR]
GET  /api/records/patient/:patientId                       [DOCTOR|PATIENT]
GET  /api/records/:recordId
POST /api/records/:recordId/download  { privateKey }       [DOCTOR|PATIENT]
```

### Access Delegation
```
POST /api/access/grant    { recordId, doctorId, patientPrivateKey, doctorPublicKey }  [PATIENT]
POST /api/access/revoke   { recordId, doctorId }                                      [PATIENT]
GET  /api/access/record/:recordId                                                     [PATIENT]
```

### Admin
```
GET  /api/admin/audit-logs?limit=100   [ADMIN]
GET  /api/admin/users                  [ADMIN]
GET  /api/admin/system-stats           [ADMIN]
```

---

## Environment Variables

```env
# Backend
PORT=5000
JWT_SECRET=<change-in-production>
CRYPTO_SERVICE_URL=http://localhost:5001

# IPFS
IPFS_API_URL=http://127.0.0.1:5001

# Fabric
FABRIC_CHANNEL=healthcare-channel
FABRIC_CHAINCODE=ehr-contract
FABRIC_MSP_ID=Org1MSP
FABRIC_PEER_URL=grpcs://localhost:7051
FABRIC_CA_URL=https://localhost:7054
FABRIC_CONNECTION_PROFILE=./fabric/connection-profile.json
FABRIC_WALLET_PATH=./fabric/wallet
```

---

## Production Hardening Checklist

- [ ] Replace in-memory user store with PostgreSQL / MongoDB
- [ ] Implement HSM (Hardware Security Module) for private key management
- [ ] Use pyUmbral for production-grade PRE (instead of simplified scheme)
- [ ] Enable mutual TLS between all services
- [ ] Add rate limiting + DDoS protection at load balancer
- [ ] Implement HIPAA audit logging (access timestamps, IP addresses)
- [ ] Set up private IPFS cluster with pinning services (Pinata / Web3.storage)
- [ ] Configure multi-org Fabric network for true decentralization
- [ ] Implement key rotation for AES keys
- [ ] Add certificate revocation for compromised keys
- [ ] Enable Fabric private data collections for sensitive fields
- [ ] Add consent management module (GDPR / HIPAA)

---

## License

MIT License — for educational and research purposes.
This system requires additional HIPAA compliance work before use with real patient data.
