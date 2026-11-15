import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync, writeFileSync } from "node:fs";

// The app is a native shell around the ReFlow web app served by Flask.
// Flask keeps the login in a session cookie, so the WebView loads pages
// straight from the server instead of bundling them.
//
//   Production (default) -> https://reflow-w9xu.onrender.com (Render)
//   Android emulator     -> REFLOW_SERVER_URL=http://10.0.2.2:10000 npm run sync (host's localhost)
//   Physical phone       -> REFLOW_SERVER_URL=http://<your-LAN-IP>:10000 npm run sync
const serverUrl = process.env.REFLOW_SERVER_URL ?? "https://reflow-w9xu.onrender.com";

// The offline page needs the server address to reconnect. It is written into
// the page itself: Android shows that page under the server's origin, so a
// separate script file would be fetched from the (unreachable) server.
writeFileSync("www/server.js", `window.REFLOW_SERVER_URL = ${JSON.stringify(serverUrl)};\n`);
const offline = readFileSync("www/offline.html", "utf8").replace(
  /window\.REFLOW_SERVER_URL = "[^"]*";/,
  `window.REFLOW_SERVER_URL = ${JSON.stringify(serverUrl)};`,
);
writeFileSync("www/offline.html", offline);

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
