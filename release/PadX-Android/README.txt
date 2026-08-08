PadX Android Release

File:
- app-release.apk

Install using ADB:
adb install -r app-release.apk

If install fails because an older signed build exists:
adb uninstall com.eren_1042.padx
adb install app-release.apk
