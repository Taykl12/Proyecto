import express, {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import { config } from "../config.js";
import {
  claimPending,
  completeError,
  completeSuccess,
  getActiveSession,
  updateStep,
  type FingerprintStep,
} from "../lib/fingerprintState.js";
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
    }

    completeSuccess(sessionId);
    res.json({ ok: true, slotId: session.slotId });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error interno";
    completeError(sessionId, message);
    res.status(500).json({ error: message });
  }
});

export default router;
