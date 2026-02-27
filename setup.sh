#!/usr/bin/env bash
# ============================================================
# AI Character Engine — Linux/Mac Setup
# ============================================================
# One-click setup: installs dependencies, detects your LLM
# provider, and generates engine.config.json.
#
# Usage: chmod +x setup.sh && ./setup.sh
# ============================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN} ========================================${NC}"
echo -e "${CYAN}  AI Character Engine - Setup${NC}"
echo -e "${CYAN} ========================================${NC}"
echo ""

# ------------------------------------------------------------
# Step 1: Check Node.js
# ------------------------------------------------------------
echo -e "[1/5] Checking Node.js..."

if ! command -v node &> /dev/null; then
    echo ""
    echo -e "${RED} ERROR: Node.js is not installed.${NC}"
    echo ""
    echo "  Install Node.js 20+ from: https://nodejs.org"
    echo "  Or use your package manager:"
    echo "    Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "    Mac (Homebrew): brew install node"
    echo ""
    exit 1
fi

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)

if [ "$NODE_MAJOR" -lt 20 ]; then
    echo ""
    echo -e "${RED} ERROR: Node.js v${NODE_MAJOR} is too old. Version 20+ required.${NC}"
    echo "  Download from: https://nodejs.org"
    echo ""
    exit 1
fi

echo -e "  Found Node.js v${NODE_MAJOR} - ${GREEN}OK${NC}"

# ------------------------------------------------------------
# Step 2: Install dependencies
# ------------------------------------------------------------
echo ""
echo -e "[2/5] Installing dependencies..."

if ! npm install; then
    echo ""
    echo -e "${RED} ERROR: npm install failed.${NC}"
    echo ""
    echo "  If better-sqlite3 fails to build:"
    echo "    Ubuntu/Debian: sudo apt-get install build-essential python3"
    echo "    Mac: xcode-select --install"
    echo ""
    exit 1
fi

echo -e "  Dependencies installed - ${GREEN}OK${NC}"

# ------------------------------------------------------------
# Step 3: Build TypeScript
# ------------------------------------------------------------
echo ""
echo -e "[3/5] Building TypeScript..."

if ! npm run build; then
    echo ""
    echo -e "${RED} ERROR: TypeScript build failed.${NC}"
    exit 1
fi

echo -e "  Build complete - ${GREEN}OK${NC}"

# ------------------------------------------------------------
# Step 4: Detect inference provider
# ------------------------------------------------------------
echo ""
echo -e "[4/5] Detecting LLM provider..."

PROVIDER="none"
PROVIDER_NAME=""

# Check vLLM (port 8100)
echo "  Checking vLLM on port 8100..."
if curl -s --max-time 3 http://127.0.0.1:8100/health > /dev/null 2>&1; then
    PROVIDER="vllm"
    PROVIDER_NAME="vLLM"
    echo -e "  Found vLLM - ${GREEN}DETECTED${NC}"
fi

# Check Ollama (port 11434)
if [ "$PROVIDER" = "none" ]; then
    echo "  Checking Ollama on port 11434..."
    if curl -s --max-time 3 http://localhost:11434/v1/models > /dev/null 2>&1; then
        PROVIDER="ollama"
        PROVIDER_NAME="Ollama"
        echo -e "  Found Ollama - ${GREEN}DETECTED${NC}"
    fi
fi

# Check LM Studio (port 1234)
if [ "$PROVIDER" = "none" ]; then
    echo "  Checking LM Studio on port 1234..."
    if curl -s --max-time 3 http://localhost:1234/v1/models > /dev/null 2>&1; then
        PROVIDER="lmstudio"
        PROVIDER_NAME="LM Studio"
        echo -e "  Found LM Studio - ${GREEN}DETECTED${NC}"
    fi
fi

# No provider found
if [ "$PROVIDER" = "none" ]; then
    echo ""
    echo -e "${YELLOW} No LLM provider detected.${NC}"
    echo ""
    echo "  The easiest way to get started is with Ollama:"
    echo ""

    read -p "  Install Ollama now? (y/n): " INSTALL_CHOICE

    if [ "$INSTALL_CHOICE" = "y" ] || [ "$INSTALL_CHOICE" = "Y" ]; then
        echo ""
        echo "  Installing Ollama..."
        curl -fsSL https://ollama.com/install.sh | sh

        echo ""
        echo "  Pulling qwen2.5:7b model (this may take a few minutes)..."
        ollama pull qwen2.5:7b

        PROVIDER="ollama"
        PROVIDER_NAME="Ollama"
        echo ""
        echo -e "  Ollama installed - ${GREEN}OK${NC}"
    else
        echo ""
        echo "  To set up manually:"
        echo "    Ollama:  curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen2.5:7b"
        echo "    vLLM:    pip install vllm && python -m vllm.entrypoints.openai.api_server --model Salesforce/xLAM-2-1b-fc-r --port 8100"
        echo ""
        echo "  Then run ./setup.sh again."
        exit 0
    fi
fi

# ------------------------------------------------------------
# Step 5: Generate config
# ------------------------------------------------------------
echo ""
echo -e "[5/5] Generating engine.config.json..."

if [ -f engine.config.json ]; then
    echo "  engine.config.json already exists — skipping."
    echo "  Delete it and re-run setup.sh to regenerate."
else
    if [ "$PROVIDER" = "vllm" ]; then
        cat <<'EOF' > engine.config.json
{
  "database": { "path": "./data/engine.db" },
  "inference": {
    "type": "vllm",
    "baseUrl": "http://127.0.0.1:8100/v1",
    "models": { "heavy": "default", "mid": "default", "light": "default" },
    "maxConcurrency": 64,
    "timeoutMs": 60000,
    "maxRetries": 2
  },
  "logging": { "level": "info", "pretty": true }
}
EOF
    elif [ "$PROVIDER" = "ollama" ]; then
        cat <<'EOF' > engine.config.json
{
  "database": { "path": "./data/engine.db" },
  "inference": {
    "type": "ollama",
    "models": { "heavy": "qwen2.5:7b", "mid": "qwen2.5:7b", "light": "qwen2.5:1.5b" },
    "maxConcurrency": 10,
    "timeoutMs": 30000,
    "maxRetries": 2
  },
  "logging": { "level": "info", "pretty": true }
}
EOF
    elif [ "$PROVIDER" = "lmstudio" ]; then
        cat <<'EOF' > engine.config.json
{
  "database": { "path": "./data/engine.db" },
  "inference": {
    "type": "lmstudio",
    "baseUrl": "http://localhost:1234/v1",
    "models": { "heavy": "default", "mid": "default", "light": "default" },
    "maxConcurrency": 4,
    "timeoutMs": 30000,
    "maxRetries": 2
  },
  "logging": { "level": "info", "pretty": true }
}
EOF
    fi

    echo -e "  Generated engine.config.json for ${PROVIDER_NAME}"
fi

# ------------------------------------------------------------
# Done!
# ------------------------------------------------------------
echo ""
echo -e "${GREEN} ========================================${NC}"
echo -e "${GREEN}  Setup Complete!${NC}"
echo -e "${GREEN} ========================================${NC}"
echo ""
echo -e "  Provider: ${CYAN}${PROVIDER_NAME}${NC}"
echo ""
echo "  Next steps:"
echo "    1. Run the starter demo:"
echo "       npm run demo:starter"
echo ""
echo "    2. Run the tavern sample:"
echo "       npm run demo:sample"
echo ""
echo "    3. Read the quick-start guide:"
echo "       QUICKSTART.md"
echo ""
echo "    4. Start the HTTP API (for non-Node.js games):"
echo "       npm run demo:api"
echo ""
