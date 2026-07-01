#!/bin/sh
# Run after editing the game to push changes into the Android project.
set -e
SRC="${1:-..}"   # path to the DRIFTDREAM game source (default: parent folder)
rm -rf www && mkdir -p www/js
cp "$SRC/index.html" www/
cp -r "$SRC/js/." www/js/
npx cap sync android
echo "Synced. Now build:  cd android && ./gradlew assembleDebug"
