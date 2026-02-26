#!/bin/bash
# ============================================================
# setup-ipfs.sh  — Initialize and configure a local IPFS node
# ============================================================

set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'

log() { echo -e "${CYAN}[IPFS]${NC} $1"; }
ok()  { echo -e "${GREEN}[OK]${NC} $1"; }
err() { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

# =====================
# Check IPFS installation
# =====================
if ! command -v ipfs &> /dev/null; then
  log "IPFS not found. Installing Kubo (go-ipfs)..."
  
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  
  if [ "$ARCH" = "x86_64" ]; then ARCH="amd64"
  elif [ "$ARCH" = "aarch64" ]; then ARCH="arm64"
  fi
  
  IPFS_VERSION="v0.24.0"
  DOWNLOAD_URL="https://dist.ipfs.tech/kubo/${IPFS_VERSION}/kubo_${IPFS_VERSION}_${OS}-${ARCH}.tar.gz"
  
  log "Downloading from: $DOWNLOAD_URL"
  curl -sSL "$DOWNLOAD_URL" -o /tmp/kubo.tar.gz
  tar -xzf /tmp/kubo.tar.gz -C /tmp
  sudo bash /tmp/kubo/install.sh
  ok "IPFS Kubo installed"
fi

# =====================
# Initialize IPFS node
# =====================
if [ ! -d "$HOME/.ipfs" ]; then
  log "Initializing IPFS node..."
  ipfs init --profile server
  ok "IPFS node initialized"
else
  log "IPFS already initialized at $HOME/.ipfs"
fi

# =====================
# Configure IPFS for local development
# =====================
log "Configuring IPFS for healthcare use..."

# Disable public DHT routing for HIPAA-like compliance
ipfs config Routing.Type none

# Configure API to listen on all interfaces (for Docker compatibility)
ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001

# Configure Gateway
ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8080

# Enable file store for efficient storage
ipfs config --bool Experimental.FilestoreEnabled true

# Set swarm key for private network (optional - for isolated healthcare network)
# Uncomment below to create a private IPFS network
# ipfs-swarm-key-gen > ~/.ipfs/swarm.key
# ipfs bootstrap rm --all

# Set CORS headers for backend API access
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["http://localhost:3000", "http://localhost:5000"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST", "GET"]'

ok "IPFS configured"

# =====================
# Create systemd service (Linux only)
# =====================
if [ "$(uname)" = "Linux" ] && command -v systemctl &> /dev/null; then
  log "Creating systemd service..."
  
  cat > /tmp/ipfs.service << EOF
[Unit]
Description=IPFS Healthcare Node
After=network.target

[Service]
Type=simple
User=$USER
Environment=IPFS_PATH=$HOME/.ipfs
ExecStart=$(which ipfs) daemon --enable-gc
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

  sudo cp /tmp/ipfs.service /etc/systemd/system/ipfs.service
  sudo systemctl daemon-reload
  sudo systemctl enable ipfs
  sudo systemctl start ipfs
  ok "IPFS systemd service created and started"
else
  log "To start IPFS daemon, run: ipfs daemon"
fi

# =====================
# Print node info
# =====================
sleep 2

if ipfs id &> /dev/null; then
  NODE_ID=$(ipfs id -f '<id>')
  echo ""
  echo -e "${GREEN}========================================"
  echo -e "  IPFS Node Ready!"
  echo -e "========================================${NC}"
  echo -e "Node ID:    ${CYAN}${NODE_ID}${NC}"
  echo -e "API:        ${CYAN}http://127.0.0.1:5001${NC}"
  echo -e "Gateway:    ${CYAN}http://127.0.0.1:8080${NC}"
  echo -e "Web UI:     ${CYAN}http://127.0.0.1:5001/webui${NC}"
  echo ""
  echo -e "Test with: ${CYAN}echo 'test' | ipfs add${NC}"
fi
