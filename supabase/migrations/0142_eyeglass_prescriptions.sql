-- 0142 — Receita de óculos (backlog 2/1, módulo oftalmologia).
--
-- Prescrição óptica estruturada por olho (OD = direito, OE = esquerdo):
-- esférico, cilíndrico, eixo, adição, prisma, base, DNP + distância de leitura.
-- Valores como TEXT (aceitam sinal e ".25"; validação leve na UI). PDF sob
-- demanda com cabeçalho da clínica.
--
-- Próximo número livre. Aditiva e idempotente.

CREATE TABLE IF NOT EXISTS public.eyeglass_prescriptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id       UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id        UUID NULL REFERENCES public.doctors(id),
  -- Olho direito (OD)
  od_sphere        TEXT NULL,
  od_cylinder      TEXT NULL,
  od_axis          TEXT NULL,
  od_addition      TEXT NULL,
  od_prism         TEXT NULL,
  od_base          TEXT NULL,
  od_dnp           TEXT NULL,
  -- Olho esquerdo (OE)
  oe_sphere        TEXT NULL,
  oe_cylinder      TEXT NULL,
  oe_axis          TEXT NULL,
  oe_addition      TEXT NULL,
  oe_prism         TEXT NULL,
  oe_base          TEXT NULL,
  oe_dnp           TEXT NULL,
  reading_distance TEXT NULL,
  notes            TEXT NULL CHECK (notes IS NULL OR char_length(notes) <= 2000),
  issued_at        TIMESTAMPTZ NULL,
  created_by       UUID NOT NULL REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ NULL,
  deleted_by       UUID NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS eyeglass_prescriptions_patient_idx
  ON public.eyeglass_prescriptions (tenant_id, patient_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE public.eyeglass_prescriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eyeglass_prescriptions_read ON public.eyeglass_prescriptions;
CREATE POLICY eyeglass_prescriptions_read ON public.eyeglass_prescriptions
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS eyeglass_prescriptions_write ON public.eyeglass_prescriptions;
CREATE POLICY eyeglass_prescriptions_write ON public.eyeglass_prescriptions
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin', 'profissional_saude'));

COMMENT ON TABLE public.eyeglass_prescriptions IS
  'Backlog 2/1 — receita de óculos (prescrição óptica por olho). PDF sob demanda.';

NOTIFY pgrst, 'reload schema';
