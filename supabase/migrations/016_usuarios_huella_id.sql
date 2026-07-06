-- Slot del sensor AS608 vinculado a cada usuario (0..199, único por usuario)
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS huella_id integer UNIQUE;

ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_huella_id_range;

ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_huella_id_range
  CHECK (huella_id IS NULL OR (huella_id >= 0 AND huella_id <= 199));
