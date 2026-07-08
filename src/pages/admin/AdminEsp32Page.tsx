import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { apiFetchWithRetry } from "../../lib/api";
import type { DeviceJobStatus, Esp32Status } from "../../types/admin";
import "../../styles/admin.css";

const POLL_INTERVAL_MS = 2000;
const JOB_POLL_INTERVAL_MS = 1500;

function formatJobStatus(job: DeviceJobStatus | null): string {
  if (!job?.active) {
    if (job?.jobType === "wipe" && job.errorMessage) {
      return `Error al vaciar: ${job.errorMessage}`;
    }
    if (job?.jobType === "wipe" && !job.errorMessage && job.succeeded !== null) {
      return "Sensor vacío";
    }
    if (job?.jobType === "restore" && job.errorMessage) {
      return `Error al restaurar: ${job.errorMessage}`;
    }
    if (
      job?.jobType === "restore" &&
      job.total !== null &&
      job.succeeded !== null &&
      !job.errorMessage
    ) {
      const failed =
        job.failed !== null && job.failed > 0 ? ` (${job.failed} fallaron)` : "";
      return `Restauración completa (${job.succeeded}/${job.total})${failed}`;
    }
    return "Sin operación en curso";
  }

  if (job.jobType === "wipe") {
    return "Vaciando sensor…";
  }

  if (job.jobType === "restore" && job.total !== null) {
    const current = (job.index ?? 0) + 1;
    return `Restaurando ${Math.min(current, job.total)}/${job.total}…`;
  }

  return "Operación en curso…";
}

export default function AdminEsp32Page() {
  const [status, setStatus] = useState<Esp32Status | null>(null);
  const [jobStatus, setJobStatus] = useState<DeviceJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [wipeLoading, setWipeLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const data = await apiFetchWithRetry<Esp32Status>("/api/admin/esp32/status");
      setStatus(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar estado");
    }
  }, []);

  const loadJobStatus = useCallback(async () => {
    try {
      const data = await apiFetchWithRetry<DeviceJobStatus>(
        "/api/admin/esp32/huellas/estado"
      );
      setJobStatus(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar operación de huellas");
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

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      await loadJobStatus();
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, JOB_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadJobStatus]);

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

  const handleWipe = async () => {
    const confirmed = window.confirm(
      "Esto borra todas las huellas cargadas físicamente en el sensor. Los respaldos en la base se conservan. ¿Continuar?"
    );
    if (!confirmed) return;

    setWipeLoading(true);
    try {
      await apiFetchWithRetry("/api/admin/esp32/huellas/vaciar", { method: "POST" });
      await loadJobStatus();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al iniciar vaciado del sensor");
    } finally {
      setWipeLoading(false);
    }
  };

  const handleRestore = async () => {
    const confirmed = window.confirm(
      "Esto sobrescribe el sensor con todos los templates guardados. Puede tardar varios minutos. ¿Continuar?"
    );
    if (!confirmed) return;

    setRestoreLoading(true);
    try {
      await apiFetchWithRetry("/api/admin/esp32/huellas/restaurar", { method: "POST" });
      await loadJobStatus();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al iniciar restauración");
    } finally {
      setRestoreLoading(false);
    }
  };

  const connected = status?.connected ?? false;
  const jobBusy = jobStatus?.active ?? false;

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

      <section className="dashboard-panel">
        <div className="dashboard-panel__header">
          <h2 className="dashboard-panel__title">Plantillas de huellas guardadas</h2>
          <p className="dashboard-panel__subtitle">
            Vaciar la memoria física del AS608 o restaurar todos los templates respaldados en la
            base de datos.
          </p>
        </div>

        <div className="esp32-templates">
          <p className="esp32-templates__status" role="status">
            {formatJobStatus(jobStatus)}
          </p>

          {jobStatus?.active && jobStatus.jobType === "restore" && jobStatus.total !== null ? (
            <p className="esp32-status__meta">
              Progreso: {jobStatus.succeeded ?? 0} ok, {jobStatus.failed ?? 0} fallos
            </p>
          ) : null}

          <div className="esp32-templates__actions">
            <button
              type="button"
              className="projects-panel__action-btn"
              onClick={() => void handleWipe()}
              disabled={wipeLoading || restoreLoading || jobBusy || !connected}
            >
              {wipeLoading ? "Iniciando…" : "Vaciar sensor"}
            </button>
            <button
              type="button"
              className="projects-panel__action-btn"
              onClick={() => void handleRestore()}
              disabled={wipeLoading || restoreLoading || jobBusy || !connected}
            >
              {restoreLoading ? "Iniciando…" : "Restaurar huellas desde la base"}
            </button>
          </div>

          {!connected ? (
            <p className="esp32-status__meta">
              El ESP32 debe estar conectado para ejecutar estas operaciones.
            </p>
          ) : null}
        </div>
      </section>
    </DashboardLayout>
  );
}
