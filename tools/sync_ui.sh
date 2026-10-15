#!/bin/sh
# Copy the PC app's interface into www/ui/ unchanged. The phone app runs these same files; www/js/boot.js answers
# their /api requests on the device and www/js/phone-ui.js swaps in the phone's own screens where they differ.
#   sh tools/sync_ui.sh /path/to/character-forge     (the PC app's repository)
set -e
PC="${1:?usage: sh tools/sync_ui.sh /path/to/character-forge}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
for f in theme.js dice.js app.js gear.js options.js feats.js story.js play.js companions.js levelup.js phone.js offline.js style.css; do
  cp "$PC/app/static/$f" "$HERE/www/ui/$f"
done
echo "Copied the PC interface into www/ui/. Bump VERSION in www/sw.js."
