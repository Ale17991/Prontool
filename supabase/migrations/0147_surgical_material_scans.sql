-- 0147 — Etiqueta de material cirúrgico (código de barras) + verificação de
-- documento por QR (backlog 1/4/3).
--
-- surgical_material_scans: append-only (cada scan é uma linha; status definido
-- no INSERT). document_verification_tokens: token público p/ QR de autenticidade
-- (mutável só no contador de verificações). Aditiva e idempotente.

-- =====================================================================
-- 1) surgical_material_scans
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.surgical_material_scans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  appointment_id   UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  material_id      UUID NULL REFERENCES public.appointment_materials(id),
  raw_barcode      TEXT NOT NULL,
  barcode_format   TEXT NOT NULL
                     CHECK (barcode_format IN ('gs1_datamatrix', 'gs1_128', 'ean13', 'qr', 'manual')),
  gtin             TEXT NULL,
  lot_number       TEXT NULL,
  expiration_date  DATE NULL,
  serial_number    TEXT NULL,
  manufacturer     TEXT NULL,
  scanned_by       UUID NOT NULL REFERENCES auth.users(id),
  scanned_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT NOT NULL DEFAULT 'confirmed'
                     CHECK (status IN ('confirmed', 'rejected', 'expired')),
  rejection_reason TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, appointment_id, raw_barcode)
);

CREATE INDEX IF NOT EXISTS surgical_material_scans_appt_idx
  ON public.surgical_material_scans (tenant_id, appointment_id, scanned_at DESC);

ALTER TABLE public.surgical_material_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS surgical_material_scans_read ON public.surgical_material_scans;
CREATE POLICY surgical_material_scans_read ON public.surgical_material_scans
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS surgical_material_scans_insert ON public.surgical_material_scans;
CREATE POLICY surgical_material_scans_insert ON public.surgical_material_scans
  FOR INSERT
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

-- Append-only: sem UPDATE/DELETE (helper canônico da 0012).
DROP TRIGGER IF EXISTS surgical_material_scans_append_only ON public.surgical_material_scans;
CREATE TRIGGER surgical_material_scans_append_only
  BEFORE UPDATE OR DELETE ON public.surgical_material_scans
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();

-- =====================================================================
-- 2) document_verification_tokens (QR público de autenticidade)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.document_verification_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  appointment_id   UUID NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  token            TEXT NOT NULL UNIQUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_count   INTEGER NOT NULL DEFAULT 0,
  last_verified_at TIMESTAMPTZ NULL,
  UNIQUE (tenant_id, appointment_id)
);

ALTER TABLE public.document_verification_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS document_verification_tokens_read ON public.document_verification_tokens;
CREATE POLICY document_verification_tokens_read ON public.document_verification_tokens
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS document_verification_tokens_insert ON public.document_verification_tokens;
CREATE POLICY document_verification_tokens_insert ON public.document_verification_tokens
  FOR INSERT
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

-- =====================================================================
-- 3) tenant_clinic_profile.surgical_scan_required
-- =====================================================================
ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS surgical_scan_required BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON TABLE public.surgical_material_scans IS
  'Backlog 1/4/3 — scans de etiqueta de material cirúrgico (GS1) por atendimento (append-only).';
COMMENT ON TABLE public.document_verification_tokens IS
  'Backlog 1/4/3 — token público para QR de verificação de autenticidade de documento.';

NOTIFY pgrst, 'reload schema';
