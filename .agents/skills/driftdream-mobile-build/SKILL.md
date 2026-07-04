---
name: driftdream-mobile-build
description: Handles the Android Capacitor wrapper project, syncing code changes, compiling APKs using Gradle, and troubleshooting mobile WebView issues.
---

# DRIFTDREAM Android and Capacitor Mobile Builds

This skill covers the wrapper project used to deploy DRIFTDREAM to Android devices.

## File Map
- **Android Root Directory:** `apk-build/`
- **Sync Directory:** `apk-build/www/` (contains copies of `index.html` and `js/`)
- **Android Studio Project:** `apk-build/android/`
- **Sync Scripts:** `apk-build/sync.bat` (and the cross-platform Node sync command in `dd.js`)

## Build Workflow
To deploy updates to a mobile device or test inside an Android emulator:
1. **Sync Source Files:**
   Editing the root files in `js/` or `index.html` does **NOT** update the mobile wrapper automatically. You must copy the latest assets to `apk-build/www/` and sync Capacitor config:
   ```bash
   # Using the CLI tool:
   node dd.js sync
   ```
2. **Compile the APK:**
   Use Gradle to build the Android debug package:
   ```bash
   cd apk-build/android
   ./gradlew assembleDebug
   ```
   *Note: This requires a valid Java Development Kit (JDK) and Android SDK on the host machine.*

## Mobile Performance & WebView Tuning
- **Antialiasing:** Capped or off on low/medium quality options to maintain steady 60 FPS on mobile chips.
- **Render Resolution:** Capped at `1.5` device pixel ratio on high settings, and `1.25` on medium.
- **Cache-Busting:** When modifying `index.html` or scripts, make sure to bump the cache-buster query parameters (`?v=XX`) on script imports.
- **Backdrop Blur:** Avoid CSS `backdrop-filter: blur()` during active play as it severely degrades performance on Android WebView engines.
