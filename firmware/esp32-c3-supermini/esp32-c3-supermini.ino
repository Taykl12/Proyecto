/*
 * Classify — ESP32-C3 SuperMini
 * Heartbeat + contador del botón BOOT (GPIO 9) hacia la API Express.
 *
 * Dependencias (Arduino IDE / PlatformIO):
 *   - Board: ESP32C3 Dev Module (USB CDC On Boot: Enabled)
 *   - WiFi, HTTPClient (core ESP32)
 *
 * Configurá WIFI_SSID, WIFI_PASSWORD, API_BASE_URL y DEVICE_TOKEN
 * con los mismos valores que server/.env (ESP32_DEVICE_TOKEN).
 */

#include <WiFi.h>
#include <HTTPClient.h>

// --- Configuración (editar antes de flashear) ---
const char* WIFI_SSID = "hola";
const char* WIFI_PASSWORD = "renzo1705";
// IP local de tu PC en la red, o URL de Render en producción (sin barra final)
const char* API_BASE_URL = "http://10.164.156.176:3001";
const char* DEVICE_TOKEN = "dev-esp32-token";

// Botón BOOT en ESP32-C3 SuperMini
const int BOOT_BUTTON_PIN = 9;
const unsigned long HEARTBEAT_INTERVAL_MS = 5000;
const unsigned long DEBOUNCE_MS = 200;

unsigned long lastHeartbeatMs = 0;
unsigned long lastDebounceMs = 0;
int lastButtonReading = HIGH;

bool postToApi(const char* path) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi desconectado");
    return false;
  }

  HTTPClient http;
  String url = String(API_BASE_URL) + path;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);

  int code = http.POST("{}");
  bool ok = code >= 200 && code < 300;

  if (ok) {
    Serial.printf("POST %s -> %d\n", path, code);
  } else {
    Serial.printf("Error POST %s -> %d\n", path, code);
  }

  http.end();
  return ok;
}

void setup() {
  Serial.begin(115200);
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Conectando WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("IP: ");
  Serial.println(WiFi.localIP());

  postToApi("/api/device/esp32/heartbeat");
  lastHeartbeatMs = millis();
}

void loop() {
  unsigned long now = millis();

  if (now - lastHeartbeatMs >= HEARTBEAT_INTERVAL_MS) {
    postToApi("/api/device/esp32/heartbeat");
    lastHeartbeatMs = now;
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
        postToApi("/api/device/esp32/button");
      }
    }
  }

  lastButtonReading = reading;
  delay(10);
}
