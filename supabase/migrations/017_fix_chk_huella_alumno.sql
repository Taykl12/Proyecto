-- La restricción original usaba id_rol = 4 (diseño académico),
-- pero en Classify el rol alumno es id_rol = 3.
ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS chk_huella_alumno;

ALTER TABLE usuarios
  ADD CONSTRAINT chk_huella_alumno
  CHECK (id_rol = 3 OR huella_id IS NULL);
