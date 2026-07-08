import { createServer } from "node:http";
import os from "node:os";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createAdminClient } from "./lib/supabase.js";
import { deleteTemplate } from "./lib/fingerprintTemplates.js";
import { setDeleteTimeoutCleanup } from "./lib/fingerprintState.js";

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

setDeleteTimeoutCleanup(async (userId) => {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("usuarios")
    .update({ huella_id: null })
    .eq("id_usuario", userId);
  if (error) throw new Error(error.message);
  try {
    await deleteTemplate(userId);
  } catch (templateError) {
    console.warn(
      `[fingerprint] No se pudo borrar template tras timeout delete (user=${userId}):`,
      templateError instanceof Error ? templateError.message : templateError
    );
  }
  console.warn(
    `[fingerprint] huella_id limpiado en BD tras timeout delete (user=${userId})`
  );
});

const app = createApp();
const server = createServer(app);

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 30_000;

server.listen(config.port, "0.0.0.0", () => {
  logNetworkAddresses(config.port);
});
