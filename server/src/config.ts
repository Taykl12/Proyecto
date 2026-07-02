import "dotenv/config";

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env: ${key}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseAnonKey: required("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  appOrigin: process.env.APP_ORIGIN ?? "http://localhost:5173",
  /** Token compartido con el ESP32 (header X-Device-Token). Cambiar en producción. */
  esp32DeviceToken: process.env.ESP32_DEVICE_TOKEN ?? "dev-esp32-token",
};
