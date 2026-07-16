import { useCallback, useEffect, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { AdminModal } from "./AdminModal";
import { ApiError, apiFetch, apiFetchWithRetry } from "../../lib/api";
import type { AdminUser, FingerprintStatus, FingerprintStep } from "../../types/admin";

const POLL_INTERVAL_MS = 1500;

export type FingerprintModalMode = "enroll" | "verify";

interface FingerprintEnrollModalProps {
  user: AdminUser | null;
  open: boolean;
  mode?: FingerprintModalMode;
  onClose: () => void;
  onSuccess: () => void;
}

function stepMessage(
  step: FingerprintStep | null,
  mode: FingerprintModalMode
): string {
  if (mode === "verify") {
    switch (step) {
      case "requested":
        return "Esperando a que el ESP32 tome la solicitud…";
      case "claimed":
      case "place_finger":
        return "Coloque el dedo en el sensor para validar";
      case "processing":
        return "Comparando huella…";
      case "success":
        return "¡Huella Validada!";
      case "error":
        return "La huella no pudo validarse";
      default:
        return "Iniciando validación…";
    }
  }

  switch (step) {
    case "requested":
      return "Esperando a que el ESP32 tome la solicitud…";
    case "claimed":
    case "place_finger":
      return "Coloque el dedo en el sensor";
    case "remove_finger":
      return "Retire el dedo";
    case "place_again":
      return "Vuelva a colocar el mismo dedo";
    case "processing":
      return "Procesando…";
    case "success":
      return "¡Huella asignada correctamente!";
    case "error":
      return "No se pudo completar la asignación";
    default:
      return "Iniciando…";
  }
}

function fullName(user: AdminUser): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
}

export function FingerprintEnrollModal({
  user,
  open,
  mode = "enroll",
  onClose,
  onSuccess,
}: FingerprintEnrollModalProps) {
  const [status, setStatus] = useState<FingerprintStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const startSession = useCallback(
    async (targetUser: AdminUser) => {
      setStarting(true);
      setError(null);
      try {
        const path =
          mode === "verify"
            ? `/api/admin/users/${targetUser.id}/huella/validar`
            : `/api/admin/users/${targetUser.id}/huella/iniciar`;

        await apiFetch<{ sessionId: string; slotId: number; step: FingerprintStep }>(
          path,
          { method: "POST" }
        );
        const initial = await apiFetchWithRetry<FingerprintStatus>(
          `/api/admin/users/${targetUser.id}/huella/estado`
        );
        setStatus(initial);
      } catch (e) {
        setError(
          e instanceof ApiError
            ? e.message
            : mode === "verify"
              ? "No se pudo iniciar la validación"
              : "No se pudo iniciar la asignación"
        );
      } finally {
        setStarting(false);
      }
    },
    [mode]
  );

  const cancelSession = useCallback(async () => {
    if (!user) return;
    try {
      await apiFetch(`/api/admin/users/${user.id}/huella/cancelar`, {
        method: "POST",
      });
    } catch {
      // ignore cancel errors
    }
  }, [user]);

  const handleClose = useCallback(() => {
    void cancelSession();
    setStatus(null);
    setError(null);
    onClose();
  }, [cancelSession, onClose]);

  useEffect(() => {
    if (!open || !user) return;
    setStatus(null);
    setError(null);
    void startSession(user);
  }, [open, user, startSession]);

  useEffect(() => {
    if (!open || !user || starting) return;

    const step = status?.step;
    if (step === "success" || step === "error") return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const next = await apiFetchWithRetry<FingerprintStatus>(
          `/api/admin/users/${user.id}/huella/estado`
        );
        if (cancelled) return;
        setStatus(next);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Error al consultar estado");
        }
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, user, starting, status?.step]);

  useEffect(() => {
    if (!open || status?.step !== "success") return;

    const timer = window.setTimeout(() => {
      onSuccess();
      onClose();
      setStatus(null);
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [open, status?.step, onSuccess, onClose]);

  if (!open || !user) return null;

  const step = status?.step ?? null;
  const isSuccess = step === "success";
  const isError = step === "error" || Boolean(error);
  const displayError = status?.errorMessage ?? error;
  const showSpinner =
    !isSuccess &&
    !isError &&
    (starting || step === "requested" || step === "processing" || step === "claimed");

  const title =
    mode === "verify"
      ? "Validar huella"
      : user.huellaId !== null
        ? "Reasignar huella"
        : "Asignar huella";

  return (
    <AdminModal
      open={open}
      title={title}
      error={isError ? displayError : null}
      onClose={handleClose}
      footer={
        <>
          {!isSuccess ? (
            <button
              type="button"
              className="project-modal__btn project-modal__btn--muted"
              onClick={handleClose}
            >
              Cancelar
            </button>
          ) : null}
          {isError ? (
            <>
              <button
                type="button"
                className="project-modal__btn project-modal__btn--muted"
                onClick={handleClose}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="project-modal__btn project-modal__btn--primary"
                onClick={() => void startSession(user)}
                disabled={starting}
              >
                Reintentar
              </button>
            </>
          ) : null}
        </>
      }
    >
      <div className="fingerprint-modal">
        <div className="fingerprint-modal__user">
          <Fingerprint size={28} aria-hidden />
          <div>
            <p className="fingerprint-modal__name">{fullName(user)}</p>
            {status?.slotId !== null && status?.slotId !== undefined ? (
              <p className="fingerprint-modal__slot">Slot del sensor: #{status.slotId}</p>
            ) : null}
          </div>
        </div>

        <div className="fingerprint-modal__step" role="status">
          {showSpinner ? (
            <Loader2 size={22} className="fingerprint-modal__spinner" aria-hidden />
          ) : (
            <Fingerprint
              size={22}
              className={
                isSuccess
                  ? "fingerprint-modal__icon fingerprint-modal__icon--success"
                  : "fingerprint-modal__icon"
              }
              aria-hidden
            />
          )}
          <p>{stepMessage(step, mode)}</p>
        </div>

        {mode === "verify" ? (
          <ol className="fingerprint-modal__steps">
            <li className={step === "requested" || step === "claimed" ? "is-active" : ""}>
              Conectar con el ESP32
            </li>
            <li className={step === "place_finger" ? "is-active" : ""}>
              Colocar el dedo en el sensor
            </li>
            <li className={step === "processing" || step === "success" ? "is-active" : ""}>
              Validar coincidencia
            </li>
          </ol>
        ) : (
          <ol className="fingerprint-modal__steps">
            <li className={step === "requested" || step === "claimed" ? "is-active" : ""}>
              Conectar con el ESP32
            </li>
            <li
              className={
                step === "place_finger" || step === "place_again" ? "is-active" : ""
              }
            >
              Colocar el dedo en el sensor
            </li>
            <li className={step === "remove_finger" ? "is-active" : ""}>
              Retirar y volver a colocar el dedo
            </li>
            <li className={step === "processing" || step === "success" ? "is-active" : ""}>
              Guardar en el sensor y vincular al usuario
            </li>
          </ol>
        )}
      </div>
    </AdminModal>
  );
}
