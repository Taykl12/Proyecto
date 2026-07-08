-- Respaldo durable de templates biométricos AS608 (base64) por usuario.
-- usuarios.huella_id sigue indicando el slot cargado en el sensor físico.

CREATE TABLE IF NOT EXISTS huellas (
  id_huella uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  id_usuario uuid NOT NULL UNIQUE REFERENCES usuarios(id_usuario) ON DELETE CASCADE,
  slot_id integer NOT NULL CHECK (slot_id >= 0 AND slot_id <= 199),
  template_data text NOT NULL,
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  fecha_actualizacion timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_huellas_slot_id ON huellas(slot_id);

ALTER TABLE huellas ENABLE ROW LEVEL SECURITY;

-- Sin policies: solo accesible vía service role (createAdminClient) desde el backend.
