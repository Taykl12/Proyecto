import { Router } from "express";
import { createAdminClient } from "../lib/supabase.js";
import {
  cancelSession,
  getSessionForUser,
  startSession,
} from "../lib/fingerprintState.js";
import { getNextFreeSlot } from "../lib/fingerprintSlots.js";
import { userIsAlumno } from "../lib/roles.js";
import { requireAdmin } from "../middleware/admin.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth, requireAdmin);

async function getUserHuellaId(userId: string): Promise<number | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("usuarios")
    .select("huella_id")
    .eq("id_usuario", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as { huella_id: number | null } | null)?.huella_id ?? null;
}

async function assertUserExists(userId: string): Promise<void> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("usuarios")
    .select("id_usuario")
    .eq("id_usuario", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
  }
}

async function assertUserCanHaveHuella(userId: string): Promise<void> {
  await assertUserExists(userId);
  const supabase = createAdminClient();
  const isAlumno = await userIsAlumno(supabase, userId);
  if (!isAlumno) {
    throw Object.assign(
      new Error("Solo los usuarios con rol Alumno pueden tener huella asignada"),
      { status: 400 }
    );
  }
}

function statusFromError(e: unknown): number {
  return typeof e === "object" && e !== null && "status" in e
    ? Number((e as { status: unknown }).status) || 500
    : 500;
}

function messageFromError(e: unknown): string {
  return e instanceof Error ? e.message : "Error interno";
}

router.post("/:id/huella/iniciar", async (req, res) => {
  try {
    const userId = req.params.id;
    await assertUserCanHaveHuella(userId);

    const supabase = createAdminClient();
    const existing = await getUserHuellaId(userId);
    const slotId =
      existing !== null ? existing : await getNextFreeSlot(supabase);

    const session = startSession(userId, slotId, "enroll");
    res.status(201).json({
      sessionId: session.sessionId,
      slotId: session.slotId,
      step: session.step,
    });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.get("/:id/huella/estado", async (req, res) => {
  try {
    const userId = req.params.id;
    res.json(getSessionForUser(userId));
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.post("/:id/huella/cancelar", async (req, res) => {
  try {
    const userId = req.params.id;
    cancelSession(userId);
    res.json({ cancelled: true });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.delete("/:id/huella", async (req, res) => {
  try {
    const userId = req.params.id;
    await assertUserExists(userId);

    const existing = await getUserHuellaId(userId);
    if (existing === null) {
      res.json({ removed: true, huellaId: null });
      return;
    }

    const session = startSession(userId, existing, "delete");
    res.json({
      sessionId: session.sessionId,
      slotId: session.slotId,
      step: session.step,
      pendingDevice: true,
    });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

export default router;
