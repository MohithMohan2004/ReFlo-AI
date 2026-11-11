# ReFlow Android app

A native Android shell (Capacitor 8) around the ReFlow web app. The WebView loads
pages straight from the Flask server, so every page, the login session and new
web releases work in the app without rebuilding it. Native additions:

- **GPS** through `@capacitor/geolocation`. `frontend/src/lib/nativeGeolocation.ts`
  routes `navigator.geolocation` to it inside the app, so tanker live tracking and
  "use my location" work even over plain http (Android's WebView blocks browser
  geolocation on insecure origins).
- ReFlow launcher icon (adaptive, vector) and splash screen.
- An offline screen with a retry button when the server can't be reached.

## Build

Needs the Android SDK (`~/Android/Sdk`) and JDK 21. Android Studio's bundled JBR is
newer than the plugins support, so point `JAVA_HOME` at a JDK 21.

```bash
export PATH=~/.local/node/bin:$PATH JAVA_HOME=~/.local/jdk21 ANDROID_HOME=~/Android/Sdk
cd mobile
npm install --registry=https://registry.yarnpkg.com/
npm run apk          # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run open         # or open the android/ project in Android Studio
```

## Which server the app loads

Set when syncing (`npm run sync` / `npm run apk`):

| Target | Command |
|---|---|
| Android emulator, Flask on this machine (default) | `npm run apk` (uses `http://10.0.2.2:10000`) |
| Phone on the same Wi-Fi | `REFLOW_SERVER_URL=http://<your-LAN-IP>:10000 npm run apk` |
| Production | `REFLOW_SERVER_URL=https://<deployed-host> npm run apk` |

Flask already listens on `0.0.0.0`, so a phone on the LAN can reach it.
Install on a connected phone with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

A Play Store release needs a signing key and `./gradlew bundleRelease`; that isn't set up yet.
