# PadX Release and Packaging Guide

This guide explains how to turn this project into:
- an Android app package (`.apk`)
- a Windows server executable (`.exe`)
- a simple handoff-ready release folder

Project folders:
- `D:\gamepad\client` = Android controller app
- `D:\gamepad\server` = Windows UDP / virtual gamepad server

## 1. Prerequisites

### Windows PC
Install and verify:
- Node.js
- npm
- Rust (`cargo`, `rustup`)
- Android Studio
- Android SDK + Platform Tools (`adb`)
- Java 17
- Visual Studio C++ build tools
- ViGEmBus driver

Quick checks:

```powershell
node -v
npm -v
cargo -V
rustup -V
adb version
java -version
where link
```

## 2. Verify project requirements

From project root:

```powershell
cd D:\gamepad
.\check_requirements.bat
```

If something is missing, fix that first before building release artifacts.

## 3. Build the Android app (development)

Use this when testing on your phone locally.

```powershell
cd D:\gamepad\client
npm install
npx expo start --clear
```

In another terminal:

```powershell
cd D:\gamepad\client
npm run android
```

## 4. Build the Android app (release APK)

This creates an installable APK file.

```powershell
cd D:\gamepad\client\android
.\gradlew.bat assembleRelease
```

Output file:

```text
D:\gamepad\client\android\app\build\outputs\apk\release\app-release.apk
```

## 5. Install the Android release APK manually

With phone connected and USB debugging enabled:

```powershell
adb devices
adb install -r D:\gamepad\client\android\app\build\outputs\apk\release\app-release.apk
```

If install fails because of old signature/package mismatch:

```powershell
adb uninstall com.eren_1042.padx
adb install D:\gamepad\client\android\app\build\outputs\apk\release\app-release.apk
```

## 6. Optional: Build Android with EAS

If you want cloud builds later:

```powershell
cd D:\gamepad\client
npx eas login
npx eas build -p android --profile preview
npx eas build -p android --profile production
```

Current EAS config file:
- `D:\gamepad\client\eas.json`

## 7. Build the Windows server EXE

Open a terminal where Rust can find the MSVC linker.

Recommended: use a Developer PowerShell / Developer Command Prompt.

Then run:

```powershell
cd D:\gamepad\server
cargo build --release
```

Output file:

```text
D:\gamepad\server\target\release\server.exe
```

Debug symbols file:

```text
D:\gamepad\server\target\release\server.pdb
```

## 8. Run the Windows server locally

```powershell
cd D:\gamepad\server
cargo run
```

Or run the release binary directly:

```powershell
cd D:\gamepad\server\target\release
.\server.exe
```

## 9. End-to-end local test

### Start server on PC

```powershell
cd D:\gamepad\server\target\release
.\server.exe
```

### Start Android app
- Install APK on phone
- Open app
- Enter PC local IP shown by server
- Connect

### Test checklist
- D-pad works
- left and right sticks work
- ABXY work in correct order
- LT and RT work
- multi-touch works with 2-3 simultaneous presses
- disconnect returns input to neutral

## 10. Create a simple release folder

Suggested folder structure:

```text
D:\gamepad\release\
  PadX-Android\
    app-release.apk
  PadX-Windows\
    server.exe
    server.pdb
    README.txt
    start_server.bat
```

Create it with:

```powershell
cd D:\gamepad
mkdir release -Force
mkdir release\PadX-Android -Force
mkdir release\PadX-Windows -Force
copy client\android\app\build\outputs\apk\release\app-release.apk release\PadX-Android\
copy server\target\release\server.exe release\PadX-Windows\
copy server\target\release\server.pdb release\PadX-Windows\
```

## 11. Create a server start script

Create `D:\gamepad\release\PadX-Windows\start_server.bat` with:

```bat
@echo off
cd /d "%~dp0"
server.exe
pause
```

## 12. Create a user-facing README for release folder

Suggested contents for `README.txt`:
- install ViGEmBus first
- allow Windows Firewall access if prompted
- run `start_server.bat`
- connect phone to same Wi-Fi
- enter PC IP shown by server in the Android app

## 13. What still needs to be done for true production release

### Android
Current release uses project release build flow, but you should still confirm:
- proper release signing key
- version bump strategy
- final app icon and branding
- uninstall/reinstall test on clean device
- one final regression test after build

### Windows
Still recommended before public sharing:
- dedicated packaged release folder
- polished `README.txt`
- optional installer
- confirm ViGEmBus install instructions are clear
- verify server launches on another Windows PC

## 14. Exact files to hand off

### Android
- `D:\gamepad\client\android\app\build\outputs\apk\release\app-release.apk`

### Windows
- `D:\gamepad\server\target\release\server.exe`
- `D:\gamepad\server\target\release\server.pdb`

## 15. Recommended final packaging flow

Use this order every time:

```powershell
cd D:\gamepad
.\check_requirements.bat

cd D:\gamepad\client\android
.\gradlew.bat assembleRelease

cd D:\gamepad\server
cargo build --release
```

Then copy outputs into a clean release folder.

## 16. Common issues

### `link.exe not found`
Use Developer PowerShell / install Visual Studio C++ tools.

### `adb` not found
Add Android SDK `platform-tools` to PATH.

### APK install conflict
Uninstall old package first:

```powershell
adb uninstall com.eren_1042.padx
```

### Server starts but controller does not work
Check:
- ViGEmBus installed
- firewall prompt allowed
- phone and PC on same network
- UDP port `8888` not blocked

## 17. Next recommended step

After this guide, create:
- a clean `release` folder
- `README.txt` for end users
- optional zipped deliverable for sharing
