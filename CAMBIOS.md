# Registro de cambios — Dashboard Classify

Documento que resume todo lo implementado en el repositorio respecto al dashboard React, según el plan *Dashboard simple (React + mockups)* y las correcciones posteriores de UI/UX.

**Fecha de referencia:** junio 2026

---

## Resumen

Se añadió una aplicación **React + TypeScript + Vite** con **CSS vanilla** (sin Tailwind) que reproduce el dashboard de los mockups: sidebar colapsable, carrusel de proyectos destacados con “peek” lateral y tabla de pendientes con acciones. **Login, registro y recuperar contraseña** están solo en React (`src/pages/`, `src/components/auth/`). Se eliminaron `Login.html`, `Register.html` y duplicados en `public/` (evitaban el bucle de redirección en `/login` en Windows).

### Gestión global de proyectos (junio 2026)

- **Admin:** nueva sección `/admin/proyectos` para listar, editar, eliminar proyectos y asignar profesores supervisores.
- **Bloqueos por sección:** alcance/objetivo, documentación y equipo; configurables por admin o profesor asignado; restringen solo a alumnos dueños/integrantes.
- **Migración 015:** columnas `bloqueo_*`, tabla `proyecto_profesor_asignado`, RLS `can_manage_proyecto`.
- **API:** `/api/admin/proyectos` + permisos ampliados en `PUT /api/projects/:id`.

### Monitor ESP32-C3 (junio 2026)

- **Admin:** pestaña `/admin/esp32` con indicador verde/rojo de conexión y contador de pulsaciones del botón BOOT.
- **API dispositivo:** `POST /api/device/esp32/heartbeat` y `POST /api/device/esp32/button` (header `X-Device-Token`).
- **API admin:** `GET /api/admin/esp32/status`, `POST /api/admin/esp32/reset`.
- **Estado en memoria** (se pierde al reiniciar el servidor).
- **Env:** `ESP32_DEVICE_TOKEN` en `server/.env` (default dev: `dev-esp32-token`).
- **Firmware de referencia:** `firmware/esp32-c3-supermini/esp32-c3-supermini.ino`.

---

## Stack y dependencias nuevas

| Tecnología | Uso |
|------------|-----|
| React 19 | UI del dashboard |
| TypeScript | Tipado estricto |
| Vite 6 | Dev server y build |
| lucide-react | Iconos (sidebar, carrusel) |
| react-router-dom | Rutas dashboard y auth (`/login`, `/register`, etc.) |

### Scripts (`package.json`)

- `npm run dev` — servidor de desarrollo
- `npm run build` — compilación de producción (`dist/`)
- `npm run preview` — vista previa del build

### Archivos de configuración creados

- `package.json`, `package-lock.json`
- `vite.config.ts`
- `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- `index.html` (entrada Vite del dashboard)
- `.gitignore` (incluye `node_modules`, `dist`)

---

## Estructura de `src/`

```
src/
├── main.tsx
├── App.tsx
├── vite-env.d.ts
├── types/
│   └── dashboard.ts          # Interfaces + datos mock
├── hooks/
│   ├── useSidebarCollapsed.ts
│   └── useCarouselMetrics.ts
├── pages/
│   └── DashboardPage.tsx
├── components/
│   ├── layout/
│   │   ├── DashboardLayout.tsx
│   │   ├── Sidebar.tsx
│   │   └── SidebarToggle.tsx
│   └── dashboard/
│       ├── FeaturedProjectsCarousel.tsx
│       ├── ProjectCard.tsx
│       └── PendingProjectsSection.tsx
└── styles/
    ├── variables.css
    ├── global.css
    ├── dashboard.css
    ├── sidebar.css
    ├── carousel.css
    └── pending.css
```

---

## Funcionalidades implementadas

### 1. Layout general (`DashboardLayout`)

- Fondo con gradiente alineado al login (`#4162da` → `#89e6eb` → canvas claro).
- Área principal con dos paneles: **Proyectos Destacados** y **Pendientes**.

### 2. Sidebar colapsable

| Estado | Comportamiento |
|--------|----------------|
| Colapsado (~72px) | Solo iconos: perfil, Inicio, Proyectos, Calendario, Preferencias, Cerrar sesión |
| Expandido (~240px) | Bloques blancos con avatar, “Nombre y Apellido - Cargo” y etiquetas de texto |

- **Toggle** circular arriba a la derecha del sidebar (menú / cerrar panel).
- Estado persistido en `localStorage` (`classify-sidebar-collapsed`).
- Accesibilidad: `aria-expanded`, `aria-label`, foco visible, etiquetas `.sr-only` cuando está colapsado.

### 3. Carrusel de proyectos destacados

- Tarjetas blancas con nombre del proyecto.
- Flechas anterior/siguiente; deshabilitadas en los extremos.
- **Peek:** se ve un recorte de la tarjeta vecina al desplazar.
- Ancho del carrusel **dinámico** (`useCarouselMetrics` + `ResizeObserver`): usa todo el espacio del panel y calcula cuántas tarjetas caben (hasta 4).
- Navegación por teclado: flechas ← → con foco en la región del carrusel.
- **10 proyectos** mock para probar el desplazamiento.

### 4. Sección Pendientes (tabla)

Columnas con encabezados:

| Descripción | Proyecto | Prioridad | Estado | Acciones |
|-------------|----------|-----------|--------|----------|
| Texto de ejemplo | Nombre del Proyecto | Alta/Media/Baja | Pendiente/En curso | **Editar** · **Ver** |

- Maquetado con `<table>` semántica.
- Acciones alineadas a la derecha en desktop.
- En móvil (`≤768px`): filas apiladas con `data-label` por celda.

### 5. Rutas

- `http://localhost:5173/` (o el puerto que asigne Vite)
- `http://localhost:5173/dashboard` — misma vista

---

## Tokens de diseño (`variables.css`)

Basados en la sección *Educational Platform Extension* de `DESIGN.md` y el gradiente de `Login.css`:

- Colores: `--color-primary`, `--color-canvas`, `--color-surface`, `--color-border`, `--color-ink`, `--color-panel`, etc.
- Espaciado, radios, anchos de sidebar y carrusel (`--card-width`, `--carousel-peek`, …).

Regla de estilo: **sin colores ni medidas hardcodeadas en JSX**; todo vía clases CSS y variables.

---

## Correcciones de UI (iteración posterior)

Tras la primera versión visual se ajustó lo siguiente:

| Problema | Solución |
|----------|----------|
| Carrusel cortado, no usaba todo el ancho | Viewport al 100%; tarjetas redimensionadas con `useCarouselMetrics` |
| Pocos ítems para probar scroll | 10 proyectos en `FEATURED_PROJECTS` |
| Sidebar colapsado desalineado (toggle/íconos) | `align-items: center`, header centrado, bloques con `max-width` uniforme |
| Recuadro inferior con espacio vacío bajo Cerrar sesión | Eliminado `sidebar__spacer`; quitado `flex: 1` del menú; footer con `margin-top: auto` solo |
| Hueco bajo el sidebar al hacer scroll | `position: sticky`, `min-height: 100vh`, `height: 100vh` |
| Tabla sin nombres de columna | Encabezados `<thead>` con estilo tabla |

---

## Pasos del plan completados

1. Scaffold Vite + React + TS + `lucide-react` (sin Tailwind).
2. `variables.css`, `global.css`, `dashboard.css` + layout base.
3. `sidebar.css` + `Sidebar` + toggle.
4. `carousel.css` + carrusel y datos mock.
5. `pending.css` + sección híbrida (datos + Editar/Ver).
6. `DashboardPage` + media queries responsive.

### Ajustes respecto al plan original

- **CSS:** vanilla en lugar de Tailwind (pedido explícito).
- **Mocks:** en `src/types/dashboard.ts` (el plan los citaba ahí); se eliminó `src/data/mockDashboard.ts`.
- **Router:** añadido `react-router-dom` para `/` y `/dashboard`.

---

## Auth en React (`/login`, `/register`, `/recuperar-contrasena`)

### Motivo
- `persona.png` no existía en el repo → logos rotos en HTML.
- Enlace “Olvidé mi contraseña” apuntaba a `Registro.html` (inexistente).

### Implementación
- Componentes: [`AuthLayout`](src/components/auth/AuthLayout.tsx), [`AuthNav`](src/components/auth/AuthNav.tsx), [`AuthAvatar`](src/components/auth/AuthAvatar.tsx) (iconos `User` / `Mail` de lucide-react), [`AuthFooter`](src/components/auth/AuthFooter.tsx).
- Páginas: [`LoginPage`](src/pages/LoginPage.tsx), [`RegisterPage`](src/pages/RegisterPage.tsx), [`RecoverPasswordPage`](src/pages/RecoverPasswordPage.tsx).
- Estilos portados y acotados bajo `.auth-page`: [`auth.css`](src/styles/auth.css), [`login.css`](src/styles/login.css), [`register.css`](src/styles/register.css), [`recover-password.css`](src/styles/recover-password.css).
- Rutas en [`routes.ts`](src/routes.ts): `LOGIN`, `REGISTER`, `RECOVER_PASSWORD`.

### Diseño conservado
- Gradientes originales (login/recuperar: `#4162da` → `#89e6eb`; register: `#6a8aff` → `#b2fbff`).
- Caja blanca 50px radius, nav gris, footer `#333`, inputs y botones como en `Login.css` / `Register.css`.
- Sin API ni envío real de correo; botones placeholder.

### Navegación
- Login ↔ Register; “Olvidé mi contraseña” → `/recuperar-contrasena`; recuperar → “Volver a iniciar sesión”.
- Diseño original portado a `src/styles/auth.css`, `login.css`, `register.css` (ya no se usan HTML/CSS sueltos en la raíz).

---

## Archivos del repo sin cambios

- `DESIGN.md`
- `.cursor/rules/frontend.mdc` (sigue recomendando Tailwind; el dashboard usa CSS vanilla por decisión del proyecto)

---

## Archivos actualizados (existentes)

| Archivo | Cambio |
|---------|--------|
| `README.md` | Instrucciones para `npm install` y `npm run dev` |

---

## Cómo ejecutar

```bash
npm install
npm run dev
```

Abrir la URL que muestra la terminal (por defecto `http://localhost:5173`; si está ocupado, Vite usa otro puerto, p. ej. `5174`).

Build de producción:

```bash
npm run build
npm run preview
```

---

## Pestaña Proyectos (`/proyectos`)

### Rutas y navegación
- [`src/routes.ts`](src/routes.ts): `HOME`, `DASHBOARD`, `PROJECTS` (`/proyectos`).
- [`ProjectsPage`](src/pages/ProjectsPage.tsx) registrada en [`App.tsx`](src/App.tsx).
- Sidebar: **Inicio** y **Proyectos** con `NavLink`; activo en `/` y `/dashboard` para Inicio; Calendario / Preferencias / Cerrar sesión siguen como botones placeholder.

### Página
- Título **Proyectos** centrado.
- Botones placeholder **Borrar Proyecto** y **Crear Proyecto** (pill, sin lógica).
- Panel **Mis Proyectos** con tabla de listado (mismo estilo educativo que Pendientes, no tema oscuro del mockup de referencia).

### Tabla de proyectos
| Columna | Detalle |
|---------|---------|
| Escuela | Badge rectangular amarillo (`--color-warning-*`) |
| Nombre | Texto en negrita |
| Descripción | Texto muted; truncado en desktop con `title` |
| Estado | Badge pill: Abierto (verde) / Cerrado (neutro) |
| Creado | Fecha `DD/MM/YYYY` vía `formatProjectDate` |
| Acciones | Editar / Ver, `min-height: 44px`, `aria-label` por fila |

### Datos mock
- [`src/types/projects.ts`](src/types/projects.ts): `ProjectListItem`, 10 filas en `PROJECT_LIST_ITEMS`.

### Estilos
- [`projects.css`](src/styles/projects.css), [`projects-page.css`](src/styles/projects-page.css).

---

## Pendiente / fuera de alcance

- Conectar el botón “Iniciar sesión” de [`LoginPage`](src/pages/LoginPage.tsx) al dashboard.
- Envío real de email en recuperar contraseña.
- Backend, autenticación real y API.
- Ordenación/filtrado avanzado en tablas.
- CRUD real en Crear/Borrar/Editar/Ver de Proyectos.
- Rutas adicionales (Calendario, Preferencias, etc.) más allá del placeholder en botones del sidebar.

---

## Fase 2 — Mejoras UI/UX (accesibilidad + rango etario alto)

Implementado según [`PLAN-MEJORAS-UI-UX.md`](PLAN-MEJORAS-UI-UX.md).

### Sidebar
- **Expandido:** toggle de ancho completo con icono + texto **“Ocultar menú”**, centrado.
- **Colapsado:** solo icono hamburguesa; `aria-label="Abrir menú"`.
- Grilla centrada de 48px para toggle, avatar, nav y footer en modo colapsado.
- Menos espacio entre bloques; ancho expandido **260px**.
- Ítem **Inicio** con estado activo (`sidebar__nav-item--active`).

### Tipografía y paneles
- Fuente system-ui (Segoe UI, Roboto, Arial); cuerpo 16px, `line-height: 1.5`.
- Títulos de panel 24px; subtítulo en Pendientes: *“Tareas que requieren tu atención”*.
- Paneles con fondo blanco más opaco y sombra `--shadow-panel`.
- Gradiente de fondo más suave (menos saturación).

### Tabla Pendientes
- Encabezados sin mayúsculas forzadas; color `--color-primary`; 15px.
- **Prioridad** y **Estado** como badges con texto + color (Alta/Media/Baja, Pendiente/En curso).
- **Editar / Ver** como botones con borde y `min-height: 44px`.
- Filas con borde `1px` además de sombra.

### Carrusel
- Tarjetas **125px** de alto con línea secundaria (*“N tareas pendientes”*).
- Borde en tarjetas; hover sutil (respetando `prefers-reduced-motion`).

### Tokens nuevos
- `--color-success-*`, `--color-warning-*`, `--color-error-*`, `--color-neutral-*`
- `--shadow-panel`, `--touch-min`, `--font-size-*`, `--card-height`

### Tipos
- `Project.pendingTasks` y uniones literales en `PendingItem.priority` / `status`.

---

## Nota sobre pruebas en navegador

Validar en `npm run dev`: toggle “Ocultar menú”, alineación colapsada, badges, botones 44px, carrusel y scroll con sidebar sticky a altura completa.

---

## Backend Express + Supabase (junio 2026)

### Supabase (Classify)

- Proyecto: `jgrtmokyqdvdxsldmkou`
- Migración `001`: columnas `escuela`, `estado_proyecto` en `grupos_proyectos`; seed `roles`
- Políticas RLS para profesor autenticado

### Servidor `server/`

- Express en puerto 3001
- Rutas: `/api/health`, `/api/auth/*`, `/api/projects`, `/api/dashboard/featured`, `/api/dashboard/pending`
- Cliente Supabase con JWT del usuario

### Frontend

- `AuthContext`, `ProtectedRoute`, `/` → `/login`
- Login con email; datos desde API (sin mocks)
- Proxy Vite `/api` → Express
- Logout en sidebar

### Configuración

- `server/.env.example`, `.env.example` (raíz)
- `docs/supabase-schema.md`
