#!/bin/sh
# Vercel build: copy the app into dist/ and write js/config.local.js from the
# SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY environment variables set in the Vercel project.
# Without them the site still works, storing reviews in the browser only.
set -e

rm -rf dist
mkdir -p dist
cp -R css js lib img dist/
cp RefCheck.html dist/index.html
cp RefCheck.html dist/RefCheck.html

if [ -n "$SUPABASE_URL" ] && [ -n "$SUPABASE_PUBLISHABLE_KEY" ]; then
  cat > dist/js/config.local.js <<EOF
// Generated at build time from Vercel environment variables.
window.RC_CONFIG = {
  supabaseUrl: '$SUPABASE_URL',
  supabaseKey: '$SUPABASE_PUBLISHABLE_KEY'
};
EOF
  echo "Supabase config written for $SUPABASE_URL"
else
  rm -f dist/js/config.local.js
  echo "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set: building without Supabase (browser storage only)"
fi
