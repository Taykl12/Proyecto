import { Router } from "express";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "../lib/supabase.js";
import {
  composeCourseName,
  validateDivisionForYear,
  validateHorario,
  validateSuperiorSpecialty,
} from "../lib/adminAcademic.js";
import { getEsp32Status, resetPressCount } from "../lib/esp32State.js";
import { requireAdmin } from "../middleware/admin.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

interface RoleRow {
  id_rol: number;
  nombre_rol: string;
}

interface RoleDto {
  id: number;
  name: string;
  label: string;
}

interface UserProfileRow {
  id_usuario: string;
  dni: string | null;
  nombre: string | null;
  apellido: string | null;
  telefono: string | null;
  foto_perfil: string | null;
  id_rol: number;
  huella_id: number | null;
  fecha_registro: string | null;
  roles?: { nombre_rol: string } | { nombre_rol: string }[] | null;
}

interface AdminUserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dni: string;
  phone: string;
  roleId: number | null;
  roleLabel: string;
  profilePhotoUrl: string | null;
  huellaId: number | null;
  createdAt: string;
}

interface CourseRow {
  id_curso: number;
  nombre_curso: string;
  anio_lectivo: number;
  especialidad: string | null;
  division: string | null;
}

interface CourseAssignmentRow {
  id_curso: number;
  id_usuario: string;
}

interface CourseDto {
  id: string;
  name: string;
  year: number;
  division: string;
  specialty: string;
  assignedUserIds: string[];
  subjectCount: number;
}

interface SubjectRow {
  id_materia: number;
  nombre_materia: string;
  id_curso: number;
  horario: string | null;
  cursos?: { nombre_curso: string } | { nombre_curso: string }[] | null;
}

interface SubjectTeacherRow {
  id_materia: number;
  id_profesor: string;
}

interface SubjectDto {
  id: string;
  name: string;
  courseId: string;
  courseName: string;
  horario: string;
  professorIds: string[];
}

interface ProfilePayload {
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  dni?: string;
  phone?: string;
  roleId?: number;
}

function roleLabel(name: string | null | undefined): string {
  const raw = name?.trim();
  if (!raw) return "Sin rol";
  const normalized = raw.toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function roleNameFromJoin(
  roles: { nombre_rol: string } | { nombre_rol: string }[] | null | undefined
): string | undefined {
  if (!roles) return undefined;
  return Array.isArray(roles) ? roles[0]?.nombre_rol : roles.nombre_rol;
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | null {
  const next = toTrimmedString(value);
  return next || null;
}

function parseIdParam(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeEmail(value: unknown): string {
  return toTrimmedString(value).toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function mapRole(row: RoleRow): RoleDto {
  return {
    id: row.id_rol,
    name: row.nombre_rol,
    label: roleLabel(row.nombre_rol),
  };
}

function mapCourse(
  row: CourseRow,
  assignedUserIds: string[],
  subjectCount: number
): CourseDto {
  const composed = composeCourseName(row.anio_lectivo, row.division ?? "", row.especialidad ?? "");
  return {
    id: String(row.id_curso),
    name: composed || row.nombre_curso,
    year: row.anio_lectivo,
    division: row.division ?? "",
    specialty: row.especialidad ?? "",
    assignedUserIds,
    subjectCount,
  };
}

function mapSubject(row: SubjectRow, professorIds: string[]): SubjectDto {
  const course = row.cursos;
  const courseName = Array.isArray(course)
    ? course[0]?.nombre_curso
    : course?.nombre_curso;
  return {
    id: String(row.id_materia),
    name: row.nombre_materia,
    courseId: String(row.id_curso),
    courseName: courseName ?? "Curso",
    horario: row.horario ?? "",
    professorIds,
  };
}

function mapUser(
  authUser: User | undefined,
  profile: UserProfileRow | undefined
): AdminUserDto {
  const roleName = roleNameFromJoin(profile?.roles);
  const metadata = authUser?.user_metadata ?? {};
  const metadataFirstName =
    typeof metadata.nombre === "string" ? metadata.nombre : undefined;
  const metadataLastName =
    typeof metadata.apellido === "string" ? metadata.apellido : undefined;
  return {
    id: authUser?.id ?? profile?.id_usuario ?? "",
    email: authUser?.email ?? "",
    firstName: profile?.nombre ?? metadataFirstName ?? "",
    lastName: profile?.apellido ?? metadataLastName ?? "",
    dni: profile?.dni ?? "",
    phone: profile?.telefono ?? "",
    roleId: profile?.id_rol ?? null,
    roleLabel: roleLabel(roleName),
    profilePhotoUrl: profile?.foto_perfil ?? null,
    huellaId: profile?.huella_id ?? null,
    createdAt: profile?.fecha_registro ?? authUser?.created_at ?? "",
  };
}

async function listRoles(supabase: SupabaseClient): Promise<RoleDto[]> {
  const { data, error } = await supabase
    .from("roles")
    .select("id_rol, nombre_rol")
    .order("id_rol", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as RoleRow[]).map(mapRole);
}

async function getRoleName(
  supabase: SupabaseClient,
  roleId: number
): Promise<string | null> {
  const { data, error } = await supabase
    .from("roles")
    .select("nombre_rol")
    .eq("id_rol", roleId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { nombre_rol: string } | null)?.nombre_rol ?? null;
}

async function getAdminRoleId(supabase: SupabaseClient): Promise<number | null> {
  const { data, error } = await supabase
    .from("roles")
    .select("id_rol")
    .eq("nombre_rol", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { id_rol: number } | null)?.id_rol ?? null;
}

async function countAdmins(supabase: SupabaseClient): Promise<number> {
  const adminRoleId = await getAdminRoleId(supabase);
  if (!adminRoleId) return 0;
  const { count, error } = await supabase
    .from("usuarios")
    .select("id_usuario", { count: "exact", head: true })
    .eq("id_rol", adminRoleId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function listAuthUsers(supabase: SupabaseClient): Promise<User[]> {
  const perPage = 1000;
  const users: User[] = [];
  for (let page = 1; page < 100; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    users.push(...data.users);
    if (data.users.length < perPage) break;
  }
  return users;
}

async function listUserProfiles(supabase: SupabaseClient): Promise<UserProfileRow[]> {
  const { data, error } = await supabase
    .from("usuarios")
    .select(
      "id_usuario, dni, nombre, apellido, telefono, foto_perfil, id_rol, huella_id, fecha_registro, roles(nombre_rol)"
    )
    .order("fecha_registro", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as UserProfileRow[];
}

async function listAdminUsers(supabase: SupabaseClient): Promise<AdminUserDto[]> {
  const [authUsers, profiles] = await Promise.all([
    listAuthUsers(supabase),
    listUserProfiles(supabase),
  ]);
  const profilesById = new Map(profiles.map((profile) => [profile.id_usuario, profile]));
  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const rows = authUsers.map((user) => mapUser(user, profilesById.get(user.id)));
  for (const profile of profiles) {
    if (!authById.has(profile.id_usuario)) {
      rows.push(mapUser(undefined, profile));
    }
  }
  return rows.sort((a, b) => a.lastName.localeCompare(b.lastName));
}

async function getAdminUser(
  supabase: SupabaseClient,
  userId: string
): Promise<AdminUserDto | null> {
  const [{ data: authData }, { data: profile, error: profileError }] = await Promise.all([
    supabase.auth.admin.getUserById(userId),
    supabase
      .from("usuarios")
      .select(
        "id_usuario, dni, nombre, apellido, telefono, foto_perfil, id_rol, huella_id, fecha_registro, roles(nombre_rol)"
      )
      .eq("id_usuario", userId)
      .maybeSingle(),
  ]);
  if (profileError) throw new Error(profileError.message);
  const authUser = authData.user ?? undefined;
  const profileRow = profile as UserProfileRow | null;
  if (!authUser && !profileRow) return null;
  return mapUser(authUser, profileRow ?? undefined);
}

function matchesUserQuery(user: AdminUserDto, query: string): boolean {
  if (!query) return true;
  const haystack = [
    user.email,
    user.firstName,
    user.lastName,
    user.dni,
    user.phone,
    user.roleLabel,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

async function assertRoleExists(
  supabase: SupabaseClient,
  roleId: number
): Promise<string> {
  const roleName = await getRoleName(supabase, roleId);
  if (!roleName) throw Object.assign(new Error("Rol inválido"), { status: 400 });
  return roleName;
}

function readCreateUserPayload(body: unknown): Required<ProfilePayload> {
  const raw = body as Record<string, unknown>;
  const email = normalizeEmail(raw.email);
  const password = toTrimmedString(raw.password);
  const firstName = toTrimmedString(raw.firstName);
  const lastName = toTrimmedString(raw.lastName);
  const roleId = Number(raw.roleId);
  if (!isEmail(email)) throw Object.assign(new Error("Email inválido"), { status: 400 });
  if (password.length < 6) {
    throw Object.assign(new Error("La contraseña debe tener al menos 6 caracteres"), {
      status: 400,
    });
  }
  if (!firstName || !lastName) {
    throw Object.assign(new Error("Nombre y apellido son requeridos"), { status: 400 });
  }
  if (!Number.isInteger(roleId)) {
    throw Object.assign(new Error("Rol requerido"), { status: 400 });
  }
  return {
    email,
    password,
    firstName,
    lastName,
    dni: optionalString(raw.dni) ?? "",
    phone: optionalString(raw.phone) ?? "",
    roleId,
  };
}

function readUpdateUserPayload(body: unknown): ProfilePayload {
  const raw = body as Record<string, unknown>;
  const payload: ProfilePayload = {};
  if ("email" in raw) {
    const email = normalizeEmail(raw.email);
    if (!isEmail(email)) throw Object.assign(new Error("Email inválido"), { status: 400 });
    payload.email = email;
  }
  if ("password" in raw) {
    const password = toTrimmedString(raw.password);
    if (password && password.length < 6) {
      throw Object.assign(new Error("La contraseña debe tener al menos 6 caracteres"), {
        status: 400,
      });
    }
    if (password) payload.password = password;
  }
  if ("firstName" in raw) payload.firstName = toTrimmedString(raw.firstName);
  if ("lastName" in raw) payload.lastName = toTrimmedString(raw.lastName);
  if ("dni" in raw) payload.dni = optionalString(raw.dni) ?? "";
  if ("phone" in raw) payload.phone = optionalString(raw.phone) ?? "";
  if ("roleId" in raw) {
    const roleId = Number(raw.roleId);
    if (!Number.isInteger(roleId)) {
      throw Object.assign(new Error("Rol inválido"), { status: 400 });
    }
    payload.roleId = roleId;
  }
  return payload;
}

function statusFromError(e: unknown): number {
  return typeof e === "object" && e !== null && "status" in e
    ? Number((e as { status: unknown }).status) || 500
    : 500;
}

function messageFromError(e: unknown): string {
  return e instanceof Error ? e.message : "Error interno";
}

async function assertCanChangeRole(
  supabase: SupabaseClient,
  actorId: string,
  targetId: string,
  nextRoleId: number
): Promise<void> {
  const nextRoleName = await assertRoleExists(supabase, nextRoleId);
  if (actorId === targetId && nextRoleName.toLowerCase() !== "admin") {
    throw Object.assign(new Error("No podés quitarte el rol administrador"), {
      status: 400,
    });
  }

  const adminRoleId = await getAdminRoleId(supabase);
  if (!adminRoleId || nextRoleId === adminRoleId) return;
  const { data, error } = await supabase
    .from("usuarios")
    .select("id_rol")
    .eq("id_usuario", targetId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const currentRoleId = (data as { id_rol: number } | null)?.id_rol;
  if (currentRoleId === adminRoleId && (await countAdmins(supabase)) <= 1) {
    throw Object.assign(new Error("Debe quedar al menos un administrador"), {
      status: 400,
    });
  }
}

const router = Router();

router.use(requireAuth, requireAdmin);

router.get("/roles", async (_req, res) => {
  try {
    const supabase = createAdminClient();
    res.json({ roles: await listRoles(supabase) });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.get("/summary", async (_req, res) => {
  try {
    const supabase = createAdminClient();
    const [users, courses, subjects] = await Promise.all([
      supabase.from("usuarios").select("id_usuario", { count: "exact", head: true }),
      supabase.from("cursos").select("id_curso", { count: "exact", head: true }),
      supabase.from("materias").select("id_materia", { count: "exact", head: true }),
    ]);
    if (users.error) throw new Error(users.error.message);
    if (courses.error) throw new Error(courses.error.message);
    if (subjects.error) throw new Error(subjects.error.message);
    res.json({
      users: users.count ?? 0,
      courses: courses.count ?? 0,
      subjects: subjects.count ?? 0,
    });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.get("/users", async (req, res) => {
  try {
    const supabase = createAdminClient();
    const query = String(req.query.q ?? "").trim();
    const [users, roles] = await Promise.all([listAdminUsers(supabase), listRoles(supabase)]);
    res.json({
      users: users.filter((user) => matchesUserQuery(user, query)),
      roles,
    });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.post("/users", async (req, res) => {
  const supabase = createAdminClient();
  let createdUserId: string | null = null;
  try {
    const payload = readCreateUserPayload(req.body);
    await assertRoleExists(supabase, payload.roleId);
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: payload.email,
      password: payload.password,
      email_confirm: true,
      user_metadata: {
        nombre: payload.firstName,
        apellido: payload.lastName,
      },
    });
    if (authError || !authData.user) {
      throw Object.assign(new Error(authError?.message ?? "No se pudo crear el usuario"), {
        status: 400,
      });
    }
    createdUserId = authData.user.id;
    const { error: profileError } = await supabase.from("usuarios").insert({
      id_usuario: authData.user.id,
      nombre: payload.firstName,
      apellido: payload.lastName,
      dni: payload.dni || null,
      telefono: payload.phone || null,
      id_rol: payload.roleId,
    });
    if (profileError) {
      throw Object.assign(new Error(profileError.message), { status: 400 });
    }
    const user = await getAdminUser(supabase, authData.user.id);
    res.status(201).json({ user });
  } catch (e) {
    if (createdUserId) {
      await supabase.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    }
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.patch("/users/:id", async (req, res) => {
  try {
    const { userId: actorId } = req as unknown as AuthedRequest;
    const targetId = req.params.id;
    const supabase = createAdminClient();
    const payload = readUpdateUserPayload(req.body);
    if (payload.roleId != null) {
      await assertCanChangeRole(supabase, actorId, targetId, payload.roleId);
    }

    const authUpdates: {
      email?: string;
      password?: string;
      user_metadata?: { nombre?: string; apellido?: string };
    } = {};
    if (payload.email) authUpdates.email = payload.email;
    if (payload.password) authUpdates.password = payload.password;
    if (payload.firstName != null || payload.lastName != null) {
      authUpdates.user_metadata = {
        ...(payload.firstName != null ? { nombre: payload.firstName } : {}),
        ...(payload.lastName != null ? { apellido: payload.lastName } : {}),
      };
    }
    if (Object.keys(authUpdates).length > 0) {
      const { error } = await supabase.auth.admin.updateUserById(targetId, authUpdates);
      if (error) throw Object.assign(new Error(error.message), { status: 400 });
    }

    const profileUpdates: Record<string, string | number | null> = {};
    if (payload.firstName != null) profileUpdates.nombre = payload.firstName;
    if (payload.lastName != null) profileUpdates.apellido = payload.lastName;
    if (payload.dni != null) profileUpdates.dni = payload.dni || null;
    if (payload.phone != null) profileUpdates.telefono = payload.phone || null;
    if (payload.roleId != null) profileUpdates.id_rol = payload.roleId;
    if (Object.keys(profileUpdates).length > 0) {
      const { error } = await supabase
        .from("usuarios")
        .update(profileUpdates)
        .eq("id_usuario", targetId);
      if (error) throw Object.assign(new Error(error.message), { status: 400 });
    }
    const user = await getAdminUser(supabase, targetId);
    if (!user) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    res.json({ user });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.delete("/users/:id", async (req, res) => {
  try {
    const { userId: actorId } = req as unknown as AuthedRequest;
    const targetId = req.params.id;
    if (actorId === targetId) {
      throw Object.assign(new Error("No podés eliminar tu propia cuenta"), { status: 400 });
    }
    const supabase = createAdminClient();
    const target = await getAdminUser(supabase, targetId);
    if (!target) throw Object.assign(new Error("Usuario no encontrado"), { status: 404 });
    const adminRoleId = await getAdminRoleId(supabase);
    if (target.roleId === adminRoleId && (await countAdmins(supabase)) <= 1) {
      throw Object.assign(new Error("Debe quedar al menos un administrador"), {
        status: 400,
      });
    }
    const { error: profileError } = await supabase
      .from("usuarios")
      .delete()
      .eq("id_usuario", targetId);
    if (profileError) {
      throw Object.assign(
        new Error("No se puede eliminar: el usuario tiene datos relacionados"),
        { status: 409 }
      );
    }
    const { error: authError } = await supabase.auth.admin.deleteUser(targetId);
    if (authError) throw Object.assign(new Error(authError.message), { status: 400 });
    res.json({ deleted: targetId });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

async function listCourses(supabase: SupabaseClient): Promise<CourseDto[]> {
  const [coursesResult, assignmentsResult, subjectsResult] = await Promise.all([
    supabase
      .from("cursos")
      .select("id_curso, nombre_curso, anio_lectivo, especialidad, division")
      .order("anio_lectivo", { ascending: true })
      .order("division", { ascending: true }),
    supabase.from("cursos_usuarios_asignados").select("id_curso, id_usuario"),
    supabase.from("materias").select("id_materia, id_curso"),
  ]);
  if (coursesResult.error) throw new Error(coursesResult.error.message);
  if (assignmentsResult.error) throw new Error(assignmentsResult.error.message);
  if (subjectsResult.error) throw new Error(subjectsResult.error.message);
  const assignments = (assignmentsResult.data ?? []) as CourseAssignmentRow[];
  const subjects = (subjectsResult.data ?? []) as { id_curso: number }[];
  return ((coursesResult.data ?? []) as CourseRow[]).map((course) =>
    mapCourse(
      course,
      assignments
        .filter((assignment) => assignment.id_curso === course.id_curso)
        .map((assignment) => assignment.id_usuario),
      subjects.filter((subject) => subject.id_curso === course.id_curso).length
    )
  );
}

function readCoursePayload(body: unknown): {
  name: string;
  year: number;
  division: string;
  specialty: string;
} {
  const raw = body as Record<string, unknown>;
  const year = Number(raw.year);
  const division = toTrimmedString(raw.division);
  const specialtyInput = toTrimmedString(raw.specialty);
  if (!Number.isInteger(year) || year < 1 || year > 6) {
    throw Object.assign(new Error("Año inválido"), { status: 400 });
  }
  validateDivisionForYear(year, division);
  const specialty = validateSuperiorSpecialty(year, specialtyInput);
  return {
    name: composeCourseName(year, division, specialty),
    year,
    division,
    specialty,
  };
}

router.get("/cursos", async (_req, res) => {
  try {
    const supabase = createAdminClient();
    res.json({ courses: await listCourses(supabase) });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.post("/cursos", async (req, res) => {
  try {
    const payload = readCoursePayload(req.body);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("cursos")
      .insert({
        nombre_curso: payload.name,
        anio_lectivo: payload.year,
        especialidad: payload.specialty,
        division: payload.division,
      })
      .select("id_curso, nombre_curso, anio_lectivo, especialidad, division")
      .single();
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    res.status(201).json({ course: mapCourse(data as CourseRow, [], 0) });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.patch("/cursos/:id", async (req, res) => {
  try {
    const courseId = parseIdParam(req.params.id);
    if (!courseId) throw Object.assign(new Error("Curso inválido"), { status: 400 });
    const payload = readCoursePayload(req.body);
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("cursos")
      .update({
        nombre_curso: payload.name,
        anio_lectivo: payload.year,
        especialidad: payload.specialty,
        division: payload.division,
      })
      .eq("id_curso", courseId);
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    const course = (await listCourses(supabase)).find((item) => item.id === String(courseId));
    if (!course) throw Object.assign(new Error("Curso no encontrado"), { status: 404 });
    res.json({ course });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.delete("/cursos/:id", async (req, res) => {
  try {
    const courseId = parseIdParam(req.params.id);
    if (!courseId) throw Object.assign(new Error("Curso inválido"), { status: 400 });
    const supabase = createAdminClient();
    const { count: subjectsCount, error: subjectsError } = await supabase
      .from("materias")
      .select("id_materia", { count: "exact", head: true })
      .eq("id_curso", courseId);
    if (subjectsError) throw new Error(subjectsError.message);
    if ((subjectsCount ?? 0) > 0) {
      throw Object.assign(new Error("No se puede borrar un curso con materias"), {
        status: 409,
      });
    }
    await supabase.from("cursos_usuarios_asignados").delete().eq("id_curso", courseId);
    const { error } = await supabase.from("cursos").delete().eq("id_curso", courseId);
    if (error) {
      throw Object.assign(
        new Error("No se puede eliminar: el curso tiene datos relacionados"),
        { status: 409 }
      );
    }
    res.json({ deleted: String(courseId) });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

async function roleNameByUserId(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("usuarios")
    .select("roles(nombre_rol)")
    .eq("id_usuario", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return roleNameFromJoin(
    (data as { roles?: { nombre_rol: string } | { nombre_rol: string }[] | null } | null)
      ?.roles
  ) ?? null;
}

function readIdArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw Object.assign(new Error(`${label} debe ser una lista`), { status: 400 });
  }
  return [...new Set(value.map((item) => toTrimmedString(item)).filter(Boolean))];
}

router.put("/cursos/:id/users", async (req, res) => {
  try {
    const courseId = parseIdParam(req.params.id);
    if (!courseId) throw Object.assign(new Error("Curso inválido"), { status: 400 });
    const userIds = readIdArray((req.body as { userIds?: unknown }).userIds, "Usuarios");
    const supabase = createAdminClient();
    const rows = await Promise.all(
      userIds.map(async (userId) => ({
        id_curso: courseId,
        id_usuario: userId,
        rol_en_curso: (await roleNameByUserId(supabase, userId)) ?? "alumno",
      }))
    );
    await supabase.from("cursos_usuarios_asignados").delete().eq("id_curso", courseId);
    if (rows.length > 0) {
      const { error } = await supabase.from("cursos_usuarios_asignados").insert(rows);
      if (error) throw Object.assign(new Error(error.message), { status: 400 });
    }
    const course = (await listCourses(supabase)).find((item) => item.id === String(courseId));
    if (!course) throw Object.assign(new Error("Curso no encontrado"), { status: 404 });
    res.json({ course });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

async function listSubjects(
  supabase: SupabaseClient,
  courseId?: number
): Promise<SubjectDto[]> {
  let query = supabase
    .from("materias")
    .select("id_materia, nombre_materia, id_curso, horario, cursos(nombre_curso)")
    .order("nombre_materia", { ascending: true });
  if (courseId) query = query.eq("id_curso", courseId);
  const [subjectsResult, teachersResult] = await Promise.all([
    query,
    supabase.from("materia_profesor").select("id_materia, id_profesor"),
  ]);
  if (subjectsResult.error) throw new Error(subjectsResult.error.message);
  if (teachersResult.error) throw new Error(teachersResult.error.message);
  const teachers = (teachersResult.data ?? []) as SubjectTeacherRow[];
  return ((subjectsResult.data ?? []) as SubjectRow[]).map((subject) =>
    mapSubject(
      subject,
      teachers
        .filter((teacher) => teacher.id_materia === subject.id_materia)
        .map((teacher) => teacher.id_profesor)
    )
  );
}

function readSubjectPayload(body: unknown): {
  name: string;
  courseId: number;
  horario: string | null;
} {
  const raw = body as Record<string, unknown>;
  const name = toTrimmedString(raw.name);
  const courseId = Number(raw.courseId);
  if (!name) throw Object.assign(new Error("Nombre de la materia requerido"), { status: 400 });
  if (!Number.isInteger(courseId) || courseId <= 0) {
    throw Object.assign(new Error("Curso requerido"), { status: 400 });
  }
  const horario = optionalString(raw.horario);
  validateHorario(horario);
  return { name, courseId, horario };
}

router.get("/materias", async (req, res) => {
  try {
    const rawCourseId = req.query.courseId ? Number(req.query.courseId) : undefined;
    const courseId = Number.isInteger(rawCourseId) ? rawCourseId : undefined;
    const supabase = createAdminClient();
    res.json({ subjects: await listSubjects(supabase, courseId) });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.post("/materias", async (req, res) => {
  try {
    const payload = readSubjectPayload(req.body);
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("materias")
      .insert({
        nombre_materia: payload.name,
        id_curso: payload.courseId,
        horario: payload.horario,
      })
      .select("id_materia, nombre_materia, id_curso, horario, cursos(nombre_curso)")
      .single();
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    res.status(201).json({ subject: mapSubject(data as SubjectRow, []) });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.patch("/materias/:id", async (req, res) => {
  try {
    const subjectId = parseIdParam(req.params.id);
    if (!subjectId) throw Object.assign(new Error("Materia inválida"), { status: 400 });
    const payload = readSubjectPayload(req.body);
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("materias")
      .update({
        nombre_materia: payload.name,
        id_curso: payload.courseId,
        horario: payload.horario,
      })
      .eq("id_materia", subjectId);
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    const subject = (await listSubjects(supabase)).find((item) => item.id === String(subjectId));
    if (!subject) throw Object.assign(new Error("Materia no encontrada"), { status: 404 });
    res.json({ subject });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.delete("/materias/:id", async (req, res) => {
  try {
    const subjectId = parseIdParam(req.params.id);
    if (!subjectId) throw Object.assign(new Error("Materia inválida"), { status: 400 });
    const supabase = createAdminClient();
    const { count, error: projectError } = await supabase
      .from("proyecto_materia")
      .select("id_proyecto_materia", { count: "exact", head: true })
      .eq("id_materia", subjectId);
    if (projectError) throw new Error(projectError.message);
    if ((count ?? 0) > 0) {
      throw Object.assign(new Error("No se puede borrar una materia asociada a proyectos"), {
        status: 409,
      });
    }
    await supabase.from("materia_profesor").delete().eq("id_materia", subjectId);
    const { error } = await supabase.from("materias").delete().eq("id_materia", subjectId);
    if (error) {
      throw Object.assign(
        new Error("No se puede eliminar: la materia tiene datos relacionados"),
        { status: 409 }
      );
    }
    res.json({ deleted: String(subjectId) });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.put("/materias/:id/profesores", async (req, res) => {
  try {
    const subjectId = parseIdParam(req.params.id);
    if (!subjectId) throw Object.assign(new Error("Materia inválida"), { status: 400 });
    const professorIds = readIdArray(
      (req.body as { professorIds?: unknown }).professorIds,
      "Profesores"
    );
    const supabase = createAdminClient();
    for (const professorId of professorIds) {
      const roleName = await roleNameByUserId(supabase, professorId);
      if (roleName?.toLowerCase() !== "profesor") {
        throw Object.assign(new Error("Solo se pueden asignar usuarios profesor"), {
          status: 400,
        });
      }
    }
    await supabase.from("materia_profesor").delete().eq("id_materia", subjectId);
    if (professorIds.length > 0) {
      const { error } = await supabase.from("materia_profesor").insert(
        professorIds.map((professorId) => ({
          id_materia: subjectId,
          id_profesor: professorId,
        }))
      );
      if (error) throw Object.assign(new Error(error.message), { status: 400 });
    }
    const subject = (await listSubjects(supabase)).find((item) => item.id === String(subjectId));
    if (!subject) throw Object.assign(new Error("Materia no encontrada"), { status: 404 });
    res.json({ subject });
  } catch (e) {
    res.status(statusFromError(e)).json({ error: messageFromError(e) });
  }
});

router.get("/esp32/status", (_req, res) => {
  res.json(getEsp32Status());
});

router.post("/esp32/reset", (_req, res) => {
  resetPressCount();
  res.json(getEsp32Status());
});

export default router;
