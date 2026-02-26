#!/bin/bash
# ============================================================
# bootstrap-network.sh
# Sets up the Hyperledger Fabric healthcare network
# ============================================================

set -e

CHANNEL_NAME="healthcare-channel"
CHAINCODE_NAME="ehr-contract"
CHAINCODE_PATH="./chaincode"
CHAINCODE_VERSION="1.0"
CHAINCODE_SEQUENCE="1"
FABRIC_VERSION="2.5.4"
CA_VERSION="1.5.7"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log() { echo -e "${CYAN}[EHR]${NC} $1"; }
ok()  { echo -e "${GREEN}[OK]${NC} $1"; }
warn(){ echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

# Check prerequisites
command -v docker >/dev/null 2>&1 || err "Docker is required but not installed"
command -v go >/dev/null 2>&1 || err "Go is required but not installed"

log "Checking Fabric binaries..."
if [ ! -d "./bin" ]; then
  log "Downloading Hyperledger Fabric binaries..."
  curl -sSL https://bit.ly/2ysbOFE | bash -s -- ${FABRIC_VERSION} ${CA_VERSION} -d -s
fi
export PATH=$PATH:$(pwd)/bin

# =====================
# Step 1: Generate crypto material
# =====================
log "Generating cryptographic material..."
mkdir -p network

cat > network/crypto-config.yaml << 'EOF'
OrdererOrgs:
  - Name: Orderer
    Domain: example.com
    Specs:
      - Hostname: orderer
PeerOrgs:
  - Name: Org1
    Domain: org1.example.com
    EnableNodeOUs: true
    Template:
      Count: 1
    Users:
      Count: 3
EOF

cryptogen generate --config=./network/crypto-config.yaml --output=./network/crypto-config
ok "Crypto material generated"

# =====================
# Step 2: Generate genesis block and channel config
# =====================
log "Generating channel artifacts..."

mkdir -p network/channel-artifacts

cat > network/configtx.yaml << 'EOF'
Organizations:
  - &OrdererOrg
    Name: OrdererOrg
    ID: OrdererMSP
    MSPDir: crypto-config/ordererOrganizations/example.com/msp
    Policies:
      Readers:
        Type: Signature
        Rule: "OR('OrdererMSP.member')"
      Writers:
        Type: Signature
        Rule: "OR('OrdererMSP.member')"
      Admins:
        Type: Signature
        Rule: "OR('OrdererMSP.admin')"

  - &Org1
    Name: Org1MSP
    ID: Org1MSP
    MSPDir: crypto-config/peerOrganizations/org1.example.com/msp
    Policies:
      Readers:
        Type: Signature
        Rule: "OR('Org1MSP.admin', 'Org1MSP.peer', 'Org1MSP.client')"
      Writers:
        Type: Signature
        Rule: "OR('Org1MSP.admin', 'Org1MSP.client')"
      Admins:
        Type: Signature
        Rule: "OR('Org1MSP.admin')"
      Endorsement:
        Type: Signature
        Rule: "OR('Org1MSP.peer')"
    AnchorPeers:
      - Host: peer0.org1.example.com
        Port: 7051

Capabilities:
  Channel: &ChannelCapabilities
    V2_0: true
  Orderer: &OrdererCapabilities
    V2_0: true
  Application: &ApplicationCapabilities
    V2_5: true

Application: &ApplicationDefaults
  Organizations:
  Policies:
    Readers:
      Type: ImplicitMeta
      Rule: "ANY Readers"
    Writers:
      Type: ImplicitMeta
      Rule: "ANY Writers"
    Admins:
      Type: ImplicitMeta
      Rule: "MAJORITY Admins"
    LifecycleEndorsement:
      Type: ImplicitMeta
      Rule: "MAJORITY Endorsement"
    Endorsement:
      Type: ImplicitMeta
      Rule: "MAJORITY Endorsement"
  Capabilities:
    <<: *ApplicationCapabilities

Orderer: &OrdererDefaults
  OrdererType: etcdraft
  Addresses:
    - orderer.example.com:7050
  EtcdRaft:
    Consenters:
      - Host: orderer.example.com
        Port: 7050
        ClientTLSCert: crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt
        ServerTLSCert: crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt
  BatchTimeout: 2s
  BatchSize:
    MaxMessageCount: 10
    AbsoluteMaxBytes: 99 MB
    PreferredMaxBytes: 512 KB
  Organizations:
  Policies:
    Readers:
      Type: ImplicitMeta
      Rule: "ANY Readers"
    Writers:
      Type: ImplicitMeta
      Rule: "ANY Writers"
    Admins:
      Type: ImplicitMeta
      Rule: "MAJORITY Admins"
    BlockValidation:
      Type: ImplicitMeta
      Rule: "ANY Writers"
  Capabilities:
    <<: *OrdererCapabilities

Channel: &ChannelDefaults
  Policies:
    Readers:
      Type: ImplicitMeta
      Rule: "ANY Readers"
    Writers:
      Type: ImplicitMeta
      Rule: "ANY Writers"
    Admins:
      Type: ImplicitMeta
      Rule: "MAJORITY Admins"
  Capabilities:
    <<: *ChannelCapabilities

Profiles:
  TwoOrgsOrdererGenesis:
    <<: *ChannelDefaults
    Orderer:
      <<: *OrdererDefaults
      Organizations:
        - *OrdererOrg
    Consortiums:
      HealthcareConsortium:
        Organizations:
          - *Org1
  TwoOrgsChannel:
    Consortium: HealthcareConsortium
    <<: *ChannelDefaults
    Application:
      <<: *ApplicationDefaults
      Organizations:
        - *Org1
EOF

cd network
configtxgen -profile TwoOrgsOrdererGenesis -channelID system-channel -outputBlock ./genesis.block -configPath .
configtxgen -profile TwoOrgsChannel -outputCreateChannelTx ./channel-artifacts/channel.tx -channelID ${CHANNEL_NAME} -configPath .
configtxgen -profile TwoOrgsChannel -outputAnchorPeersUpdate ./channel-artifacts/Org1MSPanchors.tx -channelID ${CHANNEL_NAME} -asOrg Org1MSP -configPath .
cd ..
ok "Channel artifacts generated"

# =====================
# Step 3: Start the network
# =====================
log "Starting Fabric network with Docker Compose..."
docker-compose -f docker-compose.fabric.yml up -d
sleep 10
ok "Network containers started"

# =====================
# Step 4: Create and join channel
# =====================
log "Creating and joining channel ${CHANNEL_NAME}..."

ORDERER_CA="./network/crypto-config/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem"
PEER_TLS_ROOTCERT="./network/crypto-config/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"

docker exec cli peer channel create \
  -o orderer.example.com:7050 \
  -c ${CHANNEL_NAME} \
  -f ./channel-artifacts/channel.tx \
  --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem

docker exec cli peer channel join -b ${CHANNEL_NAME}.block
ok "Peer joined channel"

# =====================
# Step 5: Package and deploy chaincode
# =====================
log "Packaging chaincode..."

cd chaincode
go mod tidy
cd ..

docker exec cli peer lifecycle chaincode package ${CHAINCODE_NAME}.tar.gz \
  --path /opt/gopath/src/github.com/hyperledger/fabric/peer/chaincode \
  --lang golang \
  --label ${CHAINCODE_NAME}_${CHAINCODE_VERSION}

log "Installing chaincode..."
docker exec cli peer lifecycle chaincode install ${CHAINCODE_NAME}.tar.gz

# Get package ID
PACKAGE_ID=$(docker exec cli peer lifecycle chaincode queryinstalled | grep "${CHAINCODE_NAME}_${CHAINCODE_VERSION}" | awk '{print $3}' | tr -d ',')
log "Package ID: $PACKAGE_ID"

log "Approving chaincode for org..."
docker exec cli peer lifecycle chaincode approveformyorg \
  -o orderer.example.com:7050 \
  --channelID ${CHANNEL_NAME} \
  --name ${CHAINCODE_NAME} \
  --version ${CHAINCODE_VERSION} \
  --package-id ${PACKAGE_ID} \
  --sequence ${CHAINCODE_SEQUENCE} \
  --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem

log "Committing chaincode definition..."
docker exec cli peer lifecycle chaincode commit \
  -o orderer.example.com:7050 \
  --channelID ${CHANNEL_NAME} \
  --name ${CHAINCODE_NAME} \
  --version ${CHAINCODE_VERSION} \
  --sequence ${CHAINCODE_SEQUENCE} \
  --tls --cafile /opt/gopath/src/github.com/hyperledger/fabric/peer/crypto/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem

ok "Chaincode deployed!"

# =====================
# Final summary
# =====================
echo ""
echo -e "${GREEN}========================================"
echo -e "  Fabric Network Ready!"
echo -e "========================================${NC}"
echo -e "Channel:    ${CYAN}${CHANNEL_NAME}${NC}"
echo -e "Chaincode:  ${CYAN}${CHAINCODE_NAME} v${CHAINCODE_VERSION}${NC}"
echo -e "Peer:       ${CYAN}localhost:7051${NC}"
echo -e "Orderer:    ${CYAN}localhost:7050${NC}"
echo -e "CA:         ${CYAN}localhost:7054${NC}"
echo ""
echo -e "Next: Start backend with ${CYAN}cd backend && npm run dev${NC}"
