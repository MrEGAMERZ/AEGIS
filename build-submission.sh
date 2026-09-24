#!/bin/bash
echo "📦 Packaging AEGIS for Hackathon Submission..."

ZIP_NAME="AEGIS_Hackathon_Submission.zip"
rm -f $ZIP_NAME

# Zip the core extension files and server, excluding dev/hidden files
zip -r $ZIP_NAME manifest.json src/ server/ docs/ DEPLOYMENT_PLAN.md DEMO_SCRIPT_AND_PITCH.md README.md start-demo.sh package.json -x "*.git*" "*.cursor*" "*node_modules*" "*.DS_Store" "*__MACOSX*"

echo "✅ Success! Generated $ZIP_NAME"
echo "You can upload this file to the hackathon portal."
