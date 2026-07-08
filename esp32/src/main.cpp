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
const char* DEVICE_JOB_PENDING_PATH = "/api/device/esp32/huella/lote/pendiente";
const char* DEVICE_JOB_NEXT_PATH = "/api/device/esp32/huella/lote/siguiente";
const char* DEVICE_JOB_PROGRESS_PATH = "/api/device/esp32/huella/lote/progreso";
const char* DEVICE_JOB_RESULT_PATH = "/api/device/esp32/huella/lote/resultado";

const uint16_t AS608_STARTCODE = 0xEF01;
const uint8_t AS608_COMMANDPACKET = 0x01;
const uint8_t AS608_DATAPACKET = 0x02;
const uint8_t AS608_ACKPACKET = 0x07;
const uint8_t AS608_ENDDATAPACKET = 0x08;
const uint8_t AS608_CMD_UPLOAD = 0x08;
const uint8_t AS608_CMD_DOWNLOAD = 0x09;
const uint16_t TEMPLATE_MAX_LEN = 1024;
const size_t TEMPLATE_B64_MAX_LEN = 1400;

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
unsigned long lastDeviceJobPollMs = 0;
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
  const char* errorMessage,
  const char* templateBase64 = nullptr
) {
  JsonDocument doc;
  doc["sessionId"] = sessionId;
  doc["success"] = success;
  if (success) {
    doc["slotId"] = slotId;
    if (templateBase64 != nullptr && templateBase64[0] != '\0') {
      doc["templateBase64"] = templateBase64;
    }
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

void flushFingerSerial() {
  fingerSerial.flush();
  while (fingerSerial.available() > 0) {
    (void)fingerSerial.read();
  }
}

bool sendRawPacket(uint8_t type, const uint8_t* payload, uint16_t len) {
  const uint16_t wireLength = len + 2;
  uint16_t sum = (wireLength >> 8) + (wireLength & 0xFF) + type;

  fingerSerial.write((uint8_t)(AS608_STARTCODE >> 8));
  fingerSerial.write((uint8_t)(AS608_STARTCODE & 0xFF));
  fingerSerial.write(0xFF);
  fingerSerial.write(0xFF);
  fingerSerial.write(0xFF);
  fingerSerial.write(0xFF);
  fingerSerial.write(type);
  fingerSerial.write((uint8_t)(wireLength >> 8));
  fingerSerial.write((uint8_t)(wireLength & 0xFF));

  for (uint16_t i = 0; i < len; i++) {
    fingerSerial.write(payload[i]);
    sum += payload[i];
  }

  fingerSerial.write((uint8_t)(sum >> 8));
  fingerSerial.write((uint8_t)(sum & 0xFF));
  fingerSerial.flush();
  return true;
}

bool readRawPacket(
  uint8_t& outType,
  uint8_t* outBuf,
  uint16_t maxLen,
  uint16_t& outLen,
  unsigned long timeoutMs
) {
  uint16_t idx = 0;
  uint16_t wireLength = 0;
  const unsigned long startedAt = millis();

  while (millis() - startedAt < timeoutMs) {
    if (!fingerSerial.available()) {
      delay(1);
      continue;
    }

    const uint8_t byte = (uint8_t)fingerSerial.read();

    if (idx == 0 && byte != (AS608_STARTCODE >> 8)) {
      continue;
    }
    if (idx == 1 && byte != (AS608_STARTCODE & 0xFF)) {
      idx = byte == (AS608_STARTCODE >> 8) ? 1 : 0;
      continue;
    }

    if (idx == 6) {
      outType = byte;
    } else if (idx == 7) {
      wireLength = (uint16_t)byte << 8;
    } else if (idx == 8) {
      wireLength |= byte;
      if (wireLength < 2) {
        return false;
      }
    } else if (idx >= 9) {
      const uint16_t payloadIndex = idx - 9;
      const uint16_t payloadLen = wireLength - 2;
      if (payloadIndex < payloadLen) {
        if (payloadIndex >= maxLen) {
          return false;
        }
        outBuf[payloadIndex] = byte;
      }
      if (payloadIndex == wireLength - 1) {
        outLen = payloadLen;
        return true;
      }
    }

    idx++;
  }

  return false;
}

bool readAckConfirm(unsigned long timeoutMs) {
  uint8_t type = 0;
  uint8_t buf[16];
  uint16_t len = 0;

  if (!readRawPacket(type, buf, sizeof(buf), len, timeoutMs)) {
    return false;
  }

  if (type != AS608_ACKPACKET || len < 1) {
    return false;
  }

  return buf[0] == FINGERPRINT_OK;
}

bool uploadCharBuffer(
  uint8_t charBufferId,
  uint8_t* outBuf,
  uint16_t maxLen,
  uint16_t& outLen
) {
  flushFingerSerial();

  const uint8_t uploadPayload[] = { AS608_CMD_UPLOAD, charBufferId };
  if (!sendRawPacket(AS608_COMMANDPACKET, uploadPayload, sizeof(uploadPayload))) {
    Serial.println("UPLOAD: fallo al enviar comando");
    return false;
  }

  if (!readAckConfirm(3000)) {
    Serial.println("UPLOAD: ACK inicial inválido");
    return false;
  }

  outLen = 0;
  while (true) {
    uint8_t type = 0;
    uint8_t chunk[140];
    uint16_t chunkLen = 0;

    if (!readRawPacket(type, chunk, sizeof(chunk), chunkLen, 8000)) {
      Serial.println("UPLOAD: timeout leyendo paquete de datos");
      return false;
    }

    if (type == AS608_ACKPACKET) {
      if (chunkLen >= 1 && chunk[0] != FINGERPRINT_OK) {
        Serial.printf("UPLOAD: ACK de error 0x%02X\n", chunk[0]);
        return false;
      }
      continue;
    }

    if (type != AS608_DATAPACKET && type != AS608_ENDDATAPACKET) {
      Serial.printf("UPLOAD: tipo de paquete inesperado 0x%02X\n", type);
      return false;
    }

    if (outLen + chunkLen > maxLen) {
      Serial.printf("UPLOAD: template excede buffer (%u + %u > %u)\n", outLen, chunkLen, maxLen);
      return false;
    }

    memcpy(outBuf + outLen, chunk, chunkLen);
    outLen += chunkLen;

    if (type == AS608_ENDDATAPACKET) {
      return outLen > 0;
    }
  }
}

bool captureTemplateFromSlot(uint16_t slotId, uint8_t* outBuf, uint16_t maxLen, uint16_t& outLen) {
  if (finger.loadModel(slotId) != FINGERPRINT_OK) {
    Serial.printf("UPLOAD: loadModel(%u) falló\n", slotId);
    return false;
  }

  // loadModel() de Adafruit carga en el char buffer 0x02, no en 0x01.
  return uploadCharBuffer(0x02, outBuf, maxLen, outLen);
}

bool writeTemplate(uint16_t slotId, const uint8_t* data, uint16_t len) {
  flushFingerSerial();

  const uint8_t downloadPayload[] = { AS608_CMD_DOWNLOAD, 0x01 };
  if (!sendRawPacket(AS608_COMMANDPACKET, downloadPayload, sizeof(downloadPayload))) {
    return false;
  }

  if (!readAckConfirm(3000)) {
    return false;
  }

  const uint16_t chunkSize = finger.packet_len > 0 ? finger.packet_len : 128;
  uint16_t offset = 0;

  while (offset < len) {
    const uint16_t remaining = len - offset;
    const uint16_t currentLen = remaining > chunkSize ? chunkSize : remaining;
    const bool isLast = offset + currentLen >= len;
    const uint8_t packetType = isLast ? AS608_ENDDATAPACKET : AS608_DATAPACKET;

    if (!sendRawPacket(packetType, data + offset, currentLen)) {
      return false;
    }

    if (!readAckConfirm(5000)) {
      return false;
    }

    offset += currentLen;
  }

  return finger.storeModel(slotId) == FINGERPRINT_OK;
}

size_t base64EncodedLength(size_t inputLen) {
  return 4 * ((inputLen + 2) / 3);
}

size_t base64Encode(const uint8_t* input, size_t inputLen, char* output, size_t outputMax) {
  static const char* table =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  size_t outIdx = 0;

  for (size_t i = 0; i < inputLen; i += 3) {
    const uint32_t octetA = input[i];
    const uint32_t octetB = i + 1 < inputLen ? input[i + 1] : 0;
    const uint32_t octetC = i + 2 < inputLen ? input[i + 2] : 0;
    const uint32_t triple = (octetA << 16) | (octetB << 8) | octetC;

    if (outIdx + 4 >= outputMax) {
      return 0;
    }

    output[outIdx++] = table[(triple >> 18) & 0x3F];
    output[outIdx++] = table[(triple >> 12) & 0x3F];
    output[outIdx++] = i + 1 < inputLen ? table[(triple >> 6) & 0x3F] : '=';
    output[outIdx++] = i + 2 < inputLen ? table[triple & 0x3F] : '=';
  }

  if (outIdx < outputMax) {
    output[outIdx] = '\0';
  }

  return outIdx;
}

int base64Value(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '+') return 62;
  if (c == '/') return 63;
  return -1;
}

size_t base64Decode(const char* input, uint8_t* output, size_t outputMax) {
  size_t inLen = strlen(input);
  size_t outIdx = 0;

  for (size_t i = 0; i < inLen; i += 4) {
    const int v0 = base64Value(input[i]);
    const int v1 = i + 1 < inLen ? base64Value(input[i + 1]) : -1;
    const int v2 = i + 2 < inLen && input[i + 2] != '=' ? base64Value(input[i + 2]) : -1;
    const int v3 = i + 3 < inLen && input[i + 3] != '=' ? base64Value(input[i + 3]) : -1;

    if (v0 < 0 || v1 < 0) {
      return 0;
    }

    const uint32_t triple = ((uint32_t)v0 << 18) | ((uint32_t)v1 << 12) |
                            ((v2 >= 0 ? (uint32_t)v2 : 0) << 6) |
                            (v3 >= 0 ? (uint32_t)v3 : 0);

    if (outIdx >= outputMax) return 0;
    output[outIdx++] = (triple >> 16) & 0xFF;

    if (v2 >= 0) {
      if (outIdx >= outputMax) return 0;
      output[outIdx++] = (triple >> 8) & 0xFF;
    }

    if (v3 >= 0) {
      if (outIdx >= outputMax) return 0;
      output[outIdx++] = triple & 0xFF;
    }
  }

  return outIdx;
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

  uint8_t templateBuf[TEMPLATE_MAX_LEN];
  uint16_t templateLen = 0;
  char templateBase64[TEMPLATE_B64_MAX_LEN];
  templateBase64[0] = '\0';

  p = finger.storeModel(slotId);
  if (p != FINGERPRINT_OK) {
    postFingerprintResult(sessionId, false, slotId, "No se pudo guardar la huella en el sensor");
    fingerprintJobActive = false;
    httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
    return;
  }

  // Respaldo opcional: leer template desde flash (loadModel → buffer 0x02 → UPLOAD).
  if (captureTemplateFromSlot((uint16_t)slotId, templateBuf, TEMPLATE_MAX_LEN, templateLen)) {
    const size_t encodedLen = base64EncodedLength(templateLen);
    if (encodedLen > 0 && encodedLen < TEMPLATE_B64_MAX_LEN) {
      if (base64Encode(templateBuf, templateLen, templateBase64, TEMPLATE_B64_MAX_LEN) > 0) {
        Serial.printf("Template capturado (%u bytes, b64 %u)\n", templateLen, encodedLen);
      } else {
        templateBase64[0] = '\0';
        Serial.println("No se pudo codificar template en base64");
      }
    }
  } else {
    Serial.println("No se pudo capturar template de respaldo (enroll OK sin backup)");
  }

  postFingerprintResult(
    sessionId,
    true,
    slotId,
    nullptr,
    templateBase64[0] != '\0' ? templateBase64 : nullptr
  );
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

bool postDeviceJobProgress(
  const String& sessionId,
  int index,
  bool success,
  int slotId,
  const String& userId
) {
  JsonDocument doc;
  doc["sessionId"] = sessionId;
  doc["index"] = index;
  doc["success"] = success;
  doc["slotId"] = slotId;
  doc["userId"] = userId;
  String body;
  serializeJson(doc, body);
  return httpPostJson(DEVICE_JOB_PROGRESS_PATH, body, false);
}

bool postDeviceJobResult(
  const String& sessionId,
  bool success,
  const char* errorMessage
) {
  JsonDocument doc;
  doc["sessionId"] = sessionId;
  doc["success"] = success;
  if (!success && errorMessage != nullptr) {
    doc["error"] = errorMessage;
  }
  String body;
  serializeJson(doc, body);
  return httpPostJson(DEVICE_JOB_RESULT_PATH, body, false);
}

void runDeviceWipeJob(const String& sessionId) {
  closeHeartbeatSession();
  fingerprintJobActive = true;
  httpQuietUntil = millis() + 120000;

  const uint8_t result = finger.emptyDatabase();
  if (result == FINGERPRINT_OK) {
    postDeviceJobResult(sessionId, true, nullptr);
    blinkLed(3, 120);
    Serial.println("Sensor vaciado correctamente");
  } else {
    postDeviceJobResult(sessionId, false, "No se pudo vaciar la memoria del sensor");
    Serial.printf("Error al vaciar sensor: %d\n", result);
  }

  fingerprintJobActive = false;
  httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
  lastDeviceJobPollMs = millis();
}

void runDeviceRestoreJob(const String& sessionId) {
  closeHeartbeatSession();
  fingerprintJobActive = true;
  httpQuietUntil = millis() + 600000;

  int restored = 0;
  int failed = 0;

  while (true) {
    int code = -1;
    const String path =
      String(DEVICE_JOB_NEXT_PATH) + "?sessionId=" + sessionId;
    const String body = httpGetBody(path.c_str(), code);

    if (code < 200 || code >= 300) {
      postDeviceJobResult(sessionId, false, "Error al obtener siguiente template");
      break;
    }

    JsonDocument doc;
    if (deserializeJson(doc, body)) {
      postDeviceJobResult(sessionId, false, "Respuesta inválida del servidor");
      break;
    }

    if (doc["done"] | false) {
      postDeviceJobResult(sessionId, true, nullptr);
      blinkLed(3, 120);
      Serial.printf("Restauración completa: %d ok, %d fallos\n", restored, failed);
      break;
    }

    const int index = doc["index"] | -1;
    const int slotId = doc["slotId"] | -1;
    const String userId = doc["userId"] | "";
    const String templateBase64 = doc["templateBase64"] | "";

    if (index < 0 || slotId < 0 || userId.length() == 0 || templateBase64.length() == 0) {
      postDeviceJobResult(sessionId, false, "Template inválido en la cola");
      break;
    }

    uint8_t templateBuf[TEMPLATE_MAX_LEN];
    const size_t decodedLen =
      base64Decode(templateBase64.c_str(), templateBuf, TEMPLATE_MAX_LEN);

    bool itemOk = false;
    if (decodedLen > 0) {
      itemOk = writeTemplate((uint16_t)slotId, templateBuf, (uint16_t)decodedLen);
    }

    if (itemOk) {
      restored++;
    } else {
      failed++;
    }

    postDeviceJobProgress(sessionId, index, itemOk, slotId, userId);
    Serial.printf(
      "Restaurar slot %d (%s): %s\n",
      slotId,
      userId.c_str(),
      itemOk ? "OK" : "FALLÓ"
    );
  }

  fingerprintJobActive = false;
  httpQuietUntil = millis() + BUTTON_HTTP_QUIET_MS;
  lastDeviceJobPollMs = millis();
}

void runDeviceJob(const String& sessionId, const String& jobType) {
  if (!fingerprintReady) {
    postDeviceJobResult(sessionId, false, "Sensor de huella no disponible");
    return;
  }

  if (jobType == "wipe") {
    runDeviceWipeJob(sessionId);
  } else {
    runDeviceRestoreJob(sessionId);
  }
}

void checkPendingDeviceJob(unsigned long now) {
  if (
    fingerprintJobActive ||
    pendingButtonPost ||
    !canSendHttp(now) ||
    now < httpQuietUntil ||
    now - lastDeviceJobPollMs < FINGERPRINT_POLL_INTERVAL_MS
  ) {
    return;
  }

  lastDeviceJobPollMs = now;

  int code = -1;
  const String body = httpGetBody(DEVICE_JOB_PENDING_PATH, code);
  if (code < 200 || code >= 300) {
    return;
  }

  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    Serial.println("JSON inválido en huella/lote/pendiente");
    return;
  }

  if (!doc["pending"] || !doc["pending"].as<bool>()) {
    return;
  }

  const String sessionId = doc["sessionId"].as<String>();
  const String jobType = doc["jobType"] | "wipe";

  if (sessionId.length() == 0) {
    return;
  }

  Serial.printf("Trabajo global de huella: type=%s\n", jobType.c_str());
  runDeviceJob(sessionId, jobType);
}

void setupFingerprintSensor() {
  fingerSerial.begin(57600, SERIAL_8N1, FINGER_RX_PIN, FINGER_TX_PIN);
  finger.begin(57600);

  if (finger.verifyPassword()) {
    fingerprintReady = true;
    finger.getParameters();
    Serial.println("Sensor AS608 detectado");
    Serial.printf("Capacidad: %u, packet_len: %u\n", finger.capacity, finger.packet_len);
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
  checkPendingDeviceJob(now);
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
