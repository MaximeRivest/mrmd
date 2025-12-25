#!/bin/bash
# Bundle Python + mrmd + dependencies for Electron app
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ELECTRON_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$ELECTRON_DIR")"
BUNDLE_DIR="$ELECTRON_DIR/bundled"

echo "=== MRMD Python Bundler ==="
echo "Project: $PROJECT_DIR"
echo "Bundle:  $BUNDLE_DIR"

# Clean previous bundle
rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

# Detect platform
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
    Darwin)
        PLATFORM="macos"
        ;;
    Linux)
        PLATFORM="linux"
        ;;
    *)
        echo "Unsupported OS: $OS"
        exit 1
        ;;
esac

case "$ARCH" in
    x86_64)
        ARCH="x86_64"
        ;;
    arm64|aarch64)
        ARCH="aarch64"
        ;;
    *)
        echo "Unsupported arch: $ARCH"
        exit 1
        ;;
esac

echo "Platform: $PLATFORM-$ARCH"

# Step 1: Install standalone Python using uv
echo ""
echo "=== Step 1: Installing standalone Python ==="
PYTHON_VERSION="3.12"

# Use uv to fetch a standalone Python
uv python install "$PYTHON_VERSION" --preview

# Find the installed Python path
PYTHON_PATH=$(uv python find "$PYTHON_VERSION")
PYTHON_DIR=$(dirname "$(dirname "$PYTHON_PATH")")

echo "Python found at: $PYTHON_PATH"
echo "Python dir: $PYTHON_DIR"

# Copy Python to bundle (dereference symlinks for portability)
echo "Copying Python to bundle..."
cp -RL "$PYTHON_DIR" "$BUNDLE_DIR/python"

# Make sure python binary is executable
chmod +x "$BUNDLE_DIR/python/bin/python"*

# Step 2: Create venv and install dependencies
echo ""
echo "=== Step 2: Creating venv and installing dependencies ==="

BUNDLED_PYTHON="$BUNDLE_DIR/python/bin/python3"

# Create venv
"$BUNDLED_PYTHON" -m venv "$BUNDLE_DIR/venv"

# Fix venv symlinks to use relative paths (for portability)
echo "Making venv portable..."
cd "$BUNDLE_DIR/venv/bin"

# Remove existing symlinks and create relative ones pointing to bundled python
rm -f python python3 python3.12
ln -s ../../python/bin/python3.12 python3.12
ln -s python3.12 python3
ln -s python3 python

cd - > /dev/null

# Update pyvenv.cfg to use relative path
cat > "$BUNDLE_DIR/venv/pyvenv.cfg" << EOF
home = ../python/bin
include-system-site-packages = false
version = 3.12
executable = ../python/bin/python3.12
EOF

# Activate and install
VENV_PIP="$BUNDLE_DIR/venv/bin/pip"
VENV_PYTHON="$BUNDLE_DIR/venv/bin/python"

# Set PYTHONHOME to help Python find its stdlib
export PYTHONHOME="$BUNDLE_DIR/python"

# Upgrade pip
"$VENV_PIP" install --upgrade pip

# Install brepl first (it's a local dependency)
echo "Installing brepl..."
"$VENV_PIP" install "$PROJECT_DIR/../brepl"

# Install mrmd
echo "Installing mrmd..."
"$VENV_PIP" install "$PROJECT_DIR"

# Install ai-server (optional, for AI features)
if [ -d "$PROJECT_DIR/ai-server" ]; then
    echo "Installing ai-server..."
    "$VENV_PIP" install "$PROJECT_DIR/ai-server" || echo "Warning: ai-server install failed (may be ok)"
fi

# Step 3: Copy source code and frontend
echo ""
echo "=== Step 3: Copying source code and frontend ==="
mkdir -p "$BUNDLE_DIR/src"
cp -R "$PROJECT_DIR/src/mrmd" "$BUNDLE_DIR/src/"
cp "$PROJECT_DIR/pyproject.toml" "$BUNDLE_DIR/src/"

# Copy frontend files (served by Python server)
echo "Copying frontend..."
cp -R "$PROJECT_DIR/frontend" "$BUNDLE_DIR/"

# Step 3b: Copy AI server project (dspy-cli needs full project structure)
echo "Copying AI server project..."
if [ -d "$PROJECT_DIR/ai-server" ]; then
    mkdir -p "$BUNDLE_DIR/ai-server"
    cp "$PROJECT_DIR/ai-server/dspy.config.yaml" "$BUNDLE_DIR/ai-server/"
    cp -R "$PROJECT_DIR/ai-server/src" "$BUNDLE_DIR/ai-server/"
    echo "AI server project copied"
fi

# Step 4: Bundle uv binary
echo ""
echo "=== Step 4: Bundling uv ==="
UV_PATH=$(which uv)
if [ -n "$UV_PATH" ]; then
    # Resolve symlinks
    UV_REAL=$(readlink -f "$UV_PATH" 2>/dev/null || realpath "$UV_PATH" 2>/dev/null || echo "$UV_PATH")
    cp "$UV_REAL" "$BUNDLE_DIR/python/bin/uv"
    chmod +x "$BUNDLE_DIR/python/bin/uv"
    echo "Bundled uv from: $UV_REAL"
else
    echo "WARNING: uv not found, skipping"
fi

# Step 5: Create launcher script
echo ""
echo "=== Step 4: Creating launcher ==="
cat > "$BUNDLE_DIR/run-server.sh" << 'EOF'
#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="$SCRIPT_DIR/venv/bin:$SCRIPT_DIR/python/bin:$PATH"
exec "$SCRIPT_DIR/venv/bin/python" -m mrmd.cli.main serve "$@"
EOF
chmod +x "$BUNDLE_DIR/run-server.sh"

# Step 5: Report bundle size
echo ""
echo "=== Bundle Complete ==="
du -sh "$BUNDLE_DIR"
du -sh "$BUNDLE_DIR"/*

echo ""
echo "Test with: $BUNDLE_DIR/run-server.sh --port 8765"
