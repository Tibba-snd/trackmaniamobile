@echo off
REM Run after editing the game to push changes into the Android project.
set SRC=%1
if "%SRC%"=="" set SRC=..
rmdir /s /q www 2>nul
mkdir www\js
copy "%SRC%\index.html" www\ >nul
xcopy "%SRC%\js" www\js /e /i /y >nul
call npx cap sync android
echo Synced. Now build:  cd android ^&^& gradlew assembleDebug
