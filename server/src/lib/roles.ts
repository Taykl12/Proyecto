export async function userIsAlumno(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("roles(nombre_rol)")
    .eq("id_usuario", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const roles = data?.roles as { nombre_rol: string } | { nombre_rol: string }[] | null;
  const raw = Array.isArray(roles) ? roles[0]?.nombre_rol : roles?.nombre_rol;
  return raw?.trim().toLowerCase() === "alumno";
}

export async function userIsProfessor(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("roles(nombre_rol)")
    .eq("id_usuario", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const roles = data?.roles as { nombre_rol: string } | { nombre_rol: string }[] | null;
  const raw = Array.isArray(roles) ? roles[0]?.nombre_rol : roles?.nombre_rol;
  return raw?.trim().toLowerCase() === "profesor";
}

export async function userIsAdmin(
  supabase: import("@supabase/supabase-js").SupabaseClient,
  userId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("roles(nombre_rol)")
    .eq("id_usuario", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const roles = data?.roles as { nombre_rol: string } | { nombre_rol: string }[] | null;
  const raw = Array.isArray(roles) ? roles[0]?.nombre_rol : roles?.nombre_rol;
  return raw?.trim().toLowerCase() === "admin";
}
