# 🎮 ZapGamepad (PadX)

ZapGamepad (commercially packaged as **PadX**) is a low-latency, real-time virtual game controller system. It allows you to use a multi-touch Android device as a high-performance Xbox 360 controller on a Windows PC over your local network.

---

## ⚡ System Architecture

The project consists of two core components communicating over a local network:

```mermaid
graph LR
    subgraph Android Device (Client)
        A[React Native UI] -->|Spring Physics & Touch Events| B[GamepadNetwork.js]
        B -->|24-byte UDP Packet| C[Local Network / UDP 8888]
    end
    
    subgraph Windows PC (Server)
        C -->|Raw UDP Socket| D[Rust Server / Async UDP Reader]
        D -->|Overwriting Bounded Queue| E[120Hz Input Injection Loop]
        E -->|ViGEmBus Driver| F[Virtual Xbox 360 Controller]
        F -->|OS Input Event| G[Native PC Games]
    end
```

### 1. Mobile Client (`client/`)
* **Framework**: React Native + Expo.
* **UI/UX**: Custom joystick using spring physics (`animated` API) that snaps back to center on release, accompanied by haptic feedback.
* **Network**: Blasts raw binary packets over a local UDP socket to target port `8888` at ~60Hz for zero-handshake, low-latency performance.
* **Config Persistence**: Automatically persists the last successfully entered host IP using `AsyncStorage`.

### 2. Host Server (`server/`)
* **Language**: Rust (utilizing `tokio` for async network I/O and `crossbeam-channel` for lock-free queuing).
* **Driver Integration**: Simulates a physical Xbox 360 Controller by interfacing directly with the Windows kernel-level **ViGEmBus** driver.
* **Smart Discoverability**: Automatically detects the PC's local network IPv4 address on start and renders a high-contrast **QR Code** directly in the console for easy scanning.
* **Raw Inputs & Acceleration**: Temporarily overrides Windows "Enhance Pointer Precision" (pointer acceleration) during mouse emulation mode to ensure linear, predictable cursor control, and cleanly restores it on exit.
* **120Hz Loop**: Runs a dedicated thread-local input injection loop at 120Hz, draining the network packet queue and executing state neutralization if no packet is received for >100ms.

---

## 📑 Custom Binary UDP Protocol

To achieve minimal network overhead, the client transmits inputs using a lightweight **24-byte C-packed structure**:

| Byte Offset | Data Type | Field | Description |
| :--- | :--- | :--- | :--- |
| `0` | `u8` | `magic` | Header validation signature (`0x47`) |
| `1` | `u8` | `version` | Protocol version (`0x01`) |
| `2` | `u8` | `player_id` | Assigned player ID (supports local multiplayer) |
| `3` | `u8` | `flags` | Special state flags |
| `4 - 7` | `u32` | `sequence` | Incremental packet sequence ID (drops stale out-of-order packets) |
| `8 - 9` | `u16` | `buttons` | Bitmask representing Xbox 360 face and utility buttons |
| `10 - 11` | `i16` | `left_stick_x` | Left Stick X-axis alignment (`-32768` to `32767`) |
| `12 - 13` | `i16` | `left_stick_y` | Left Stick Y-axis alignment (`-32768` to `32767`) |
| `14 - 15` | `i16` | `right_stick_x` | Right Stick X-axis alignment (`-32768` to `32767`) |
| `16 - 17` | `i16` | `right_stick_y` | Right Stick Y-axis alignment (`-32768` to `32767`) |
| `18` | `u8` | `left_trigger` | Left trigger analog value (`0` to `255`) |
| `19` | `u8` | `right_trigger` | Right trigger analog value (`0` to `255`) |
| `20 - 23` | `u32` | `timestamp` | Client timestamp (milliseconds) |

### Button Bitmasks
```rust
D_UP         = 0x0001
D_DOWN       = 0x0002
D_LEFT       = 0x0004
D_RIGHT      = 0x0008
START        = 0x0010
BACK         = 0x0020
L_THUMB      = 0x0040
R_THUMB      = 0x0080
L_SHOULDER   = 0x0100
R_SHOULDER   = 0x0200
GUIDE        = 0x0400
A            = 0x1000
B            = 0x2000
X            = 0x4000
Y            = 0x8000
```

---

## 🛠️ Requirements & Dependencies

### Windows PC (Server Host)
1. **ViGEmBus Driver**: You must have the [ViGEmBus driver](https://github.com/ViGEm/ViGEmBus/releases) installed on your PC.
2. **Firewall**: Windows Firewall must allow incoming UDP packets on port `8888`.
3. **C++ Build Tools**: Required by Rust crates interfacing with Windows APIs.

### Mobile Client Build Tools
- **Node.js**: `24.x` (LTS) or newer.
- **JDK**: `17` (strictly required for local Android/Gradle builds).
- **Android Studio**: Installed with Android SDK Platform-Tools (`adb` path added to env variables).

---

## 🚀 Quick Start

### 1. Launching the Windows Server
```bash
cd server
cargo run --release
```
The server will boot, display your local IP, show a QR code for quick connections, and start listening on UDP port `8888`.

### 2. Launching the Client Dev Server
```bash
cd client
npm install
npx expo start
```
Run `npx expo run:android` to deploy a development build to your USB-connected Android device.

---

## 📦 Distribution Packages (`release/`)
Staged artifacts are grouped as follows:
- **`release/PadX-Android/`**: Contains `app-release.apk` for direct sideloading on your device.
- **`release/PadX-Windows/`**: Contains compiled `server.exe` and a quick-launch `start_server.bat` script.
