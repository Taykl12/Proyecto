@echo off
title Classify - API (Express)
cd /d "%~dp0"

if not exist "node_modules\" (
  echo Instalando dependencias del workspace con pnpm...
  call pnpm install
)

if not exist "server\.env" (
  echo.
  echo [ERROR] Falta server\.env
  echo Copia server\.env.example a server\.env y completa SUPABASE_ANON_KEY.
  echo Dashboard: https://supabase.com/dashboard/project/jgrtmokyqdvdxsldmkou/settings/api
  echo.
  pause
  exit /b 1
)

echo.
echo Iniciando API con pnpm (tsx watch)...
echo   - Red local:  http://0.0.0.0:3001  (para ESP32 / celular en la misma WiFi)
echo   - Esta PC:    http://localhost:3001
echo.
echo IMPORTANTE: no cierres esta ventana mientras uses el ESP32.
echo Si editas archivos del server, tsx reinicia un instante y el ESP puede ver "connection refused".
echo.

call pnpm run dev:server
pause
