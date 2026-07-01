# DRIFTDREAM — Android APK build

This folder is a Capacitor (https://capacitorjs.com) wrapper around the DRIFTDREAM
HTML/JS game. The game itself lives in `www/` (a copy of `index.html` + `js/`).
The native Android project is in `android/`.

The final compile needs Google's Maven servers + the Android SDK, which the Cowork
sandbox can't reach — so the build happens either in the cloud (no setup) or on
your own machine.

## Option A — Build in the cloud (recommended, no tools to install)

1. Create a new GitHub repo and push this whole folder to it.
2. GitHub Actions runs `.github/workflows/android.yml` automatically on push.
3. When it finishes (~3-5 min), open the run under the **Actions** tab and download
   the **driftdream-debug-apk** artifact. Inside is `app-debug.apk`.
4. Copy that APK to your phone and install it (see "Install on your phone").

You can also trigger it manually from the Actions tab via **Run workflow**.

## Option B — Build locally

Requirements: **JDK 17**, **Android SDK** (Android Studio bundles both),
and **Node 18+**.

    npm install            # restores node_modules (already included; safe to re-run)
    cd android
    ./gradlew assembleDebug        # Windows: gradlew assembleDebug

The APK lands at:

    android/app/build/outputs/apk/debug/app-debug.apk

Or open the `android/` folder in Android Studio and press **Run** with your phone
plugged in.

## Install on your phone

This is an unsigned **debug** APK (fine for testing, not for the Play Store).

1. Copy `app-debug.apk` to the phone (USB, Drive, email to yourself, etc.).
2. Tap it. Android will ask to allow installs from this source — approve it.
3. Launch **DRIFTDREAM**.

From a computer with adb:  adb install app-debug.apk

## After you edit the game

The game in `www/` is a copy. When you change the source `index.html`/`js/`,
re-sync before rebuilding:

    ./sync.sh ..        # macOS/Linux - pass the path to the game source
    sync.bat ..         # Windows

(`..` assumes this build folder sits inside the game folder; adjust if not.)

## Details

- App name: **DRIFTDREAM**  |  App ID: com.driftdream.game
- Capacitor 6 | compileSdk 34 | minSdk 22 | Gradle 8.2.1
- Orientation/permissions: edit android/app/src/main/AndroidManifest.xml
