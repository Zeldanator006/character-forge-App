#!/usr/bin/env sh
# Rebuild www/vendor from the pinned devDependencies in package.json (run after changing their versions).
# The output is committed, so the app itself still needs no build step.
set -e
cd "$(dirname "$0")/.."
npx esbuild tools/anthropic-entry.mjs --bundle --format=esm --platform=browser --minify --legal-comments=eof \
  --outfile=www/vendor/anthropic-sdk.mjs
cp node_modules/pdfjs-dist/build/pdf.min.mjs www/vendor/pdf.min.mjs
cp node_modules/pdfjs-dist/build/pdf.worker.min.mjs www/vendor/pdf.worker.min.mjs
cp node_modules/pdfjs-dist/LICENSE www/vendor/pdfjs-LICENSE.txt
cp node_modules/@anthropic-ai/sdk/LICENSE www/vendor/anthropic-sdk-LICENSE.txt
# pdf-lib makes the PDF character sheets on the device (it carries the standard 14 fonts' metrics, Times and Helvetica)
npx esbuild node_modules/pdf-lib/es/index.js --bundle --format=esm --platform=browser --minify --legal-comments=eof \
  --outfile=www/vendor/pdf-lib.mjs
cp node_modules/pdf-lib/LICENSE.md www/vendor/pdf-lib-LICENSE.txt
echo "Vendored: $(ls www/vendor | tr '\n' ' ')"
