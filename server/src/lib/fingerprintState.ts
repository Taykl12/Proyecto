import { hasActiveDeviceJob } from "./deviceJobState.js";

export type FingerprintStep =
  | "requested"
  | "claimed"
  | "place_finger"
  | "remove_finger"
  | "place_again"
  | "processing"
  | "success"
  | "error";

export type FingerprintMode = "enroll" | "delete" | "verify";

export interface FingerprintSession {
  sessionId: string;
  userId: string;
  slotId: number;
  mode: FingerprintMode;
  step: FingerprintStep;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface FingerprintStatusDto {
  active: boolean;
  step: FingerprintStep | null;
  slotId: number | null;
  errorMessage: string | null;
}

const CLAIM_TIMEOUT_MS = 30_000;
const SESSION_TIMEOUT_MS = 90_000;

let activeSession: FingerprintSession | null = null;
let onDeleteTimeoutCleanup: ((userId: string) => Promise<void>) | null = null;

export function setDeleteTimeoutCleanup(
  handler: (userId: string) => Promise<void>
): void {
  onDeleteTimeoutCleanup = handler;
}

function now(): number {
  return Date.now();
}

function newSessionId(): string {
  return `fp-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function expireIfNeeded(): void {
  if (!activeSession) return;

  const age = now() - activeSession.createdAt;
  const idle = now() - activeSession.updatedAt;
  const terminal =
    activeSession.step === "success" || activeSession.step === "error";

  if (terminal && idle > 5_000) {
    activeSession = null;
    return;
  }

  if (activeSession.step === "requested" && age > CLAIM_TIMEOUT_MS) {
    activeSession.step = "error";
    activeSession.errorMessage =
      "Tiempo agotado, verificá que el ESP32 esté conectado.";
    activeSession.updatedAt = now();
    return;
  }

  if (!terminal && age > SESSION_TIMEOUT_MS) {
    const wasDelete = activeSession.mode === "delete";
    const userId = activeSession.userId;
    activeSession.step = "error";
    activeSession.errorMessage =
      "Tiempo agotado, verificá que el ESP32 esté conectado.";
    activeSession.updatedAt = now();
    if (wasDelete && onDeleteTimeoutCleanup) {
      void onDeleteTimeoutCleanup(userId).catch((e) => {
        console.warn(
          "[fingerprint] Limpieza best-effort tras timeout delete:",
          e instanceof Error ? e.message : e
        );
      });
    }
  }
}

function toStatus(session: FingerprintSession | null): FingerprintStatusDto {
  if (!session) {
    return {
      active: false,
      step: null,
      slotId: null,
      errorMessage: null,
    };
  }

  const terminal = session.step === "success" || session.step === "error";
  return {
    active: !terminal,
    step: session.step,
    slotId: session.slotId,
    errorMessage: session.errorMessage,
  };
}

export function getActiveSession(): FingerprintSession | null {
  expireIfNeeded();
  return activeSession;
}

export function startSession(
  userId: string,
  slotId: number,
  mode: FingerprintMode
): FingerprintSession {
  expireIfNeeded();

  if (hasActiveDeviceJob()) {
    throw Object.assign(
      new Error(
        "Hay una operación global en el sensor (vaciar/restaurar). Esperá a que termine."
      ),
      { status: 409 }
    );
  }

  if (
    activeSession &&
    activeSession.step !== "success" &&
    activeSession.step !== "error"
  ) {
    throw Object.assign(
      new Error("Otro usuario está asignando una huella en este momento"),
      { status: 409 }
    );
  }

  const session: FingerprintSession = {
    sessionId: newSessionId(),
    userId,
    slotId,
    mode,
    step: "requested",
    errorMessage: null,
    createdAt: now(),
    updatedAt: now(),
  };

  activeSession = session;
  return session;
}

export function hasActiveUserFingerprintSession(): boolean {
  expireIfNeeded();
  if (!activeSession) return false;
  return (
    activeSession.step !== "success" && activeSession.step !== "error"
  );
}

export function claimPending():
  | (FingerprintSession & { pending: true })
  | { pending: false } {
  expireIfNeeded();

  if (hasActiveDeviceJob()) {
    return { pending: false };
  }

  if (!activeSession || activeSession.step !== "requested") {
    return { pending: false };
  }

  activeSession.step = "claimed";
  activeSession.updatedAt = now();
  return { ...activeSession, pending: true };
}

export function updateStep(sessionId: string, step: FingerprintStep): boolean {
  expireIfNeeded();
  if (!activeSession || activeSession.sessionId !== sessionId) return false;

  activeSession.step = step;
  activeSession.updatedAt = now();
  return true;
}

export function completeSuccess(sessionId: string): FingerprintSession | null {
  expireIfNeeded();
  if (!activeSession || activeSession.sessionId !== sessionId) return null;

  activeSession.step = "success";
  activeSession.errorMessage = null;
  activeSession.updatedAt = now();
  return activeSession;
}

export function completeError(
  sessionId: string,
  message: string
): FingerprintSession | null {
  expireIfNeeded();
  if (!activeSession || activeSession.sessionId !== sessionId) return null;

  activeSession.step = "error";
  activeSession.errorMessage = message;
  activeSession.updatedAt = now();
  return activeSession;
}

export function getSessionForUser(userId: string): FingerprintStatusDto {
  expireIfNeeded();
  if (!activeSession || activeSession.userId !== userId) {
    return toStatus(null);
  }
  return toStatus(activeSession);
}

export function cancelSession(userId: string): boolean {
  expireIfNeeded();
  if (!activeSession || activeSession.userId !== userId) return false;

  activeSession = null;
  return true;
}

export function clearSessionById(sessionId: string): void {
  if (activeSession?.sessionId === sessionId) {
    activeSession = null;
  }
}
