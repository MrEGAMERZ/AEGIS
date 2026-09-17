#!/bin/bash
# AEGIS Demo Startup Script

echo "🛡️ Starting AEGIS Local AI Server..."
echo "------------------------------------"

# Check if Ollama is running
if curl -s http://localhost:11434/api/tags > /dev/null; then
  echo "✅ Ollama is running"
else
  echo "⚠️ Ollama is NOT running. Please start Ollama first!"
  echo "Run: ollama serve"
  exit 1
fi

# Start the Node gateway server
cd /Users/rehan/Developer/SIH/SIH26/server
echo "🚀 Server starting on http://localhost:8000"
echo "You can now use the AEGIS Chat Assistant in the Chrome extension!"
echo "Press Ctrl+C to stop the server."
echo "------------------------------------"
node index.js
