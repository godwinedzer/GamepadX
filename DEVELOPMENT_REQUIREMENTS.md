# ZapGamepad Development and Testing Requirements

This project has two parts:
- `client/`: React Native + Expo Android controller app
- `server/`: Rust Windows host that exposes a virtual Xbox 360 controller through ViGEmBus

## Supported Host Setup

### PC for server and end-to-end testing
- Windows 10 or Windows 11
- Administrator access for installing drivers and Android tooling
- Same local network as the Android phone during live testing

### Phone for client testing
- Android device with real multi-touch support
- Developer options enabled for USB debugging when using local builds

## Required Software

### Core development tools
- Node.js 24.x or newer LTS-compatible release
- npm 10+
- Rust stable toolchain (`rustup`, `cargo`)
- Git

### Android / Expo toolchain
- Java Development Kit 17
- Android Studio with:
  - Android SDK
  - Platform Tools (`adb`)
  - Build Tools required by the installed Expo/React Native version
- Expo CLI via `npx expo ...`
- Optional but recommended: EAS CLI for cloud APK builds

### Windows gamepad / input dependencies
- ViGEmBus driver installed on the Windows PC
- Microsoft Visual C++ build tools if Rust crates or native modules require them

### Recommended testing utilities
- `adb` for device detection, logs, and app install
- `scrcpy` for viewing and controlling the Android device from the PC during testing
- Windows Defender Firewall access to allow UDP port `8888`
- `cargo` for server verification
- `npm` / `npx expo` for client verification

## Project-specific Notes

### Client (`client/`)
- Uses `react-native-udp`, so test with a development build on Android rather than assuming Expo Go support
- Stores the last used server IP in AsyncStorage
- Sends a 24-byte UDP packet at about 60 Hz

### Server (`server/`)
- Listens on UDP port `8888`
- Requires ViGEmBus to create the virtual Xbox 360 controller
- Mouse mode also maps D-pad directions to keyboard arrow keys on Windows

## Verified Input Behavior Expectations

The intended behavior is:
- one button can stay held while another button is pressed
- joystick movement can happen while buttons are held
- trigger rapid-fire should stop cleanly when the mode is turned off
- switching out of mouse mode should not leave arrow keys stuck down

## Development Commands

### Client
```bash
cd client
npm install
npx expo start
npx expo run:android
npm run lint
```

### Server
```bash
cd server
cargo check
cargo run
```

## Manual Test Checklist

1. Start the Rust server on the Windows PC.
2. Confirm ViGEmBus is installed and the server starts without plugin errors.
3. Build/install the Android client on a real phone.
4. Enter the PC IPv4 address in the app.
5. Hold one face button and press another face button; both actions should register.
6. Hold a D-pad direction in mouse mode, then switch back to controller mode; no arrow key should remain stuck.
7. Hold LT or RT, enable rapid fire, then disable rapid fire while still holding; the trigger should return to a stable held state and release normally.
8. Disconnect from the app; the server should return to neutral input.

## Optional Tools

These are not required, but help during debugging:
- Python 3.11+ for ad-hoc packet inspection or local scripts
- Wireshark for UDP packet inspection on port `8888`
- PowerShell 7 for easier Windows-side scripting

## Known Constraints

- The server implementation is Windows-specific because it depends on ViGEmBus and Windows input APIs.
- Reliable multi-touch validation should be done on a real Android device, not just an emulator.
- Connectivity in the current app is optimistic on connect; the client can open a UDP socket without proving the server is reachable.
