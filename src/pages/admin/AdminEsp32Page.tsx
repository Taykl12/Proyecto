import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { apiFetchWithRetry } from "../../lib/api";
import type { Esp32Status } from "../../types/admin";
import "../../styles/admin.css";

const POLL_INTERVAL_MS = 2000;

export default function AdminEsp32Page() {
  const [status, setStatus] = useState<Esp32Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiFetchWithRetry<Esp32Status>("/api/admin/esp32/status");
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar estado");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      await loadStatus();
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadStatus]);

  const handleReset = async () => {
    setResetting(true);
    try {
      const data = await apiFetchWithRetry<Esp32Status>("/api/admin/esp32/reset", {
        method: "POST",
      });
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al reiniciar contador");
    } finally {
      setResetting(false);
    }
  };

  const connected = status?.connected ?? false;

  return (
    <DashboardLayout>
      <header className="admin-hero">
        <Cpu size={52} strokeWidth={2.25} className="admin-hero__icon" aria-hidden />
        <div>
          <p className="admin-hero__eyebrow">Administración</p>
          <h1 className="admin-hero__title">Monitor ESP32-C3 SuperMini</h1>
        </div>
      </header>

      <section className="dashboard-panel">
        <div className="dashboard-panel__header">
          <h2 className="dashboard-panel__title">Estado del dispositivo</h2>
          <p className="dashboard-panel__subtitle">
            Conexión y contador del botón BOOT (actualización cada 2 s).
          </p>
        </div>

        {error ? (
          <p className="dashboard-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="esp32-status">
          <div
            className={`esp32-status__dot ${
              connected ? "esp32-status__dot--connected" : "esp32-status__dot--disconnected"
            }`}
            role="status"
            aria-label={connected ? "Conectado" : "Desconectado"}
          />
          <p className="esp32-status__label">
            {status === null ? "Consultando…" : connected ? "Conectado" : "Desconectado"}
          </p>

          <div className="esp32-status__count-block">
            <span className="esp32-status__count-label">Pulsaciones del botón BOOT</span>
            <strong className="esp32-status__count">{status?.pressCount ?? "…"}</strong>
          </div>

          {status?.lastSeenAt ? (
            <p className="esp32-status__meta">
              Último contacto: {new Date(status.lastSeenAt).toLocaleString("es-AR")}
            </p>
          ) : null}

          <button
            type="button"
            className="projects-panel__action-btn"
            onClick={() => void handleReset()}
            disabled={resetting || status === null}
          >
            {resetting ? "Reiniciando…" : "Reiniciar contador"}
          </button>
        </div>
      </section>
    </DashboardLayout>
  );
}
