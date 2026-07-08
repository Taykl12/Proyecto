import express, {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import { config } from "../config.js";
import {
  claimPendingDeviceJob,
  completeDeviceJob,
  getNextQueueItem,
  hasActiveDeviceJob,
  markDeviceJobProcessing,
  markItemDone,
} from "../lib/deviceJobState.js";
import {
  claimPending,
  completeError,
  completeSuccess,
  getActiveSession,
  hasActiveUserFingerprintSession,
  updateStep,
  type FingerprintStep,
} from "../lib/fingerprintState.js";
import {
  deleteTemplate,
  saveTemplate,
} from "../lib/fingerprintTemplates.js";
import { createAdminClient } from "../lib/supabase.js";
import {
  getEsp32Status,
  recordButtonPress,
  recordHeartbeat,
} from "../lib/esp32State.js";

const router = Router();

router.use(express.json());

function requireDeviceToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = req.header("X-Device-Token");
  if (!token || token !== config.esp32DeviceToken) {
    res.status(401).json({ error: "Token de dispositivo inválido" });
    return;
  }
  next();
}

router.use(requireDeviceToken);

router.get("/heartbeat", (_req, res) => {
  recordHeartbeat();
  res.json({ ok: true });
});

router.post("/heartbeat", (_req, res) => {
  recordHeartbeat();
  res.json({ ok: true });
});

router.post("/button", (_req, res) => {
  recordButtonPress();
  res.json({ ok: true, ...getEsp32Status() });
});

router.get("/huella/pendiente", (_req, res) => {
  recordHeartbeat();
  const claimed = claimPending();
  if (!claimed.pending) {
    res.json({ pending: false });
    return;
  }

  res.json({
    pending: true,
    sessionId: claimed.sessionId,
    slotId: claimed.slotId,
    mode: claimed.mode,
    userId: claimed.userId,
  });
});

const VALID_STEPS: FingerprintStep[] = [
  "place_finger",
  "remove_finger",
  "place_again",
  "processing",
];

router.post("/huella/progreso", (req, res) => {
  recordHeartbeat();
  const sessionId = String(req.body?.sessionId ?? "").trim();
  const step = req.body?.step as FingerprintStep;

  if (!sessionId || !VALID_STEPS.includes(step)) {
    res.status(400).json({ error: "sessionId o step inválido" });
    return;
  }

  const ok = updateStep(sessionId, step);
  if (!ok) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  res.json({ ok: true });
});

router.post("/huella/resultado", async (req, res) => {
  recordHeartbeat();
  const sessionId = String(req.body?.sessionId ?? "").trim();
  const success = req.body?.success === true;
  const slotId =
    req.body?.slotId !== undefined ? Number(req.body.slotId) : undefined;
  const errorMessage =
    typeof req.body?.error === "string" ? req.body.error.trim() : "";
  const templateBase64 =
    typeof req.body?.templateBase64 === "string"
      ? req.body.templateBase64.trim()
      : "";

  if (!sessionId) {
    res.status(400).json({ error: "sessionId requerido" });
    return;
  }

  const session = getActiveSession();
  if (!session || session.sessionId !== sessionId) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }

  if (!success) {
    completeError(sessionId, errorMessage || "Error en el sensor de huella");
    res.json({ ok: true });
    return;
  }

  const supabase = createAdminClient();

  try {
    if (session.mode === "enroll") {
      const resolvedSlot = slotId ?? session.slotId;
      const { error } = await supabase
        .from("usuarios")
        .update({ huella_id: resolvedSlot })
        .eq("id_usuario", session.userId);

      if (error) {
        completeError(sessionId, error.message);
        res.status(500).json({ error: error.message });
        return;
      }

      if (templateBase64.length > 0) {
        try {
          await saveTemplate(session.userId, resolvedSlot, templateBase64);
        } catch (templateError) {
          const message =
            templateError instanceof Error
              ? templateError.message
              : "Error al guardar template";
          completeError(sessionId, message);
          res.status(500).json({ error: message });
          return;
        }
      }
    } else {
      const { error } = await supabase
        .from("usuarios")
        .update({ huella_id: null })
        .eq("id_usuario", session.userId);

      if (error) {
        completeError(sessionId, error.message);
        res.status(500).json({ error: error.message });
        return;
      }

      try {
        await deleteTemplate(session.userId);
      } catch (templateError) {
        const message =
          templateError instanceof Error
            ? templateError.message
            : "Error al borrar template";
        completeError(sessionId, message);
        res.status(500).json({ error: message });
        return;
      }
    }

    completeSuccess(sessionId);
    res.json({ ok: true, slotId: session.slotId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error interno";
    completeError(sessionId, message);
    res.status(500).json({ error: message });
  }
});

router.get("/huella/lote/pendiente", (_req, res) => {
  recordHeartbeat();

  if (hasActiveUserFingerprintSession()) {
    res.json({ pending: false });
    return;
  }

  const claimed = claimPendingDeviceJob();
  if (!claimed.pending) {
    res.json({ pending: false });
    return;
  }

  markDeviceJobProcessing(claimed.sessionId);

  res.json({
    pending: true,
    sessionId: claimed.sessionId,
    jobType: claimed.jobType,
    total: claimed.jobType === "restore" ? claimed.queue.length : null,
  });
});

router.get("/huella/lote/siguiente", (req, res) => {
  recordHeartbeat();
  const sessionId = String(req.query.sessionId ?? "").trim();

  if (!sessionId) {
    res.status(400).json({ error: "sessionId requerido" });
    return;
  }

  try {
    const next = getNextQueueItem(sessionId);
    if (next.done) {
      res.json({ done: true });
      return;
    }

    res.json({
      done: false,
      index: next.index,
      userId: next.userId,
      slotId: next.slotId,
      templateBase64: next.templateBase64,
    });
  } catch (e) {
    const status =
      typeof e === "object" && e !== null && "status" in e
        ? Number((e as { status: unknown }).status) || 500
        : 500;
    const message = e instanceof Error ? e.message : "Error interno";
    res.status(status).json({ error: message });
  }
});

router.post("/huella/lote/progreso", async (req, res) => {
  recordHeartbeat();
  const sessionId = String(req.body?.sessionId ?? "").trim();
  const index =
    req.body?.index !== undefined ? Number(req.body.index) : undefined;
  const success = req.body?.success === true;
  const slotId =
    req.body?.slotId !== undefined ? Number(req.body.slotId) : undefined;
  const userId =
    typeof req.body?.userId === "string" ? req.body.userId.trim() : "";

  if (!sessionId || index === undefined || Number.isNaN(index)) {
    res.status(400).json({ error: "sessionId e index requeridos" });
    return;
  }

  const ok = markItemDone(sessionId, index, success);
  if (!ok) {
    res.status(404).json({ error: "Sesión o índice no válido" });
    return;
  }

  if (success && userId && slotId !== undefined && !Number.isNaN(slotId)) {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("usuarios")
      .update({ huella_id: slotId })
      .eq("id_usuario", userId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
  }

  res.json({ ok: true });
});

router.post("/huella/lote/resultado", async (req, res) => {
  recordHeartbeat();
  const sessionId = String(req.body?.sessionId ?? "").trim();
  const success = req.body?.success === true;
  const errorMessage =
    typeof req.body?.error === "string" ? req.body.error.trim() : "";

  if (!sessionId) {
    res.status(400).json({ error: "sessionId requerido" });
    return;
  }

  if (!hasActiveDeviceJob()) {
    res.status(404).json({ error: "Sesión de lote no encontrada" });
    return;
  }

  const job = completeDeviceJob(
    sessionId,
    success,
    errorMessage || undefined
  );

  if (!job) {
    res.status(404).json({ error: "Sesión de lote no encontrada" });
    return;
  }

  if (success && job.jobType === "wipe") {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("usuarios")
      .update({ huella_id: null })
      .not("huella_id", "is", null);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
  }

  res.json({
    ok: true,
    jobType: job.jobType,
    succeeded: job.succeeded,
    failed: job.failed,
  });
});

export default router;
