/*
 * Classify — ESP32-C3 SuperMini
 * Heartbeat + contador del botón BOOT (GPIO 9) hacia la API Express.
 *
 * Dependencias (Arduino IDE / PlatformIO):
 *   - Board: ESP32C3 Dev Module (USB CDC On Boot: Enabled)
 *   - WiFi, HTTPClient (core ESP32)
 *
 * Credenciales en include/secrets.h (copiá secrets.h.example → secrets.h).
 * DEVICE_TOKEN debe coincidir con ESP32_DEVICE_TOKEN en server/.env
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include "secrets.h"

const char* HEARTBEAT_PATH = "/api/device/esp32/heartbeat";
const char* BUTTON_PATH = "/api/device/esp32/button";

// Botón BOOT en ESP32-C3 SuperMini
const int BOOT_BUTTON_PIN = 9;
const int LED_PIN = 8;  // LED azul onboard (activo en LOW)

const unsigned long HEARTBEAT_INTERVAL_MS = 8000;
const unsigned long HEARTBEAT_BACKOFF_MAX_MS = 30000;
const unsigned long WIFI_STABILIZE_MS = 2500;
const unsigned long DEBOUNCE_MS = 200;
const unsigned long HTTP_TIMEOUT_MS = 6000;
const unsigned long HTTP_CONNECT_TIMEOUT_MS = 3000;
const unsigned long HTTP_MIN_GAP_MS = 2000;
const unsigned long HTTP_SOCKET_SETTLE_MS = 400;
const unsigned long HTTP_LINK_PAUSE_MS = 5000;
const unsigned long BUTTON_RETRY_MS = 3000;
const unsigned long BUTTON_POST_DELAY_MS = 800;
const unsigned long BUTTON_HTTP_QUIET_MS = 12000;
const unsigned long BUTTON_MIN_INTERVAL_MS = 4000;
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 30000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
const int HTTP_FAILS_BEFORE_BACKOFF = 2;

unsigned long lastHeartbeatMs = 0;
unsigned long heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
unsigned long wifiStableAtMs = 0;
unsigned long buttonPostAtMs = 0;
unsigned long buttonCooldownUntil = 0;
unsigned long httpQuietUntil = 0;
unsigned long lastDebounceMs = 0;
unsigned long httpAvailableAtMs = 0;
unsigned long lastWifiAttemptMs = 0;
int lastButtonReading = HIGH;
int consecutiveHttpFails = 0;
bool httpBusy = false;
bool pendingButtonPost = false;
bool buttonWasHeld = false;
bool wifiReady = false;
bool wifiConnectStarted = false;
unsigned long wifiConnectStartMs = 0;

WiFiClient heartbeatClient;
HTTPClient heartbeatHttp;
bool heartbeatSessionReady = false;

void closeHeartbeatSession() {
  if (!heartbeatSessionReady) {
    return;
  }
  heartbeatHttp.end();
  heartbeatClient.stop();
  heartbeatSessionReady = false;
}

void onWiFiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      closeHeartbeatSession();
      wifiReady = false;
      wifiConnectStarted = false;
      lastWifiAttemptMs = millis();
      heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
      Serial.println("WiFi: desconectado");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      wifiStableAtMs = millis() + WIFI_STABILIZE_MS;
      heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
      Serial.println("WiFi: IP asignada");
      break;
    default:
      break;
  }
}

void printWifiError() {
  const wl_status_t status = WiFi.status();
  Serial.printf("estado WiFi=%d: ", status);
  switch (status) {
    case WL_NO_SSID_AVAIL:
      Serial.println("red no encontrada (revisá el nombre SSID)");
      break;
    case WL_CONNECT_FAILED:
      Serial.println("no pudo conectar (revisá la clave o usá red 2.4 GHz)");
      break;
    case WL_DISCONNECTED:
      Serial.println("desconectado (aún intentando o clave incorrecta)");
      break;
    default:
      Serial.println("desconocido");
      break;
  }
}

void scanNearbyNetworks() {
  WiFi.mode(WIFI_STA);
  delay(100);

  Serial.println("Redes WiFi visibles:");
  int count = WiFi.scanNetworks(false, true);
  if (count < 0) {
    Serial.println("  (escaneo falló, reintentá en unos segundos)");
    return;
  }
  if (count == 0) {
    Serial.println("  (ninguna — revisá antena/distancia/banda 2.4 GHz)");
    return;
  }

  for (int i = 0; i < count; i++) {
    Serial.printf(
      "  %s  %d dBm%s\n",
      WiFi.SSID(i).c_str(),
      WiFi.RSSI(i),
      WiFi.SSID(i) == WIFI_SSID ? "  <-- buscada" : ""
    );
  }
  WiFi.scanDelete();
}

void startWiFiConnect() {
  if (wifiConnectStarted && WiFi.status() != WL_CONNECTED) {
    return;
  }

  Serial.printf("Conectando a \"%s\"...\n", WIFI_SSID);
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  wifiConnectStarted = true;
  wifiConnectStartMs = millis();
  wifiReady = false;
  lastWifiAttemptMs = millis();
}

bool updateWiFiConnection(unsigned long now) {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiReady) {
      wifiReady = true;
      wifiConnectStarted = false;
      wifiStableAtMs = millis() + WIFI_STABILIZE_MS;
      heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
      Serial.print("Conectado. IP: ");
      Serial.println(WiFi.localIP());
      Serial.printf("Señal: %d dBm\n", WiFi.RSSI());
    }
    return true;
  }

  wifiReady = false;

  if (!wifiConnectStarted) {
    if (now - lastWifiAttemptMs >= WIFI_RETRY_INTERVAL_MS) {
      startWiFiConnect();
    }
    return false;
  }

  if (now - wifiConnectStartMs >= WIFI_CONNECT_TIMEOUT_MS) {
    wifiConnectStarted = false;
    Serial.println("Timeout WiFi.");
    printWifiError();
    scanNearbyNetworks();
    lastWifiAttemptMs = now;
    return false;
  }

  static unsigned long lastStatusLogMs = 0;
  if (now - lastStatusLogMs >= 2000) {
    lastStatusLogMs = now;
    Serial.printf("  esperando WiFi... estado=%d\n", WiFi.status());
  }

  return false;
}

bool canSendHttp(unsigned long now) {
  return !httpBusy && now >= httpAvailableAtMs;
}

void markHttpFinished(unsigned long now, bool success, bool affectsHeartbeatBackoff) {
  httpAvailableAtMs = now + (success ? HTTP_MIN_GAP_MS : HTTP_LINK_PAUSE_MS);

  if (success) {
    if (affectsHeartbeatBackoff) {
      consecutiveHttpFails = 0;
      heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
    }
    return;
  }

  if (!affectsHeartbeatBackoff) {
    return;
  }

  consecutiveHttpFails++;
  if (consecutiveHttpFails >= HTTP_FAILS_BEFORE_BACKOFF) {
    heartbeatIntervalMs = min(heartbeatIntervalMs * 2, HEARTBEAT_BACKOFF_MAX_MS);
    Serial.printf("Servidor inestable, próximo heartbeat en %lu s\n",
                  heartbeatIntervalMs / 1000);
  }
}

bool requestApi(const char* path, bool useGet, bool affectsHeartbeatBackoff) {
  if (httpBusy) {
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi desconectado");
    return false;
  }

  httpBusy = true;
  const unsigned long startedAt = millis();
  String url = String(API_BASE_URL) + path;

  WiFiClient client;
  client.setTimeout(HTTP_CONNECT_TIMEOUT_MS);
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setReuse(false);
  http.begin(client, url);
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  http.addHeader("Connection", "close");

  int code = -1;
  if (useGet) {
    code = http.GET();
  } else {
    http.addHeader("Content-Type", "application/json");
    http.addHeader("Content-Length", "2");
    code = http.POST("{}");
  }

  if (code > 0) {
    (void)http.getString();
  }

  const bool ok = code >= 200 && code < 300;
  if (ok) {
    Serial.printf("%s %s -> %d\n", useGet ? "GET" : "POST", path, code);
  } else {
    Serial.printf(
      "Error %s %s -> %d (%s)\n",
      useGet ? "GET" : "POST",
      path,
      code,
      http.errorToString(code).c_str()
    );
  }

  http.end();
  client.stop();
  delay(HTTP_SOCKET_SETTLE_MS);

  httpBusy = false;
  markHttpFinished(millis(), ok, affectsHeartbeatBackoff);
  return ok;
}

bool sendHeartbeat() {
  if (httpBusy) {
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi desconectado");
    return false;
  }

  httpBusy = true;

  if (!heartbeatSessionReady) {
    heartbeatClient.setTimeout(HTTP_CONNECT_TIMEOUT_MS);
    const String url = String(API_BASE_URL) + HEARTBEAT_PATH;
    heartbeatHttp.begin(heartbeatClient, url);
    heartbeatHttp.setTimeout(HTTP_TIMEOUT_MS);
    heartbeatHttp.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
    heartbeatHttp.setReuse(true);
    heartbeatHttp.addHeader("X-Device-Token", DEVICE_TOKEN);
    heartbeatSessionReady = true;
  }

  const int code = heartbeatHttp.GET();
  if (code > 0) {
    (void)heartbeatHttp.getString();
  }

  const bool ok = code >= 200 && code < 300;
  if (ok) {
    Serial.printf("GET %s -> %d\n", HEARTBEAT_PATH, code);
  } else {
    Serial.printf(
      "Error GET %s -> %d (%s)\n",
      HEARTBEAT_PATH,
      code,
      heartbeatHttp.errorToString(code).c_str()
    );
    closeHeartbeatSession();
  }

  httpBusy = false;
  markHttpFinished(millis(), ok, true);
  return ok;
}

bool postButton() {
  closeHeartbeatSession();
  return requestApi(BUTTON_PATH, false, false);
}

void blinkLed(int times = 2, int onMs = 100) {
  pinMode(LED_PIN, OUTPUT);
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, LOW);
    delay(onMs);
    digitalWrite(LED_PIN, HIGH);
    delay(onMs);
  }
}

void scheduleButtonPost(unsigned long now) {
  if (now < buttonCooldownUntil) {
    return;
  }

  pendingButtonPost = true;
  buttonPostAtMs = now + BUTTON_POST_DELAY_MS;
  httpQuietUntil = now + BUTTON_HTTP_QUIET_MS;
  lastHeartbeatMs = now;
  Serial.println("Botón detectado, POST en breve...");
}

void processPendingButton(unsigned long now) {
  if (!pendingButtonPost || now < buttonPostAtMs || !canSendHttp(now)) {
    return;
  }

  if (postButton()) {
    pendingButtonPost = false;
    lastHeartbeatMs = now;
    buttonCooldownUntil = now + BUTTON_MIN_INTERVAL_MS;
    httpQuietUntil = now + BUTTON_HTTP_QUIET_MS;
    httpAvailableAtMs = now + HTTP_MIN_GAP_MS * 2;
    blinkLed();
    Serial.println("Botón OK — heartbeat pausado 12 s");
  } else {
    buttonPostAtMs = now + BUTTON_RETRY_MS;
  }
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println();
  Serial.println("ESP32-C3 Classify iniciando...");

  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);

  WiFi.onEvent(onWiFiEvent);
  startWiFiConnect();
}

void loop() {
  unsigned long now = millis();

  if (!updateWiFiConnection(now)) {
    delay(50);
    return;
  }

  if (now < wifiStableAtMs) {
    delay(10);
    return;
  }

  int reading = digitalRead(BOOT_BUTTON_PIN);
  if (reading != lastButtonReading) {
    lastDebounceMs = now;
  }

  if (now - lastDebounceMs >= DEBOUNCE_MS) {
    static int stableState = HIGH;
    if (reading != stableState) {
      stableState = reading;
      if (stableState == LOW) {
        buttonWasHeld = true;
      } else if (buttonWasHeld && !pendingButtonPost) {
        buttonWasHeld = false;
        scheduleButtonPost(now);
      }
    }
  }

  lastButtonReading = reading;

  processPendingButton(now);

  const bool heartbeatAllowed =
    !pendingButtonPost &&
    now >= httpQuietUntil &&
    now - lastHeartbeatMs >= heartbeatIntervalMs &&
    canSendHttp(now);

  if (heartbeatAllowed) {
    lastHeartbeatMs = now;
    if (sendHeartbeat()) {
      consecutiveHttpFails = 0;
      heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
    }
  }

  delay(10);
}
