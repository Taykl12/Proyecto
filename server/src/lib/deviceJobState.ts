export type DeviceJobType = "wipe" | "restore";

export type DeviceJobStep =
  | "requested"
  | "claimed"
  | "processing"
  | "success"
  | "error";

export interface DeviceJobQueueItem {
  userId: string;
  slotId: number;
  templateBase64: string;
}

export interface DeviceJobSession {
  sessionId: string;
  jobType: DeviceJobType;
  queue: DeviceJobQueueItem[];
  currentIndex: number;
  succeeded: number;
  failed: number;
  step: DeviceJobStep;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DeviceJobStatusDto {
  active: boolean;
  jobType: DeviceJobType | null;
  total: number | null;
  index: number | null;
  succeeded: number | null;
  failed: number | null;
  errorMessage: string | null;
}

const CLAIM_TIMEOUT_MS = 30_000;
const SESSION_TIMEOUT_MS = 600_000;

let activeJob: DeviceJobSession | null = null;

function now(): number {
  return Date.now();
}

function newSessionId(): string {
  return `dj-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isTerminal(step: DeviceJobStep): boolean {
  return step === "success" || step === "error";
}

function expireIfNeeded(): void {
  if (!activeJob) return;

  const age = now() - activeJob.createdAt;
  const idle = now() - activeJob.updatedAt;
  const terminal = isTerminal(activeJob.step);

  if (terminal && idle > 10_000) {
    activeJob = null;
    return;
  }

  if (activeJob.step === "requested" && age > CLAIM_TIMEOUT_MS) {
    activeJob.step = "error";
    activeJob.errorMessage =
      "Tiempo agotado, verificá que el ESP32 esté conectado.";
    activeJob.updatedAt = now();
    return;
  }

  if (!terminal && age > SESSION_TIMEOUT_MS) {
    activeJob.step = "error";
    activeJob.errorMessage =
      "Tiempo agotado durante la operación en el sensor.";
    activeJob.updatedAt = now();
  }
}

function toStatus(job: DeviceJobSession | null): DeviceJobStatusDto {
  if (!job) {
    return {
      active: false,
      jobType: null,
      total: null,
      index: null,
      succeeded: null,
      failed: null,
      errorMessage: null,
    };
  }

  const terminal = isTerminal(job.step);
  const total = job.jobType === "restore" ? job.queue.length : null;

  return {
    active: !terminal,
    jobType: job.jobType,
    total,
    index: job.jobType === "restore" ? job.currentIndex : null,
    succeeded: job.succeeded,
    failed: job.failed,
    errorMessage: job.errorMessage,
  };
}

export function hasActiveDeviceJob(): boolean {
  expireIfNeeded();
  if (!activeJob) return false;
  return !isTerminal(activeJob.step);
}

export function getDeviceJobStatus(): DeviceJobStatusDto {
  expireIfNeeded();
  return toStatus(activeJob);
}

export function getActiveDeviceJob(): DeviceJobSession | null {
  expireIfNeeded();
  return activeJob;
}

function assertNoActiveJob(): void {
  expireIfNeeded();
  if (activeJob && !isTerminal(activeJob.step)) {
    throw Object.assign(
      new Error("Ya hay una operación global en curso en el sensor"),
      { status: 409 }
    );
  }
}

export function startWipeJob(): DeviceJobSession {
  assertNoActiveJob();

  const session: DeviceJobSession = {
    sessionId: newSessionId(),
    jobType: "wipe",
    queue: [],
    currentIndex: 0,
    succeeded: 0,
    failed: 0,
    step: "requested",
    errorMessage: null,
    createdAt: now(),
    updatedAt: now(),
  };

  activeJob = session;
  return session;
}

export function startRestoreJob(queue: DeviceJobQueueItem[]): DeviceJobSession {
  assertNoActiveJob();

  if (queue.length === 0) {
    throw Object.assign(
      new Error("No hay templates guardados en la base para restaurar"),
      { status: 400 }
    );
  }

  const session: DeviceJobSession = {
    sessionId: newSessionId(),
    jobType: "restore",
    queue,
    currentIndex: 0,
    succeeded: 0,
    failed: 0,
    step: "requested",
    errorMessage: null,
    createdAt: now(),
    updatedAt: now(),
  };

  activeJob = session;
  return session;
}

export function claimPendingDeviceJob():
  | (DeviceJobSession & { pending: true })
  | { pending: false } {
  expireIfNeeded();

  if (!activeJob || activeJob.step !== "requested") {
    return { pending: false };
  }

  activeJob.step = "claimed";
  activeJob.updatedAt = now();
  return { ...activeJob, pending: true };
}

export function markDeviceJobProcessing(sessionId: string): boolean {
  expireIfNeeded();
  if (!activeJob || activeJob.sessionId !== sessionId) return false;

  activeJob.step = "processing";
  activeJob.updatedAt = now();
  return true;
}

export function getNextQueueItem(sessionId: string):
  | { done: true }
  | {
      done: false;
      index: number;
      userId: string;
      slotId: number;
      templateBase64: string;
    } {
  expireIfNeeded();
  if (!activeJob || activeJob.sessionId !== sessionId) {
    throw Object.assign(new Error("Sesión de lote no encontrada"), {
      status: 404,
    });
  }

  if (activeJob.jobType !== "restore") {
    throw Object.assign(new Error("La sesión no es de restauración"), {
      status: 400,
    });
  }

  if (activeJob.currentIndex >= activeJob.queue.length) {
    return { done: true };
  }

  const item = activeJob.queue[activeJob.currentIndex];
  return {
    done: false,
    index: activeJob.currentIndex,
    userId: item.userId,
    slotId: item.slotId,
    templateBase64: item.templateBase64,
  };
}

export function markItemDone(
  sessionId: string,
  index: number,
  success: boolean
): boolean {
  expireIfNeeded();
  if (!activeJob || activeJob.sessionId !== sessionId) return false;
  if (activeJob.currentIndex !== index) return false;

  if (success) {
    activeJob.succeeded += 1;
  } else {
    activeJob.failed += 1;
  }

  activeJob.currentIndex += 1;
  activeJob.updatedAt = now();
  return true;
}

export function completeDeviceJob(
  sessionId: string,
  success: boolean,
  errorMessage?: string
): DeviceJobSession | null {
  expireIfNeeded();
  if (!activeJob || activeJob.sessionId !== sessionId) return null;

  activeJob.step = success ? "success" : "error";
  activeJob.errorMessage = success
    ? null
    : errorMessage?.trim() || "Error en la operación del sensor";
  activeJob.updatedAt = now();
  return activeJob;
}
