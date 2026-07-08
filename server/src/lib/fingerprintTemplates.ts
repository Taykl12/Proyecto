import { createAdminClient } from "./supabase.js";

export interface TemplateRecord {
  userId: string;
  slotId: number;
  templateBase64: string;
}

export async function saveTemplate(
  userId: string,
  slotId: number,
  templateBase64: string
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.from("huellas").upsert(
    {
      id_usuario: userId,
      slot_id: slotId,
      template_data: templateBase64,
      fecha_actualizacion: new Date().toISOString(),
    },
    { onConflict: "id_usuario" }
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function getTemplate(
  userId: string
): Promise<TemplateRecord | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("huellas")
    .select("id_usuario, slot_id, template_data")
    .eq("id_usuario", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;

  const row = data as {
    id_usuario: string;
    slot_id: number;
    template_data: string;
  };

  return {
    userId: row.id_usuario,
    slotId: row.slot_id,
    templateBase64: row.template_data,
  };
}

export async function deleteTemplate(userId: string): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("huellas")
    .delete()
    .eq("id_usuario", userId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function listAllTemplates(): Promise<TemplateRecord[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("huellas")
    .select("id_usuario, slot_id, template_data")
    .order("slot_id", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => {
    const item = row as {
      id_usuario: string;
      slot_id: number;
      template_data: string;
    };
    return {
      userId: item.id_usuario,
      slotId: item.slot_id,
      templateBase64: item.template_data,
    };
  });
}
