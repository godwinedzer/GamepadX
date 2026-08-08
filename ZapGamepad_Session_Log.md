# 🎮 ZapGamepad: Project Session Log

## 1. System Architecture (How it Works)
The system is divided into two parts: a **Mobile Client** and a **Rust Server**.

*   **Client (Android)**: Built with React Native & Expo. It captures your touches and joystick movements, converts them into a 24-byte binary packet, and blasts them over the local network via **UDP** (User Datagram Protocol).
*   **Server (Windows PC)**: Built with Rust. It listens on Port **8888**. When a packet arrives, it uses the **ViGEmBus Driver** to simulate a physical Xbox 360 Controller. 
*   **Integration**: Games see a standard "Xbox 360 Controller" and do not know an app is involved.

## 2. Security & Networking
*   **Local Only**: Data never leaves your WiFi. It goes directly from Phone → Router → PC.
*   **Low Latency**: We use UDP instead of TCP. UDP is "fire and forget," meaning there is zero delay waiting for handshakes.
*   **Validation**: Every packet starts with a **Magic Byte (0x47)**. The server ignores any data that doesn't start with this signature.

## 3. Command History & Troubleshooting

| Phase | Command | Result | Explanation/Fix |
| :--- | :--- | :--- | :--- |
| **Cloud Build** | `eas build --platform android` | **Queued / In Progress** | Handled by Expo servers to avoid local SDK issues. |
| **Local Attempt 1** | `npx expo run:android` | **FAILED (Error 9009)** | Missing Java. The computer couldn't find `java.exe`. |
| **Local Attempt 2** | `npx expo run:android` | **FAILED (Version 70)** | Installed Java 26. Too new for Gradle/React Native. |
| **Java Fix** | `java -version` | **SUCCESS** | Reinstalled **JDK 17** (Temurin). Correct version detected. |
| **Path Error** | `npx expo run:android` | **FAILED (Invalid javaHome)** | System was still looking in the old Java 26 folder. |
| **Server Test** | `cargo run` | **SUCCESS ✅** | Server is live and listening on port 8888. |

## 4. UI Upgrades (V2.0)
While the build was processing, we upgraded `App.js` with:
*   **Spring Physics**: The joystick knob now physically slides and snaps back to center.
*   **Haptic Feedback**: "Medium" vibration impact on button presses; "Success" vibration on connection.
*   **Memory**: The app now uses `AsyncStorage` to remember your PC's IP address automatically.

## 5. Final Checklist for Launch
1.  **PC IP**: Find your IPv4 address using `ipconfig`.
2.  **Firewall**: Ensure UDP Port 8888 is allowed.
3.  **Install APK**: Download the finished build from the EAS dashboard once it says "Finished."
4.  **Connect**: Type IP into the app and start gaming.
