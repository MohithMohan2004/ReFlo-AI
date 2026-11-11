import type { CapacitorConfig } from "@capacitor/cli";
import { writeFileSync } from "node:fs";

// The app is a native shell around the ReFlow web app served by Flask.
// Flask keeps the login in a session cookie, so the WebView loads pages
// straight from the server instead of bundling them.
//
//   Android emulator -> http://10.0.2.2:10000 (the host machine's localhost)
//   Physical phone   -> REFLOW_SERVER_URL=http://<your-LAN-IP>:10000 npm run sync
//   Production       -> REFLOW_SERVER_URL=https://<deployed-host> npm run sync
const serverUrl = process.env.REFLOW_SERVER_URL ?? "http://10.0.2.2:10000";

// The offline page's "Try again" button needs the server address.
writeFileSync("www/server.js", `window.REFLOW_SERVER_URL = ${JSON.stringify(serverUrl)};\n`);

const config: CapacitorConfig = {
  appId: "in.reflow.app",
  appName: "ReFlow",
  webDir: "www",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    androidScheme: "https",
    // Shown when the server can't be reached.
    errorPath: "offline.html",
  },
  android: {
    allowMixedContent: serverUrl.startsWith("http://"),
    backgroundColor: "#ffffff",
  },
};

export default config;
