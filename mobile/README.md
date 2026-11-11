# ReFlow Android app

The ReFlow Android app is a native shell (Capacitor 8) around the ReFlow web app. Pages load directly from the ReFlow server, so the login session, every page and each new web release work in the app without reinstalling it.

Native features:

- **GPS** through the native location service (`@capacitor/geolocation`). Tanker live tracking and "use my location" work reliably, including on servers without HTTPS.
- **Google Maps navigation**: tanker partners hand off to the Google Maps app for turn-by-turn directions.
- The ReFlow launcher icon, a splash screen, and an offline screen with a retry button when the server can't be reached.

## Building

Requirements: Node.js 18+, the Android SDK and JDK 21.

```bash
cd mobile
npm install
npm run apk      # builds android/app/build/outputs/apk/debug/app-debug.apk
npm run open     # or open the android/ project in Android Studio
```

## Choosing the server

The app loads the server set in `REFLOW_SERVER_URL` when it is built:

| Target | Command |
|---|---|
| Android emulator, server on the same computer (default) | `npm run apk` (uses `http://10.0.2.2:10000`) |
| Phone on the same Wi-Fi network | `REFLOW_SERVER_URL=http://<computer-LAN-IP>:10000 npm run apk` |
| Production | `REFLOW_SERVER_URL=https://<your-domain> npm run apk` |

Install on a connected phone or emulator with `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

A Play Store release additionally needs a signing key and `./gradlew bundleRelease`.
