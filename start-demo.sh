#!/bin/bash
# AEGIS Demo Startup Script

echo "🛡️ Starting AEGIS Local AI Server..."
echo "------------------------------------"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/server"

USE_MOCK=0
if [ "$1" == "--mock" ] || [ "$1" == "-m" ]; then
  USE_MOCK=1
  echo "🟡 Running in MOCK mode (--mock specified)..."
elif curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "✅ Ollama is running on http://localhost:11434"
else
  echo "⚠️ Ollama is NOT running on http://localhost:11434."
  echo "👉 Starting in MOCK mode so judges can test immediately without Ollama!"
  echo "   (To use real Ollama: run 'ollama serve' in another terminal and re-run)"
  USE_MOCK=1
fi

echo "🚀 Server starting on http://localhost:8000"
echo "You can now use the AEGIS Chat Assistant in the Chrome extension!"
echo "Press Ctrl+C to stop the server."
echo "------------------------------------"

if [ "$USE_MOCK" -eq 1 ]; then
  node index.js --mock
else
  node index.js
fi
