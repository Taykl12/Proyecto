import { createServer } from "node:http";
import os from "node:os";
import { createApp } from "./app.js";
import { config } from "./config.js";

function logNetworkAddresses(port: number): void {
  const urls: string[] = [`http://127.0.0.1:${port}`];
  const nets = os.networkInterfaces();

  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      urls.push(`http://${entry.address}:${port}`);
    }
  }

  console.log("API escuchando en:");
  for (const url of urls) {
    console.log(`  ${url}`);
  }
  console.log("ESP32: usá la IP de tu PC en la red WiFi (no 127.0.0.1).");
}

const app = createApp();
const server = createServer(app);

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

server.listen(config.port, "0.0.0.0", () => {
  logNetworkAddresses(config.port);
});
