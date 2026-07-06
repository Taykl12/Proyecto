import type { SupabaseClient } from "@supabase/supabase-js";

const MIN_SLOT = 0;
const MAX_SLOT = 199;

export async function getNextFreeSlot(
  supabase: SupabaseClient
): Promise<number> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("huella_id")
    .not("huella_id", "is", null);

  if (error) throw new Error(error.message);

  const used = new Set(
    (data ?? [])
      .map((row: { huella_id: number | null }) => row.huella_id)
      .filter((slot): slot is number => slot !== null)
  );

  for (let slot = MIN_SLOT; slot <= MAX_SLOT; slot += 1) {
    if (!used.has(slot)) return slot;
  }

  throw Object.assign(new Error("No hay slots libres en el sensor (0–199)"), {
    status: 409,
  });
}
