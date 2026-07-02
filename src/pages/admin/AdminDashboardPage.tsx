import { useEffect, useState } from "react";
import { BookOpen, Cpu, GraduationCap, Layers, Shield, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "../../components/layout/DashboardLayout";
import { apiFetchWithRetry } from "../../lib/api";
import { ROUTES } from "../../routes";
import type { AdminSummary } from "../../types/admin";
import "../../styles/admin.css";

const QUICK_LINKS = [
  {
    label: "Gestionar usuarios",
    description: "Alta, edición de perfiles, roles y eliminación.",
    to: ROUTES.ADMIN_USERS,
    icon: <Users size={24} aria-hidden />,
  },
  {
    label: "Gestionar cursos",
    description: "Crear cursos y asignar alumnos o profesores.",
    to: ROUTES.ADMIN_COURSES,
    icon: <GraduationCap size={24} aria-hidden />,
  },
  {
    label: "Gestionar materias",
    description: "Organizar materias y asignar profesores.",
    to: ROUTES.ADMIN_SUBJECTS,
    icon: <BookOpen size={24} aria-hidden />,
  },
  {
    label: "Gestionar proyectos",
    description: "Ver, editar, asignar profesores y bloquear secciones.",
    to: ROUTES.ADMIN_PROJECTS,
    icon: <Layers size={24} aria-hidden />,
  },
  {
    label: "Monitor ESP32",
    description: "Estado de conexión y contador del botón BOOT del ESP32-C3.",
    to: ROUTES.ADMIN_ESP32,
    icon: <Cpu size={24} aria-hidden />,
  },
] as const;

export default function AdminDashboardPage() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetchWithRetry<AdminSummary>("/api/admin/summary")
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Error al cargar");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DashboardLayout>
      <header className="admin-hero">
        <Shield size={52} strokeWidth={2.25} className="admin-hero__icon" aria-hidden />
        <div>
          <p className="admin-hero__eyebrow">Administración</p>
          <h1 className="admin-hero__title">Panel Admin</h1>
        </div>
      </header>

      <section className="dashboard-panel">
        <div className="dashboard-panel__header">
          <h2 className="dashboard-panel__title">Resumen general</h2>
          <p className="dashboard-panel__subtitle">
            Métricas rápidas de usuarios y estructura académica.
          </p>
        </div>
        {error ? (
          <p className="dashboard-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="admin-stats" aria-busy={loading}>
          <article className="admin-stat-card">
            <span>Usuarios</span>
            <strong>{loading ? "…" : summary?.users ?? 0}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Cursos</span>
            <strong>{loading ? "…" : summary?.courses ?? 0}</strong>
          </article>
          <article className="admin-stat-card">
            <span>Materias</span>
            <strong>{loading ? "…" : summary?.subjects ?? 0}</strong>
          </article>
        </div>
      </section>

      <section className="admin-grid" aria-label="Accesos rápidos">
        {QUICK_LINKS.map((item) => (
          <Link key={item.to} to={item.to} className="admin-quick-card">
            <span className="admin-quick-card__icon">{item.icon}</span>
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </Link>
        ))}
      </section>
    </DashboardLayout>
  );
}
