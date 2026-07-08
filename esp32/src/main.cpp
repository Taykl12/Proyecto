/*
 * Classify — ESP32-C3 SuperMini + AS608
 * Heartbeat, botón BOOT y enrolamiento/eliminación de huellas hacia la API Express.
 *
 * Dependencias (PlatformIO):
 *   - Board: esp32-c3-devkitm-1 (USB CDC On Boot: Enabled)
 *   - Adafruit Fingerprint Sensor Library
 *   - ArduinoJson
 *
 * Credenciales en include/secrets.h (copiá secrets.h.example → secrets.h).
 * DEVICE_TOKEN debe coincidir con ESP32_DEVICE_TOKEN en server/.env
 *
 * Cableado AS608 (UART):
 *   ESP32 GPIO20 (RX) ← sensor TX
 *   ESP32 GPIO21 (TX) → sensor RX
 *   3.3V y GND
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <HardwareSerial.h>
#include <Adafruit_Fingerprint.h>
#include <ArduinoJson.h>
#include "secrets.h"

const char* HEARTBEAT_PATH = "/api/device/esp32/heartbeat";
const char* BUTTON_PATH = "/api/device/esp32/button";
const char* FINGER_PENDING_PATH = "/api/device/esp32/huella/pendiente";
const char* FINGER_PROGRESS_PATH = "/api/device/esp32/huella/progreso";
const char* FINGER_RESULT_PATH = "/api/device/esp32/huella/resultado";

const int BOOT_BUTTON_PIN = 9;
const int LED_PIN = 8;
const int FINGER_RX_PIN = 20;
const int FINGER_TX_PIN = 21;

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
const unsigned long FINGERPRINT_POLL_INTERVAL_MS = 5000;
const unsigned long FINGER_STEP_TIMEOUT_MS = 15000;
const int HTTP_FAILS_BEFORE_BACKOFF = 2;

HardwareSerial fingerSerial(1);
Adafruit_Fingerprint finger(&fingerSerial);

unsigned long lastHeartbeatMs = 0;
unsigned long heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
unsigned long wifiStableAtMs = 0;
unsigned long buttonPostAtMs = 0;
unsigned long buttonCooldownUntil = 0;
unsigned long httpQuietUntil = 0;
unsigned long lastDebounceMs = 0;
unsigned long httpAvailableAtMs = 0;
unsigned long lastWifiAttemptMs = 0;
unsigned long lastFingerprintPollMs = 0;
int lastButtonReading = HIGH;
int consecutiveHttpFails = 0;
bool httpBusy = false;
bool pendingButtonPost = false;
bool buttonWasHeld = false;
bool wifiReady = false;
bool wifiConnectStarted = false;
bool fingerprintReady = false;
bool fingerprintJobActive = false;
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

void onWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED: {
      closeHeartbeatSession();
      wifiReady = false;
      wifiConnectStarted = false;
      lastWifiAttemptMs = millis();
      heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
      const uint8_t reason = info.wifi_sta_disconnected.reason;
      Serial.printf("WiFi: desconectado (codigo=%u", reason);
      if (reason == 2 || reason == 15 || reason == 202 || reason == 204) {
        Serial.print(", contraseña incorrecta o WPA incompatible");
      } else if (reason == 201) {
        Serial.print(", red no encontrada (SSID/banda 2.4 GHz)");
      }
      Serial.println(")");
      break;
    }
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
  // Los ESP32-C3 (sobre todo SuperMini) suelen fallar con AUTH_EXPIRE (código 2)
  // contra hotspots de celular por exceso de potencia de transmisión.
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
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
    lastWifiAttemptMs = now - WIFI_RETRY_INTERVAL_MS;
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

String httpGetBody(const char* path, int& code) {
  String body = "";
  if (WiFi.status() != WL_CONNECTED) {
    code = -1;
    return body;
  }

  httpBusy = true;
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

  code = http.GET();
  if (code > 0) {
    body = http.getString();
  }

  http.end();
  client.stop();
  delay(HTTP_SOCKET_SETTLE_MS);

  httpBusy = false;
  markHttpFinished(millis(), code >= 200 && code < 300, false);
  return body;
}

bool httpPostJson(const char* path, const String& jsonBody, bool affectsHeartbeatBackoff) {
  if (httpBusy) {
    return false;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi desconectado");
    return false;
  }

  httpBusy = true;
  String url = String(API_BASE_URL) + path;

  WiFiClient client;
  client.setTimeout(HTTP_CONNECT_TIMEOUT_MS);
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_CONNECT_TIMEOUT_MS);
  http.setReuse(false);
  http.begin(client, url);
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Connection", "close");

  int code = http.POST(jsonBody);
  if (code > 0) {
    (void)http.getString();
  }

  const bool ok = code >= 200 && code < 300;
  if (ok) {
    Serial.printf("POST %s -> %d\n", path, code);
  } else {
    Serial.printf(
      "Error POST %s -> %d (%s)\n",
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

bool requestApi(const char* path, bool useGet, bool affectsHeartbeatBackoff) {
  if (useGet) {
    int code = -1;
    (void)httpGetBody(path, code);
    return code >= 200 && code < 300;
  }
  return httpPostJson(path, "{}", affectsHeartbeatBackoff);
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

bool postFingerprintProgress(const String& sessionId, const char* step) {
  JsonDocument doc;
  doc["sessionId"] = sessionId;
  doc["step"] = step;
  String body;
  serializeJson(doc, body);
  return httpPostJson(FINGER_PROGRESS_PATH, body, false);
}

bool postFingerprintResult(
  const String& sessionId,
  bool success,
  int slotId,
  const char* errorMessage
) {
  JsonDocument doc;
  doc["sessionId"] = sessionId;
  doc["success"] = success;
  if (success) {
    doc["slotId"] = slotId;
  } else if (errorMessage != nullptr) {
    doc["error"] = errorMessage;
  }
  String body;
  serializeJson(doc, body);
  return httpPostJson(FINGER_RESULT_PATH, body, false);
}

bool waitForFinger(unsigned long timeoutMs) {
  const unsigned long startedAt = millis();
  while (millis() - startedAt < timeoutMs) {
    const uint8_t p = finger.getImage();
    if (p == FINGERPRINT_OK) {
      return true;
    }
    if (p == FINGERPRINT_PACKETRECIEVEERR || p == FINGERPRINT_IMAGEFAIL) {
      return false;
    }
    delay(50);
  }
  return false;
}

bool waitForNoFinger(unsigned long timeoutMs) {
  const unsigned long startedAt = millis();
  while (millis() - startedAt < timeoutMs) {
    const uint8_t p = finger.getImage();
    if (p == FINGERPRINT_NOFINGER) {
      return true;
    }
    if (p == FINGERPRINT_PACKETRECIEVEERR) {
      return false;
    }
    delay(50);
  }
  return false;
}

void runFingerprintDelete(const String& sessionId, int slotId) {
  closeHeartbeatSession();
  fingerprintJobActive = true;
  httpQuietUntil = millis() + 120000;

  postFingerprintProgress(sessionId, "processing");
  const uint8_t result = finger.deleteModel(slotId);

  if (result == FINGERPRINT_OK) {
    postFingerprintResult(sessionId, true, slotId, nullptr);
    blinkLed(3, 120);
    Serial.printf("Huella eliminada del slot %d\n", slotId);
  } else {
    postFingerprintResult(sessionId, false, slotId, "No se pudo eliminar la huella del sensor");
    Serial.printf("Error al eliminar slot %d: %d\n", slotId, result);
  }

  fingerprintJobActive = false;
  httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
  lastFingerprintPollMs = millis();
}

void runFingerprintEnroll(const String& sessionId, int slotId) {
  closeHeartbeatSession();
  fingerprintJobActive = true;
  httpQuietUntil = millis() + 120000;

  postFingerprintProgress(sessionId, "place_finger");
  if (!waitForFinger(FINGER_STEP_TIMEOUT_MS)) {
    postFingerprintResult(sessionId, false, slotId, "Tiempo agotado esperando el dedo");
    fingerprintJobActive = false;
    httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
    return;
  }

  uint8_t p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    postFingerprintResult(sessionId, false, slotId, "No se pudo leer la primera huella");
    fingerprintJobActive = false;
    httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
    return;
  }

  postFingerprintProgress(sessionId, "remove_finger");
  if (!waitForNoFinger(FINGER_STEP_TIMEOUT_MS)) {
    postFingerprintResult(sessionId, false, slotId, "Retire el dedo para continuar");
    fingerprintJobActive = false;
    httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
    return;
  }

  postFingerprintProgress(sessionId, "place_again");
  if (!waitForFinger(FINGER_STEP_TIMEOUT_MS)) {
    postFingerprintResult(sessionId, false, slotId, "Tiempo agotado en la segunda lectura");
    fingerprintJobActive = false;
    httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
    return;
  }

  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) {
    postFingerprintResult(sessionId, false, slotId, "No se pudo leer la segunda huella");
    fingerprintJobActive = false;
    httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
    return;
  }

  postFingerprintProgress(sessionId, "processing");
  p = finger.createModel();
  if (p != FINGERPRINT_OK) {
    postFingerprintResult(sessionId, false, slotId, "Las huellas no coincidieron");
    fingerprintJobActive = false;
    httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
    return;
  }

  p = finger.storeModel(slotId);
  if (p != FINGERPRINT_OK) {
    postFingerprintResult(sessionId, false, slotId, "No se pudo guardar la huella en el sensor");
    fingerprintJobActive = false;
    httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
    return;
  }

  postFingerprintResult(sessionId, true, slotId, nullptr);
  blinkLed(3, 120);
  Serial.printf("Huella guardada en slot %d\n", slotId);

  fingerprintJobActive = false;
  httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
  lastFingerprintPollMs = millis();
}

void runFingerprintJob(const String& sessionId, int slotId, const String& mode) {
  if (!fingerprintReady) {
    postFingerprintResult(sessionId, false, slotId, "Sensor de huella no disponible");
    return;
  }

  if (mode == "delete") {
    runFingerprintDelete(sessionId, slotId);
  } else {
    runFingerprintEnroll(sessionId, slotId);
  }
}

void checkPendingFingerprint(unsigned long now) {
  if (
    fingerprintJobActive ||
    pendingButtonPost ||
    !canSendHttp(now) ||
    now < httpQuietUntil ||
    now - lastFingerprintPollMs < FINGERPRINT_POLL_INTERVAL_MS
  ) {
    return;
  }

  lastFingerprintPollMs = now;

  int code = -1;
  const String body = httpGetBody(FINGER_PENDING_PATH, code);
  if (code < 200 || code >= 300) {
    return;
  }

  JsonDocument doc;
  const DeserializationError err = deserializeJson(doc, body);
  if (err) {
    Serial.println("JSON inválido en huella/pendiente");
    return;
  }

  if (!doc["pending"] || !doc["pending"].as<bool>()) {
    return;
  }

  const String sessionId = doc["sessionId"].as<String>();
  const int slotId = doc["slotId"].as<int>();
  const String mode = doc["mode"] | "enroll";

  if (sessionId.length() == 0) {
    return;
  }

  Serial.printf("Trabajo de huella: mode=%s slot=%d\n", mode.c_str(), slotId);
  runFingerprintJob(sessionId, slotId, mode);
}

void setupFingerprintSensor() {
  fingerSerial.begin(57600, SERIAL_8N1, FINGER_RX_PIN, FINGER_TX_PIN);
  finger.begin(57600);

  if (finger.verifyPassword()) {
    fingerprintReady = true;
    Serial.println("Sensor AS608 detectado");
  } else {
    fingerprintReady = false;
    Serial.println("Sensor AS608 no detectado (continuará sin huella)");
  }
}

void setup() {
  Serial.begin(115200);
  delay(5000);
  Serial.println();
  Serial.println("ESP32-C3 Classify iniciando...");

  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  setupFingerprintSensor();

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
      } else if (buttonWasHeld && !pendingButtonPost && !fingerprintJobActive) {
        buttonWasHeld = false;
        scheduleButtonPost(now);
      }
    }
  }

  lastButtonReading = reading;

  processPendingButton(now);
  checkPendingFingerprint(now);

  const bool heartbeatAllowed =
    !pendingButtonPost &&
    !fingerprintJobActive &&
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
