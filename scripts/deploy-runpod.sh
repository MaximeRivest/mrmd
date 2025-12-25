#!/bin/bash
# Deploy mrmd to a cloud GPU server (RunPod, Hyperstack, etc.)
# Usage: ./deploy-runpod.sh <ip> [port] [user] [workspace]
# Example: ./deploy-runpod.sh 103.196.86.89 15783              # RunPod (root, custom port)
# Example: ./deploy-runpod.sh 62.169.159.169 22 ubuntu /ephemeral  # Hyperstack

set -e

IP="${1:?Usage: $0 <ip> [port] [user] [workspace]}"
PORT="${2:-22}"
USER="${3:-root}"
WORKSPACE="${4:-/workspace}"
SSH="ssh -p $PORT $USER@$IP"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Source local bashrc to get API keys
source ~/.bashrc 2>/dev/null || true

SUDO=""
if [ "$USER" != "root" ]; then
    SUDO="sudo"
fi

# Add host key if not already known
echo "==> Adding host key..."
ssh-keyscan -p $PORT -H $IP >> ~/.ssh/known_hosts 2>/dev/null || true

echo "==> Installing system dependencies..."
$SSH "$SUDO apt-get update && $SUDO apt-get install -y rsync fzf curl"

echo "==> Installing Node.js..."
if [ "$USER" = "root" ]; then
    $SSH "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
else
    $SSH "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
fi

echo "==> Installing uv..."
$SSH 'curl -LsSf https://astral.sh/uv/install.sh | sh'

# Make uv globally accessible via symlink
echo "==> Making uv globally accessible..."
$SSH "$SUDO ln -sf ~/.local/bin/uv /usr/local/bin/uv && $SUDO ln -sf ~/.local/bin/uvx /usr/local/bin/uvx"

echo "==> Installing Claude Code..."
$SSH 'curl -fsSL https://claude.ai/install.sh | bash'
$SSH "$SUDO ln -sf ~/.local/bin/claude /usr/local/bin/claude" || true

RSYNC_EXCLUDES=(
    --exclude='**/.venv'
    --exclude='**/__pycache__'
    --exclude='**/node_modules'
    --exclude='**/.git'
    --exclude='**/.pytest_cache'
    --exclude='**/*.egg-info'
    --exclude='**/build'
    --exclude='**/dist'
    --exclude='**/*.log'
    --exclude='**/*.pyc'
    --exclude='**/.env'
    --exclude='**/start.sh'
)

echo "==> Creating workspace directory..."
$SSH "$SUDO mkdir -p $WORKSPACE && $SUDO chown $USER:$USER $WORKSPACE"

echo "==> Syncing mrmd..."
rsync -avz --no-owner --no-group "${RSYNC_EXCLUDES[@]}" \
    -e "ssh -p $PORT" "$SCRIPT_DIR" $USER@$IP:$WORKSPACE/

echo "==> Syncing brepl..."
rsync -avz --no-owner --no-group "${RSYNC_EXCLUDES[@]}" \
    -e "ssh -p $PORT" ~/Projects/brepl $USER@$IP:$WORKSPACE/

echo "==> Building frontend..."
$SSH "cd $WORKSPACE/mrmd/frontend && npm install && npm run build"

echo "==> Setting up API keys..."
# Write to dedicated env file (sourced by start script, works with nohup)
$SSH "cat > $WORKSPACE/mrmd/.env << 'EOF'
export PATH=\"\$HOME/.local/bin:\$PATH\"
export ANTHROPIC_API_KEY='$ANTHROPIC_API_KEY'
export GROQ_API_KEY='$GROQ_API_KEY'
export OPENAI_API_KEY='$OPENAI_API_KEY'
export GEMINI_API_KEY='$GEMINI_API_KEY'
export OPENROUTER_API_KEY='$OPENROUTER_API_KEY'
EOF"

# Create start script that sources env and runs server
$SSH "cat > $WORKSPACE/mrmd/start.sh << 'SCRIPT'
#!/bin/bash
cd \"\$(dirname \"\$0\")\"
source .env
exec uv run mrmd serve --host 0.0.0.0 --port 8000 --ai-port 15785 \"\$@\"
SCRIPT
chmod +x $WORKSPACE/mrmd/start.sh"

# Also add to bashrc for interactive sessions
$SSH "grep -q 'source $WORKSPACE/mrmd/.env' ~/.bashrc || echo 'source $WORKSPACE/mrmd/.env 2>/dev/null || true' >> ~/.bashrc"

echo ""
echo "=========================================="
echo "  Deployment complete!"
echo "=========================================="
echo ""
echo "Start the server (foreground):"
echo "    ssh -p $PORT $USER@$IP '$WORKSPACE/mrmd/start.sh'"
echo ""
echo "Start the server (background):"
echo "    ssh -p $PORT $USER@$IP 'nohup $WORKSPACE/mrmd/start.sh > /tmp/mrmd.log 2>&1 &'"
echo ""
echo "Access at: http://$IP:8000"
