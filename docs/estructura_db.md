# Sistema "CLASSIFY" — Diseño y estructura de base de datos

Este documento detalla el diseño de la base de datos relacional para el proyecto **CLASSIFY**.

> **Mantenimiento:** cada cambio en la base de datos (migraciones Supabase, columnas nuevas, RLS, funciones RPC, etc.) debe reflejarse aquí. Los archivos fuente están en `supabase/migrations/`.

---

## 1. Información del proyecto

| Campo | Valor |
|-------|--------|
| **Nombre del proyecto** | Classify |
| **Institución** | Escuela de Educación Técnica N° 24 "Simón de Iriondo" (Resistencia, Chaco) |
| **Curso** | 4° 1ª C.S.T.E.P. (Técnico en Programación) |
| **Año** | 2026 |

**Alumnos**

1. Asano Takashi 
2. Limanovsky Renzo 
3. Raymundo Renzo Maximiliano 


---

## 2. Estrategia de integración de hardware (sensor de huella dactilar)

El sistema de asistencia escolar utiliza un módulo biométrico controlado por un microcontrolador **Arduino ESP32**. Los sensores contemplados son:

- **Sensor AS-608**: capacidad de 120–160 huellas, ideal para aulas de menos de 100 alumnos.
- **Sensor R305**: capacidad de hasta 1000 huellas, ideal para alta concurrencia.

### Mapeo biométrico en base de datos

1. **Almacenamiento interno del sensor**: los sensores biométricos almacenan los patrones de huella en ranuras de memoria numeradas (p. ej., slots del 0 al 119).
2. **Vinculación**: en la base de datos, la tabla `Usuarios` incluye el campo `huella_id` (entero y único).
3. **Flujo de marcación**:
   - El alumno coloca su dedo en el sensor físico conectado a la ESP32.
   - El sensor realiza la lectura y devuelve el ID del slot correspondiente (ej.: `42`).
   - La ESP32 envía un mensaje HTTP POST al servidor con `huella_id = 42` y el identificador del aula o dispositivo (`id_dispositivo`).
   - El backend busca qué usuario tiene registrado `huella_id = 42`.
   - Se crea automáticamente el registro en la tabla `Asistencias` con la fecha y hora correspondientes.

---

## 3. Roles de acceso y seguridad

El sistema aplica control de acceso basado en roles para proteger datos personales y académicos:

| Rol | Permisos principales |
|-----|----------------------|
| **Alumno** | Propias asistencias, reclamos, tareas de grupo (Kanban), avances y documentación final. |
| **Profesor / Tutor** | Seguimiento de tareas, anotaciones de estudiantes, tutoría del proyecto integrador, observaciones y calificación. |
| **Preceptor** | Asistencias de cursos asignados, tardanzas, resolución de reclamos. |
| **Administrador** | Acceso total, catálogos (usuarios, roles, cursos, asignaturas), configuración general. |

---

## 4. Diccionario de datos detallado (18 tablas)

### Tabla 1: `Roles`

**Propósito:** define los distintos niveles de permisos y accesos en el sistema.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_rol` | INT, PK, auto-incremental | Identificador único del rol. |
| `nombre_rol` | VARCHAR(50), NOT NULL, UNIQUE | Nombre del rol (ej.: Administrador, Preceptor, Profesor, Alumno). |

### Tabla 2: `Usuarios`

**Propósito:** registra a todas las personas del sistema con sus datos de perfil.

**En Supabase (Classify):** `id_usuario` es **UUID** y coincide con `auth.users.id`. El **email** y la **contraseña** viven en Supabase Auth, no en esta tabla.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_usuario` | UUID, PK (= `auth.users.id`) | Identificador único del usuario. |
| `dni` | VARCHAR(15), NOT NULL, UNIQUE | Documento Nacional de Identidad. |
| `nombre` | VARCHAR(100), NOT NULL | Nombre(s) del usuario. |
| `apellido` | VARCHAR(100), NOT NULL | Apellido(s) del usuario. |
| `email` | VARCHAR(150), NOT NULL, UNIQUE | Correo electrónico institucional o personal. |
| `password_hash` | VARCHAR(255), NOT NULL | Contraseña encriptada (p. ej., bcrypt). |
| `telefono` | VARCHAR(20), NULL | Número de contacto celular. |
| `foto_perfil` | VARCHAR(255), NULL | URL o ruta de la imagen de perfil. |
| `huella_id` | INT, NULL, UNIQUE | Slot en el sensor (0–1000). Solo alumnos; otros roles deben tener NULL. Restricción CHECK. |
| `id_rol` | INT, FK → `Roles.id_rol`, NOT NULL | Rol global (1: Admin, 2: Preceptor, 3: Profesor, 4: Alumno). |
| `fecha_registro` | TIMESTAMP, DEFAULT CURRENT_TIMESTAMP | Fecha de alta en el sistema. |

### Tabla 3: `Cursos`

**Propósito:** registra las divisiones del establecimiento educativo.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_curso` | INT, PK, auto-incremental | Identificador del curso. |
| `nombre_curso` | VARCHAR(50), NOT NULL | Nombre legible (ej.: "4° 1ª C.S.T.E.P"). |
| `año_lectivo` | INT, NOT NULL | Año académico (ej.: 2026). |
| `especialidad` | VARCHAR(100), NULL | Especialidad técnica (ej.: Técnico en Programación). |

### Tabla 4: `Cursos_Usuarios_Asignados` (relación N:N)

**Propósito:** asigna alumnos, profesores o preceptores a un curso.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_curso_usuario` | INT, PK, auto-incremental | Identificador de la asignación. |
| `id_curso` | INT, FK → `Cursos.id_curso`, ON DELETE CASCADE | ID del curso. |
| `id_usuario` | INT, FK → `Usuarios.id_usuario`, ON DELETE CASCADE | ID del usuario. |

### Tabla 5: `Materias`

**Propósito:** registra las asignaturas dictadas en cada curso.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_materia` | INT, PK, auto-incremental | Identificador único de la materia. |
| `nombre_materia` | VARCHAR(100), NOT NULL | Nombre (ej.: Programación, Hardware). |
| `id_curso` | INT, FK → `Cursos.id_curso`, ON DELETE CASCADE | Curso al que pertenece. |

### Tabla 6: `Materia_Profesor` (relación N:N)

**Propósito:** asigna profesores a cada materia; un profesor puede dictar varias materias y una materia puede tener varios profesores.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_materia_profesor` | INT, PK, auto-incremental | Identificador de asignación. |
| `id_materia` | INT, FK → `Materias.id_materia`, ON DELETE CASCADE | ID de la materia. |
| `id_profesor` | INT, FK → `Usuarios.id_usuario`, ON DELETE CASCADE | ID del profesor (rol Profesor). |

### Tabla 7: `Asistencias`

**Propósito:** registra ingreso, salida y estado de asistencia diaria de los alumnos.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_asistencia` | INT, PK, auto-incremental | Identificador único. |
| `id_usuario` | INT, FK → `Usuarios.id_usuario`, ON DELETE CASCADE | Estudiante. |
| `id_curso` | INT, FK → `Cursos.id_curso`, ON DELETE CASCADE | Curso. |
| `fecha` | DATE, NOT NULL | Fecha de la jornada. |
| `hora_entrada` | TIME, NULL | Primer marcaje (entrada). |
| `hora_salida` | TIME, NULL | Segundo marcaje (salida). |
| `estado` | ENUM(Presente, Ausente, Tardanza, Justificado), NOT NULL | Estado actual. |
| `metodo_registro` | ENUM(Huella, Manual), DEFAULT Huella | Método de marcaje. |
| `id_registrado_por` | INT, FK → `Usuarios.id_usuario`, NULL | Preceptor/profesor si fue manual o modificado. |
| `observaciones` | TEXT, NULL | Detalle de inasistencia o justificación. |

### Tabla 8: `Reclamos_Asistencia`

**Propósito:** reclamos formales por errores de asistencia.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_reclamo` | INT, PK, auto-incremental | Identificador de reclamo. |
| `id_asistencia` | INT, FK → `Asistencias.id_asistencia`, ON DELETE CASCADE | Registro afectado. |
| `id_alumno` | INT, FK → `Usuarios.id_usuario`, ON DELETE CASCADE | Alumno reclamante. |
| `motivo_reclamo` | TEXT, NOT NULL | Descripción del problema. |
| `estado_reclamo` | ENUM(Pendiente, Aprobado, Rechazado), DEFAULT Pendiente | Estado del trámite. |
| `fecha_creacion` | TIMESTAMP, DEFAULT CURRENT_TIMESTAMP | Inicio del reclamo. |
| `id_resuelto_por` | INT, FK → `Usuarios.id_usuario`, NULL | Preceptor que atendió. |
| `respuesta_resolucion` | TEXT, NULL | Resolución del preceptor. |
| `fecha_resolucion` | TIMESTAMP, NULL | Cierre del reclamo. |

### Tabla 9: `Grupos_Proyectos`

**Propósito:** agrupa estudiantes para proyectos destacados o integradores.

**Estado en Supabase (Classify):** ver secciones **5** (relaciones) y **6** (implementación) para columnas, RLS y funciones añadidas en la app web.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_grupo` | INT, PK, auto-incremental | Identificador del grupo. |
| `nombre_proyecto` | VARCHAR(150), NOT NULL | Nombre (ej.: Classify). Título en configuración del proyecto. |
| `descripcion` | TEXT, NULL | Objetivo general del proyecto (pestaña Alcance). |
| `nota_promedio` | DECIMAL(4,2), NULL | Promedio consolidado del grupo. |
| `fecha_creacion` | DATE / TIMESTAMP, DEFAULT CURRENT_DATE | Fecha de inicio. |
| `estado_proyecto` | VARCHAR(20), DEFAULT `'Abierto'`, CHECK (`Abierto` \| `Cerrado`) | Estado en panel «Hitos y Estado». Al crear siempre `Abierto`. |
| `es_favorito` | BOOLEAN, NOT NULL, DEFAULT `false` | Si aparece en el carrusel del inicio (favorito del dueño). |
| `alcance_detalle` | TEXT, NULL | Alcance del proyecto (pestaña Alcance). |
| `notas_alcance` | TEXT, NULL | Notas del panel izquierdo; se muestran truncadas en la tabla de `/proyectos`. |
| `anteproyecto_validado` | BOOLEAN, NOT NULL, DEFAULT `false` | Aprobación del anteproyecto (pestaña Calificaciones). Solo rol **Profesor** puede modificarla. |
| `link_respaldo` | TEXT, NULL | URL de documentación de respaldo (pestaña Alcance). |
| `link_calificaciones` | TEXT, NULL | *(Reservado en BD; ya no se usa en la UI de Calificaciones.)* |
| `documentos` | JSONB, NOT NULL, DEFAULT `'[]'` | Lista de documentos: `[{ "nombre": string, "url": string }, ...]` (pestaña Documentaciones). |

**Columna eliminada:** `escuela` (varchar) — se añadió en migración 001 y se eliminó en migración 004; no se usa en la UI.

### Tabla 10: `Proyecto_Materia` (relación N:N)

**Propósito:** asocia varias materias a un proyecto y una materia a varios proyectos.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_proyecto_materia` | INT, PK, auto-incremental | Identificador de vinculación. |
| `id_grupo` | INT, FK → `Grupos_Proyectos.id_grupo`, ON DELETE CASCADE | Proyecto. |
| `id_materia` | INT, FK → `Materias.id_materia`, ON DELETE CASCADE | Materia asociada. |

### Tabla 11: `Proyecto_Profesor` (relación N:N)

**Propósito:** asocia varios profesores/tutores a un proyecto y un profesor a varios proyectos. En la app web, el **creador** del proyecto queda vinculado aquí y es el **dueño** (puede editar, borrar y marcar favorito).

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_proyecto_profesor` | INT, PK, auto-incremental | Identificador de vinculación. |
| `id_grupo` | INT, FK → `Grupos_Proyectos.id_grupo`, ON DELETE CASCADE | Proyecto. |
| `id_profesor` | UUID, FK → `Usuarios.id_usuario` (= `auth.users.id`), ON DELETE CASCADE | Usuario creador / tutor. |

### Tabla 12: `Grupo_Estudiante` (relación N:N)

**Propósito:** vincula estudiantes (integrantes) a un grupo de proyecto. Los emails se resuelven contra `auth.users`; el dueño puede sincronizar la lista desde la UI.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_grupo_estudiante` | INT, PK, auto-incremental | ID de membresía. |
| `id_grupo` | INT, FK → `Grupos_Proyectos.id_grupo`, ON DELETE CASCADE | Grupo. |
| `id_usuario` | UUID, FK → `Usuarios.id_usuario` (= `auth.users.id`), ON DELETE CASCADE | Integrante del proyecto. |

### Tabla 13: `Avances_Proyecto`

**Propósito:** entregas parciales programadas de cada proyecto.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_avance` | INT, PK, auto-incremental | Identificador del avance. |
| `id_grupo` | INT, FK → `Grupos_Proyectos.id_grupo`, ON DELETE CASCADE | Grupo responsable. |
| `titulo` | VARCHAR(100), NOT NULL | Nombre del avance. |
| `descripcion` | TEXT, NULL | Detalle del avance. |
| `archivo_url` | VARCHAR(255), NOT NULL | Enlace al archivo (.zip, .pdf). |
| `fecha_limite` | TIMESTAMP, NOT NULL | Plazo máximo de entrega. |
| `fecha_entrega` | TIMESTAMP, DEFAULT CURRENT_TIMESTAMP | Fecha de subida. |

### Tabla 14: `Correcciones_Proyecto`

**Propósito:** retroalimentación y notas de los tutores.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_correccion` | INT, PK, auto-incremental | Identificador. |
| `id_avance` | INT, FK → `Avances_Proyecto.id_avance`, ON DELETE CASCADE | Avance evaluado. |
| `id_tutor` | INT, FK → `Usuarios.id_usuario`, ON DELETE SET NULL | Profesor que califica. |
| `comentario_tutor` | TEXT, NOT NULL | Observaciones constructivas. |
| `nota_avance` | DECIMAL(4,2), NULL | Calificación. |
| `fecha_correccion` | TIMESTAMP, DEFAULT CURRENT_TIMESTAMP | Fecha de corrección. |

### Tabla 15: `Anotaciones_Proyectos`

**Propósito:** bitácora o recordatorios del grupo (estudiantes y profesor).

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_anotacion_proy` | INT, PK, auto-incremental | ID de la nota. |
| `id_grupo` | INT, FK → `Grupos_Proyectos.id_grupo`, ON DELETE CASCADE | Proyecto. |
| `id_usuario` | INT, FK → `Usuarios.id_usuario`, ON DELETE CASCADE | Autor. |
| `contenido_nota` | TEXT, NOT NULL | Cuerpo de la anotación. |
| `fecha_creacion` | TIMESTAMP, DEFAULT CURRENT_TIMESTAMP | Fecha de registro. |

### Tabla 16: `Documentacion_Aprobacion`

**Propósito:** repositorio final (carpeta técnica, planos, etc.).

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_documentacion` | INT, PK, auto-incremental | Identificador. |
| `id_grupo` | INT, FK → `Grupos_Proyectos.id_grupo`, ON DELETE CASCADE | Grupo. |
| `archivo_url` | VARCHAR(255), NOT NULL | Enlace al documento (.pdf). |
| `estado_aprobacion` | ENUM(Borrador, Entregado, Aprobado, Rechazado), DEFAULT Borrador | Estado. |
| `fecha_subida` | TIMESTAMP, DEFAULT CURRENT_TIMESTAMP | Fecha de guardado. |
| `observaciones_tutor` | TEXT, NULL | Comentarios del tutor. |

### Tabla 17: `Tareas_Grupo` (tablero Kanban)

**Propósito:** tareas autogestionadas del grupo (estilo Trello/Kanban), prioridad y fecha límite en el dashboard.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_tarea` | INT, PK, auto-incremental | Identificador. |
| `id_grupo` | INT, FK → `Grupos_Proyectos.id_grupo`, ON DELETE CASCADE | Proyecto. |
| `titulo_tarea` | VARCHAR(150), NOT NULL | Nombre de la tarea. |
| `descripcion_tarea` | TEXT, NULL | Detalle paso a paso. |
| `estado_tarea` | ENUM(Pendiente, En Progreso, Completado), DEFAULT Pendiente | Estado. |
| `prioridad_tarea` | ENUM(Baja, Media, Alta), DEFAULT Media | Urgencia. |
| `fecha_limite` | TIMESTAMP, NULL | Fecha máxima. |
| `id_asignado_a` | INT, FK → `Usuarios.id_usuario`, ON DELETE SET NULL | Responsable. |
| `id_creado_por` | INT, FK → `Usuarios.id_usuario`, ON DELETE CASCADE | Creador (integrante). |
| `fecha_creacion` | TIMESTAMP, DEFAULT CURRENT_TIMESTAMP | Fecha de registro. |

### Tabla 18: `Anotaciones_Progreso`

**Propósito:** recordatorios, avisos internos y notas de conducta/progreso.

| Campo | Tipo / restricciones | Descripción |
|-------|----------------------|-------------|
| `id_anotacion_progreso` | INT, PK, auto-incremental | Identificador. |
| `id_alumno` | INT, FK → `Usuarios.id_usuario`, ON DELETE CASCADE | Estudiante. |
| `id_profesor` | INT, FK → `Usuarios.id_usuario`, ON DELETE CASCADE | Profesor autor. |
| `contenido` | TEXT, NOT NULL | Mensaje o anotación. |
| `es_recordatorio` | BOOLEAN, DEFAULT FALSE | Si actúa como alarma en pendientes. |
| `fecha_creacion` | TIMESTAMP, DEFAULT CURRENT_TIMESTAMP | Fecha de la nota. |

---

## 5. Relaciones entre tablas

Esta sección describe **cómo se conectan** las entidades del modelo (notación MER). Los **diagramas MER** se insertan por separado en este documento. En Supabase los nombres físicos suelen ir en **minúsculas** (`grupos_proyectos`, `proyecto_profesor`, etc.), equivalentes a las entidades del diccionario.

### 5.1 Notación MER utilizada

| Símbolo | Elemento MER | Representación en este documento |
|---------|--------------|----------------------------------|
| Rectángulo | **Entidad** | Tabla del modelo (`USUARIO`, `GRUPO_PROYECTO`, …). |
| Rombo `◇` | **Relación** | Vínculo semántico entre entidades (`TIENE`, `INTEGRA`, `REGISTRA`, …). |
| Línea + cardinalidad | **Participación** | `1` = uno; `N` = muchos; `(min, max)` cuando aplica. |
| Tabla puente | **Entidad asociativa** | Resuelve relaciones **N : N** (`grupo_estudiante`, `proyecto_profesor`, …). |

**Tipos de cardinalidad frecuentes en Classify:**

| Cardinalidad | Significado | Ejemplo |
|--------------|-------------|---------|
| **1 : N** | Un «padre», muchos «hijos» | Un `GRUPO_PROYECTO` tiene N `TAREA_GRUPO`. |
| **N : N** | Muchos a muchos vía entidad asociativa | `USUARIO` integra N proyectos; un proyecto tiene N integrantes. |
| **1 : 1** | Correspondencia única | `auth.users` ↔ `USUARIO` (mismo `id_usuario`). |

### 5.2 Módulos del modelo

El esquema completo se agrupa en cuatro subsistemas:

| Módulo | Entidades principales |
|--------|------------------------|
| **Identidad** | `roles`, `usuarios`, `auth.users` (Supabase) |
| **Institución** | `cursos`, `materias`, `cursos_usuarios_asignados`, `materia_profesor` |
| **Proyectos** | `grupos_proyectos`, `proyecto_profesor`, `grupo_estudiante`, `tareas_grupo`, avances, anotaciones, documentación |
| **Asistencia** | `asistencias`, `reclamos_asistencia` |

`auth.users` (Supabase Auth) se modela como entidad externa **1:1** con `usuarios`.

> **Diagramas MER:** *(pendiente — insertar aquí los diagramas propios)*

### 5.3 Tabla de relaciones por entidad

#### Identidad y permisos

| Tabla A | Relación | Tabla B | Tabla puente / FK | Notas |
|---------|----------|---------|-------------------|-------|
| `roles` | 1 → N | `usuarios` | `usuarios.id_rol` | Cada usuario tiene un rol global (alumno, profesor, admin…). |
| `auth.users` | 1 → 1 | `usuarios` | `usuarios.id_usuario` = `auth.users.id` | Solo en Supabase; credenciales en Auth, perfil en `usuarios`. |

#### Institución (cursos y materias)

| Tabla A | Relación | Tabla B | Tabla puente / FK | Notas |
|---------|----------|---------|-------------------|-------|
| `cursos` | N ↔ N | `usuarios` | `cursos_usuarios_asignados` | Alumnos, profesores o preceptores por curso. |
| `cursos` | 1 → N | `materias` | `materias.id_curso` | Cada materia pertenece a un curso. |
| `materias` | N ↔ N | `usuarios` (profesor) | `materia_profesor` | Quién dicta cada materia. |

#### Asistencia

| Tabla A | Relación | Tabla B | Tabla puente / FK | Notas |
|---------|----------|---------|-------------------|-------|
| `usuarios` | 1 → N | `asistencias` | `asistencias.id_usuario` | Registro del alumno. |
| `cursos` | 1 → N | `asistencias` | `asistencias.id_curso` | Contexto del curso. |
| `usuarios` | 1 → N | `asistencias` | `asistencias.id_registrado_por` | Preceptor/profesor que marca o corrige. |
| `asistencias` | 1 → N | `reclamos_asistencia` | `reclamos_asistencia.id_asistencia` | Reclamos sobre un día puntual. |
| `usuarios` | 1 → N | `reclamos_asistencia` | `reclamos_asistencia.id_alumno` | Quién reclama. |

#### Proyectos integradores (núcleo del dashboard web)

| Tabla A | Relación | Tabla B | Tabla puente / FK | Notas |
|---------|----------|---------|-------------------|-------|
| `grupos_proyectos` | N ↔ N | `materias` | `proyecto_materia` | Materias vinculadas al proyecto (diseño académico). |
| `grupos_proyectos` | N ↔ N | `usuarios` (tutor) | `proyecto_profesor` | En la **app web**, quien crea el proyecto queda aquí como **dueño**. |
| `grupos_proyectos` | N ↔ N | `usuarios` (profesor supervisor) | `proyecto_profesor_asignado` | Profesores asignados por admin; gestionan y bloquean secciones (migración 015). |
| `grupos_proyectos` | N ↔ N | `usuarios` (integrante) | `grupo_estudiante` | Miembros invitados por email; ven el proyecto en su listado. |
| `grupos_proyectos` | 1 → N | `tareas_grupo` | `tareas_grupo.id_grupo` | Kanban / pendientes del inicio. |
| `grupos_proyectos` | 1 → N | `avances_proyecto` | `avances_proyecto.id_grupo` | Entregas parciales. |
| `avances_proyecto` | 1 → N | `correcciones_proyecto` | `correcciones_proyecto.id_avance` | Feedback del tutor. |
| `grupos_proyectos` | 1 → N | `anotaciones_proyectos` | `anotaciones_proyectos.id_grupo` | Bitácora del grupo. |
| `grupos_proyectos` | 1 → N | `documentacion_aprobacion` | `documentacion_aprobacion.id_grupo` | Diseño original; la app web usa `grupos_proyectos.documentos` (JSONB). |
| `usuarios` | 1 → N | `tareas_grupo` | `id_asignado_a`, `id_creado_por` | Responsable y autor de la tarea. |

#### Seguimiento individual

| Tabla A | Relación | Tabla B | Tabla puente / FK | Notas |
|---------|----------|---------|-------------------|-------|
| `usuarios` (alumno) | 1 → N | `anotaciones_progreso` | `id_alumno` | Notas del profesor sobre un alumno. |
| `usuarios` (profesor) | 1 → N | `anotaciones_progreso` | `id_profesor` | Autor de la anotación. |

### 5.4 Relaciones en la app web (subconjunto activo)

Entidades que usa hoy la aplicación React + API Express: `auth.users`, `usuarios`, `roles`, `grupos_proyectos`, `proyecto_profesor`, `grupo_estudiante`, `tareas_grupo`.

**Flujos típicos:**

1. **Crear proyecto**  
   `grupos_proyectos` (1 fila) + `proyecto_profesor` (dueño = usuario logueado). Opcional: filas en `grupo_estudiante` por cada integrante.

2. **Ver mis proyectos**  
   Unión de IDs desde `proyecto_profesor` (soy dueño) **∪** `grupo_estudiante` (soy integrante) → consulta a `grupos_proyectos`.

3. **Dashboard**  
   Mismos grupos accesibles → `grupos_proyectos` (`es_favorito`) y `tareas_grupo` (pendientes / conteo en carrusel).

4. **Invitar integrante**  
   Email en `auth.users` → RPC `find_user_id_by_email` → INSERT en `grupo_estudiante` (`id_grupo`, `id_usuario`).

5. **Configuración del proyecto**  
   Todo en una fila de `grupos_proyectos` (alcance, notas, links, `documentos` JSONB) + sincronización de `grupo_estudiante` en pestaña Equipo.

### 5.5 Cardinalidad resumida (proyectos)

| Entidad central | Relación | Cardinalidad | Tabla relacionada |
|-----------------|----------|--------------|-------------------|
| `grupos_proyectos` | dueño | **1** dueño por proyecto (app) | `proyecto_profesor` |
| `grupos_proyectos` | integrantes | **0..N** | `grupo_estudiante` |
| `grupos_proyectos` | tareas | **0..N** | `tareas_grupo` |
| `grupos_proyectos` | documentos (app) | **0..N** enlaces en JSON | columna `documentos` |
| `usuarios` | proyectos como dueño | **0..N** | vía `proyecto_profesor` |
| `usuarios` | proyectos como integrante | **0..N** | vía `grupo_estudiante` |

Un mismo usuario puede ser **dueño** de varios proyectos e **integrante** de otros; no es obligatorio que coincida el rol global (`roles`) con ser dueño en `proyecto_profesor` (p. ej. un alumno puede crear un proyecto y ser dueño).

---

## 6. Implementación Supabase — Classify (proyecto `jgrtmokyqdvdxsldmkou`)

Esta sección documenta el **estado real** de la base desplegada para la aplicación web (Express + React), no el diseño académico completo de las 18 tablas.

### 6.1 Autenticación e identidad

| Concepto | Implementación |
|--------|----------------|
| Login / registro | **Supabase Auth** (`auth.users`): email y contraseña. |
| Perfil en app | Tabla `usuarios`: `id_usuario` = UUID = `auth.users.id`. |
| Email en consultas | Se lee desde `auth.users`, no desde una columna `email` en `usuarios`. |
| Rol en UI | `usuarios.id_rol` → `roles.nombre_rol` (`admin`, `profesor`, `alumno`). Registro asigna **alumno** por defecto. |
| Cargo en sidebar | Mapeo API: `Profesor`, `Alumno`, etc. |

### 6.2 Tablas usadas por la app web (hoy)

| Vista / feature | Tablas principales |
|-----------------|-------------------|
| Login, perfil | `auth.users`, `usuarios`, `roles` |
| `/proyectos` | `grupos_proyectos`, `proyecto_profesor`, `grupo_estudiante` |
| Admin usuarios + huella | `usuarios` (`huella_id`), sesión en memoria en API + ESP32 |
| Configuración proyecto | `grupos_proyectos` (columnas de alcance, links, `documentos` JSONB) |
| Carrusel inicio | `grupos_proyectos` (`es_favorito = true`) + conteo en `tareas_grupo` |
| Pendientes | `tareas_grupo` + join `grupos_proyectos` |
| Invitar integrantes | `grupo_estudiante` + RPC `find_user_id_by_email`, `search_usuarios_for_invite` |

### 6.3 Migraciones aplicadas (`supabase/migrations/`)

> Detalle cronológico, políticas, RPC y Storage: **[`migraciones.md`](./migraciones.md)**.

| # | Archivo | Cambios |
|---|---------|---------|
| 001 | `001_grupos_proyectos_ui_columns.sql` | `estado_proyecto`, `escuela` (luego eliminada), CHECK Abierto/Cerrado, seed roles `admin`/`profesor`/`alumno`. |
| 002 | `002_grant_public_schema_api_roles.sql` | Grants `USAGE`/`SELECT`/`INSERT`/`UPDATE`/`DELETE` para `anon` y `authenticated` en `public`. |
| 003 | `003_grupos_proyectos_favorito_and_crud_rls.sql` | `es_favorito`; políticas RLS INSERT/UPDATE/DELETE en `proyecto_profesor` y `grupos_proyectos`. |
| 004 | `004_drop_escuela_and_members.sql` | `DROP COLUMN escuela`. |
| 005 | `005_create_grupo_proyecto_rpc.sql` | Función `create_grupo_proyecto(nombre, descripcion)` — crea grupo + vínculo dueño en una transacción. |
| 006 | `006_rls_member_access.sql` | Integrantes pueden **leer** proyectos y tareas de sus grupos (`grupos_proyectos_select_member`, `grupo_estudiante_select_own`, `tareas_grupo_select_member`). |
| 007 | `007_project_config_columns.sql` | `alcance_detalle`, `notas_alcance`, `anteproyecto_validado`, `link_respaldo`, `link_calificaciones`, `documentos`; RPC `get_project_owner_email`. |
| 008 | `008_profile_avatars_storage.sql` | Bucket Storage `avatars` (público, 2 MB, jpeg/png/webp) + políticas CRUD en carpeta `{user_id}/`. |
| 009 | `009_search_usuarios_dni.sql` | RPC `search_usuarios_for_invite` ampliada: devuelve `dni` y busca por DNI, email, nombre o apellido. |
| 016 | `016_usuarios_huella_id.sql` | Columna `usuarios.huella_id` (INT, UNIQUE, 0–199) para vincular slot del sensor AS608. |

**Migraciones adicionales vía Supabase MCP** (mismo proyecto, sin archivo local separado):

- Políticas RLS iniciales: `usuarios`, `roles`, `proyecto_profesor`, `grupos_proyectos` (select dueño), `tareas_grupo`.
- `find_user_id_by_email(p_email)` — busca UUID en `auth.users`.
- `get_group_member_emails(p_id_grupo)` — emails de integrantes.
- `search_usuarios_for_invite(p_query)` — autocompletado por DNI, email, nombre o apellido (ver migración 009).
- RLS `grupo_estudiante`: SELECT/INSERT/DELETE para el **dueño** del proyecto (`proyecto_profesor`).

### 6.4 Funciones RPC (`SECURITY DEFINER`)

| Función | Uso |
|---------|-----|
| `create_grupo_proyecto(p_nombre, p_descripcion?)` | POST `/api/projects` — evita fallo RLS al crear y devolver el grupo. |
| `find_user_id_by_email(p_email)` | Resolver email → `auth.users.id` al invitar integrantes. |
| `get_group_member_emails(p_id_grupo)` | GET detalle de proyecto — lista de emails. |
| `search_usuarios_for_invite(p_query)` | GET `/api/users/search?q=` — chips de invitación (DNI, email, nombre, apellido). |
| `get_project_owner_email(p_id_grupo)` | Email del creador (dueño en `proyecto_profesor`). |

Todas con `GRANT EXECUTE` a `authenticated` (revocado de `PUBLIC`).

### 6.5 Row Level Security (RLS) — resumen

| Tabla | Quién puede leer | Quién puede escribir |
|-------|------------------|----------------------|
| `usuarios` | Propio registro (`id_usuario = auth.uid()`) | INSERT/UPDATE propio |
| `roles` | `authenticated` (lectura) | — |
| `proyecto_profesor` | Dueño (`id_profesor = auth.uid()`) | INSERT/DELETE propio vínculo |
| `grupos_proyectos` | Dueño **o** integrante en `grupo_estudiante` | INSERT cualquier autenticado; UPDATE/DELETE solo dueño |
| `grupo_estudiante` | Dueño del grupo **o** propia fila (`id_usuario = auth.uid()`) | INSERT/DELETE solo dueño |
| `tareas_grupo` | Dueño del proyecto **o** integrante del grupo | *(según políticas base del proyecto académico)* |

**Reglas de negocio en API (además de RLS):**

- Listado de proyectos: dueño (`proyecto_profesor`) **+** integrante (`grupo_estudiante`).
- Editar configuración / borrar / favorito: solo **dueño** (`proyecto_profesor`).
- `anteproyecto_validado`: solo usuarios con rol **profesor** (en API y UI); un profesor integrante puede guardar solo ese campo.

### 6.6 Mapeo columnas → UI (configuración del proyecto)

| Columna BD | Pestaña / pantalla |
|------------|-------------------|
| `nombre_proyecto` | Alcance — título |
| `descripcion` | Alcance — objetivo general |
| `alcance_detalle` | Alcance — alcance del proyecto |
| `notas_alcance` | Panel izquierdo + columna «Detalles» en `/proyectos` |
| `estado_proyecto` | Panel «Hitos y Estado» |
| `link_respaldo` | Alcance — documentación de respaldo (+ botón Abrir) |
| `anteproyecto_validado` | Calificaciones — checkbox (solo profesor) |
| `documentos` (JSONB) | Documentaciones — lista con botón Abrir |
| `grupo_estudiante` + RPC | Equipo — integrantes por email |

### 6.7 Formato `documentos` (JSONB)

```json
[
  { "nombre": "Nombre De ejemplo", "url": "https://drive.google.com/..." }
]
```

Se reemplaza la tabla `Documentacion_Aprobacion` para el flujo actual de la app web (enlaces externos, no archivos subidos al servidor).

---

## 7. Historial de cambios en BD (app web)

| Fecha aprox. | Cambio |
|--------------|--------|
| 2026 | Integración Supabase Auth + Express API. |
| 2026 | Columnas UI en `grupos_proyectos`: `estado_proyecto`, `es_favorito`. |
| 2026 | Eliminación de `escuela`. |
| 2026 | Integrantes (`grupo_estudiante`) + RPC búsqueda por email. |
| 2026 | RLS acceso integrantes (ver proyectos compartidos). |
| 2026 | RPC `create_grupo_proyecto` (fix RLS al crear). |
| 2026 | Configuración proyecto: alcance, notas, aprobación, links, documentos JSONB. |
| 2026 | Storage `avatars` para foto de perfil (`/preferencias`). |
| 2026 | Búsqueda de integrantes por DNI en `search_usuarios_for_invite`. |
| 2026 | Columna `usuarios.huella_id` + flujo de asignación de huella (admin + ESP32 + AS608). |

### 6.8 Flujo de asignación de huella (app web + ESP32)

1. Admin abre **Asignar Huella** en `/admin/usuarios` para un usuario.
2. API crea sesión en memoria (`POST /api/admin/users/:id/huella/iniciar`) con un slot libre (0–199) o reutiliza el existente.
3. ESP32 consulta `GET /api/device/esp32/huella/pendiente` y ejecuta enrolamiento físico (Adafruit + AS608).
4. ESP32 reporta progreso (`POST .../huella/progreso`) y resultado (`POST .../huella/resultado`).
5. API persiste `usuarios.huella_id = slotId` al confirmar éxito.
6. Admin ve el estado en tiempo real vía polling (`GET .../huella/estado`).

Endpoints admin: `POST iniciar`, `GET estado`, `POST cancelar`, `DELETE huella` (elimina del sensor y limpia BD).

Endpoints dispositivo: `GET huella/pendiente`, `POST huella/progreso`, `POST huella/resultado` (header `X-Device-Token`).