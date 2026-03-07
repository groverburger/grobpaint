#!/bin/bash
set -e

echo "=== Building GrobPaint ==="

VENV_DIR=".venv"

# Create venv if needed
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

source "$VENV_DIR/bin/activate"

# Install dependencies
pip install -q pyinstaller pywebview

# Clean previous build
rm -rf build dist

# Build
pyinstaller grobpaint.spec

echo ""
echo "=== Build complete ==="
echo "App:    dist/GrobPaint.app"
echo "Binary: dist/GrobPaint/GrobPaint"
