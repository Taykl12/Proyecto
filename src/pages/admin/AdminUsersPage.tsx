import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Fingerprint, Search, Users } from "lucide-react";
import { AdminModal } from "../../components/admin/AdminModal";
import {
  FingerprintEnrollModal,
  type FingerprintModalMode,
} from "../../components/admin/FingerprintEnrollModal";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { useAuth } from "../../contexts/AuthContext";
import { ApiError, apiFetch, apiFetchWithRetry } from "../../lib/api";
import type { AdminRole, AdminUser, AdminUsersResponse, FingerprintStatus } from "../../types/admin";
import "../../styles/admin.css";

interface UserFormState {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  dni: string;
  phone: string;
  roleId: string;
}

const EMPTY_USER_FORM: UserFormState = {
  email: "",
  password: "",
  firstName: "",
  lastName: "",
  dni: "",
  phone: "",
  roleId: "",
};

function fullName(user: AdminUser): string {
  return [user.firstName, user.lastName].filter(Boolean).join(" ") || "Sin nombre";
}

function userToForm(user: AdminUser): UserFormState {
  return {
    email: user.email,
    password: "",
    firstName: user.firstName,
    lastName: user.lastName,
    dni: user.dni,
    phone: user.phone,
    roleId: user.roleId ? String(user.roleId) : "",
  };
}

function isAlumnoUser(user: { roleId: number | null; roleLabel: string }): boolean {
  if (user.roleId === 3) return true;
  return user.roleLabel.trim().toLowerCase() === "alumno";
}

function filterUsers(users: AdminUser[], query: string): AdminUser[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return users;
  return users.filter((user) =>
    [user.email, user.firstName, user.lastName, user.dni, user.phone, user.roleLabel]
      .join(" ")
      .toLowerCase()
      .includes(needle)
  );
}

interface UserFormProps {
  mode: "create" | "edit";
  form: UserFormState;
  roles: AdminRole[];
  submitting: boolean;
  onChange: (next: UserFormState) => void;
  onSubmit: (event: FormEvent) => void;
}

function UserForm({ mode, form, roles, submitting, onChange, onSubmit }: UserFormProps) {
  return (
    <form id="admin-user-form" className="admin-form" onSubmit={onSubmit}>
      <label className="project-modal__label">
        Email
        <input
          type="email"
          className="project-modal__input"
          value={form.email}
          onChange={(e) => onChange({ ...form, email: e.target.value })}
          required
        />
      </label>
      <label className="project-modal__label">
        Contraseña
        <input
          type="password"
          className="project-modal__input"
          value={form.password}
          onChange={(e) => onChange({ ...form, password: e.target.value })}
          required={mode === "create"}
          placeholder={mode === "edit" ? "Dejar en blanco para no cambiar" : undefined}
          minLength={mode === "create" || form.password ? 6 : undefined}
        />
      </label>
      <div className="admin-form__row">
        <label className="project-modal__label">
          Nombre
          <input
            type="text"
            className="project-modal__input"
            value={form.firstName}
            onChange={(e) => onChange({ ...form, firstName: e.target.value })}
            required
          />
        </label>
        <label className="project-modal__label">
          Apellido
          <input
            type="text"
            className="project-modal__input"
            value={form.lastName}
            onChange={(e) => onChange({ ...form, lastName: e.target.value })}
            required
          />
        </label>
      </div>
      <div className="admin-form__row">
        <label className="project-modal__label">
          DNI
          <input
            type="text"
            className="project-modal__input"
            value={form.dni}
            onChange={(e) => onChange({ ...form, dni: e.target.value })}
          />
        </label>
        <label className="project-modal__label">
          Celular
          <input
            type="tel"
            className="project-modal__input"
            value={form.phone}
            onChange={(e) => onChange({ ...form, phone: e.target.value })}
          />
        </label>
      </div>
      <label className="project-modal__label">
        Rol
        <select
          className="project-modal__input"
          value={form.roleId}
          onChange={(e) => onChange({ ...form, roleId: e.target.value })}
          required
        >
          <option value="">Seleccionar rol</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.label}
            </option>
          ))}
        </select>
      </label>
      <input type="submit" hidden disabled={submitting} />
    </form>
  );
}

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserFormState>(EMPTY_USER_FORM);
  const [fingerprintUser, setFingerprintUser] = useState<AdminUser | null>(null);
  const [fingerprintMode, setFingerprintMode] = useState<FingerprintModalMode>("enroll");
  const [validatedUserIds, setValidatedUserIds] = useState<Record<string, true>>({});
  const [removingFingerprint, setRemovingFingerprint] = useState<string | null>(null);

  const visibleUsers = useMemo(() => filterUsers(users, query), [users, query]);

  const loadUsers = useCallback(async () => {
    const data = await apiFetchWithRetry<AdminUsersResponse>("/api/admin/users");
    setUsers(data.users);
    setRoles(data.roles);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadUsers()
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error al cargar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadUsers]);

  function openCreate() {
    setEditingUser(null);
    setForm({
      ...EMPTY_USER_FORM,
      roleId: roles[0] ? String(roles[0].id) : "",
    });
    setModalError(null);
    setModalOpen(true);
  }

  function openEdit(item: AdminUser) {
    setEditingUser(item);
    setForm(userToForm(item));
    setModalError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingUser(null);
    setModalError(null);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setModalError(null);
    const payload = {
      email: form.email,
      password: form.password,
      firstName: form.firstName,
      lastName: form.lastName,
      dni: form.dni,
      phone: form.phone,
      roleId: Number(form.roleId),
    };
    try {
      if (editingUser) {
        await apiFetch<{ user: AdminUser }>(`/api/admin/users/${editingUser.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch<{ user: AdminUser }>("/api/admin/users", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      await loadUsers();
      closeModal();
    } catch (e) {
      setModalError(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(item: AdminUser) {
    if (!window.confirm(`¿Eliminar la cuenta de ${fullName(item)}?`)) return;
    setError(null);
    try {
      await apiFetch<{ deleted: string }>(`/api/admin/users/${item.id}`, {
        method: "DELETE",
      });
      await loadUsers();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo eliminar");
    }
  }

  function openFingerprint(item: AdminUser, mode: FingerprintModalMode = "enroll") {
    setFingerprintMode(mode);
    setFingerprintUser(item);
  }

  function closeFingerprint() {
    setFingerprintUser(null);
  }

  function handleFingerprintSuccess() {
    if (fingerprintMode === "verify" && fingerprintUser) {
      setValidatedUserIds((prev) => ({ ...prev, [fingerprintUser.id]: true }));
    }
    void loadUsers();
  }

  async function pollDeleteStatus(userId: string): Promise<FingerprintStatus> {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const status = await apiFetchWithRetry<FingerprintStatus>(
        `/api/admin/users/${userId}/huella/estado`
      );
      if (status.step === "success" || status.step === "error") {
        return status;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }
    return {
      active: false,
      step: "error",
      slotId: null,
      errorMessage: "Tiempo agotado al quitar la huella del sensor",
    };
  }

  async function handleRemoveFingerprint(item: AdminUser) {
    if (
      !window.confirm(
        `¿Quitar la huella asignada a ${fullName(item)}? El ESP32 debe estar conectado.`
      )
    ) {
      return;
    }

    setRemovingFingerprint(item.id);
    setError(null);
    try {
      await apiFetch(`/api/admin/users/${item.id}/huella`, { method: "DELETE" });
      const result = await pollDeleteStatus(item.id);
      if (result.step === "error") {
        throw new ApiError(
          result.errorMessage ?? "No se pudo quitar la huella del sensor",
          500
        );
      }
      setValidatedUserIds((prev) => {
        if (!prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      await loadUsers();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo quitar la huella");
      await loadUsers();
    } finally {
      setRemovingFingerprint(null);
    }
  }

  return (
    <DashboardLayout>
      <header className="admin-hero">
        <Users size={52} strokeWidth={2.25} className="admin-hero__icon" aria-hidden />
        <div>
          <p className="admin-hero__eyebrow">Administración</p>
          <h1 className="admin-hero__title">Usuarios</h1>
        </div>
      </header>

      <section className="dashboard-panel">
        {error ? (
          <p className="dashboard-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="admin-toolbar">
          <label className="admin-search">
            <Search size={18} aria-hidden />
            <span className="sr-only">Buscar usuarios</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, email, DNI o rol"
            />
          </label>
          <button
            type="button"
            className="projects-panel__action-btn projects-panel__action-btn--primary"
            onClick={openCreate}
            disabled={loading || roles.length === 0}
          >
            Agregar Usuario
          </button>
        </div>

        {loading ? (
          <div className="projects-table projects-table--empty" role="status">
            Cargando usuarios…
          </div>
        ) : visibleUsers.length === 0 ? (
          <div className="projects-table projects-table--empty" role="status">
            No hay usuarios para mostrar.
          </div>
        ) : (
          <div className="projects-table-wrapper">
            <table className="projects-table admin-table">
              <thead>
                <tr>
                  <th scope="col">Usuario</th>
                  <th scope="col">DNI</th>
                  <th scope="col">Celular</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Huella</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((item) => (
                  <tr key={item.id}>
                    <td className="projects-table__cell projects-table__cell--name" data-label="Usuario">
                      <span>{fullName(item)}</span>
                      <small className="admin-table__subtext">{item.email || "Sin email"}</small>
                    </td>
                    <td className="projects-table__cell projects-table__cell--muted" data-label="DNI">
                      {item.dni || "—"}
                    </td>
                    <td className="projects-table__cell projects-table__cell--muted" data-label="Celular">
                      {item.phone || "—"}
                    </td>
                    <td className="projects-table__cell" data-label="Rol">
                      <span className="projects-badge projects-badge--status-open">
                        {item.roleLabel}
                      </span>
                    </td>
                    <td className="projects-table__cell" data-label="Huella">
                      {item.huellaId !== null ? (
                        <span
                          className={`admin-table__fingerprint admin-table__fingerprint--assigned${
                            validatedUserIds[item.id]
                              ? " admin-table__fingerprint--validated"
                              : ""
                          }`}
                        >
                          <Fingerprint size={16} aria-hidden />
                          {validatedUserIds[item.id]
                            ? "Huella Validada"
                            : `Slot #${item.huellaId}`}
                        </span>
                      ) : (
                        <span className="admin-table__fingerprint admin-table__fingerprint--empty">
                          Sin asignar
                        </span>
                      )}
                    </td>
                    <td className="projects-table__cell projects-table__cell--actions" data-label="Acciones">
                      <button
                        type="button"
                        className="projects-table__action"
                        onClick={() => openFingerprint(item)}
                        disabled={removingFingerprint === item.id || !isAlumnoUser(item)}
                        title={
                          isAlumnoUser(item)
                            ? undefined
                            : "Solo usuarios con rol Alumno pueden tener huella"
                        }
                      >
                        {item.huellaId !== null ? "Reasignar Huella" : "Asignar Huella"}
                      </button>
                      {item.huellaId !== null ? (
                        <button
                          type="button"
                          className="projects-table__action"
                          onClick={() => openFingerprint(item, "verify")}
                          disabled={removingFingerprint === item.id}
                        >
                          Validar Huella
                        </button>
                      ) : null}
                      {item.huellaId !== null ? (
                        <button
                          type="button"
                          className="projects-table__action admin-table__danger"
                          onClick={() => void handleRemoveFingerprint(item)}
                          disabled={removingFingerprint === item.id}
                        >
                          {removingFingerprint === item.id ? "Quitando…" : "Quitar Huella"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="projects-table__action"
                        onClick={() => openEdit(item)}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="projects-table__action admin-table__danger"
                        onClick={() => handleDelete(item)}
                        disabled={currentUser?.id === item.id}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AdminModal
        open={modalOpen}
        title={editingUser ? "Editar usuario" : "Agregar usuario"}
        error={modalError}
        onClose={closeModal}
        footer={
          <>
            <button
              type="button"
              className="project-modal__btn project-modal__btn--muted"
              onClick={closeModal}
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="admin-user-form"
              className="project-modal__btn project-modal__btn--primary"
              disabled={submitting}
            >
              {submitting ? "Guardando…" : "Guardar"}
            </button>
          </>
        }
      >
        <UserForm
          mode={editingUser ? "edit" : "create"}
          form={form}
          roles={roles}
          submitting={submitting}
          onChange={setForm}
          onSubmit={handleSubmit}
        />
      </AdminModal>

      <FingerprintEnrollModal
        user={fingerprintUser}
        open={fingerprintUser !== null}
        mode={fingerprintMode}
        onClose={closeFingerprint}
        onSuccess={handleFingerprintSuccess}
      />
    </DashboardLayout>
  );
}
