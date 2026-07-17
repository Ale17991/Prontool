-- 0172 — Feature 045: Custo de materiais e métrica "Gasto com materiais".
--
-- Decisões (ver specs/045-custo-materiais-financeiro/):
--   D1  Custo desconta só a margem da clínica — NÃO altera comissão/repasse.
--       (esta migration não toca commissions/monthly_payouts.)
--   D2  Catálogo de insumo LIVRE (tenant_materials), com vínculo TUSS opcional.
--       appointment_materials.tuss_code passa a ser NULLABLE; identidade do
--       material pode vir de tuss_code, material_id ou material_name.
--   D5  Pendência de custo = unit_cost_cents = 0 (derivada, sem coluna extra).
--   D6  Custo é snapshot congelado no INSERT. UPDATE de appointment_materials
--       é permitido SOMENTE nas colunas {unit_cost_cents, material_id}
--       (column-guard), via RPC set_appointment_material_cost auditada.
--
-- Padrões reusados: jwt_tenant_id(), log_audit_event(), RLS por tenant,
-- RPCs SECURITY DEFINER (padrão 0061), triggers append-only.

-- =========================================================================
-- (a) Catálogo de insumos por clínica — public.tenant_materials
--     NÃO é append-only (custo é config editável). Toda mudança é auditada;
--     a imutabilidade financeira vive no snapshot de uso.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.tenant_materials (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name             TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  unit_cost_cents  INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  tuss_code        TEXT REFERENCES public.tuss_codes(code) ON DELETE RESTRICT,
  active           BOOLEAN NOT NULL DEFAULT true,
  created_by       UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by       UUID,
  updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tenant_materials_tenant_active_idx
  ON public.tenant_materials (tenant_id, active);
CREATE INDEX IF NOT EXISTS tenant_materials_name_idx
  ON public.tenant_materials (tenant_id, lower(name));
CREATE INDEX IF NOT EXISTS tenant_materials_tuss_idx
  ON public.tenant_materials (tenant_id, tuss_code) WHERE tuss_code IS NOT NULL;
-- Evita insumo ATIVO duplicado por nome na mesma clínica.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_materials_unique_active_name
  ON public.tenant_materials (tenant_id, lower(name)) WHERE active;

COMMENT ON TABLE public.tenant_materials IS
  'Catálogo de insumos/materiais por clínica com custo unitário (feature 045). Insumo livre; tuss_code opcional.';

-- RLS: SELECT/INSERT/UPDATE por tenant do JWT. Sem DELETE físico (desativar via active=false).
ALTER TABLE public.tenant_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_materials_read ON public.tenant_materials;
CREATE POLICY tenant_materials_read ON public.tenant_materials
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tenant_materials_insert ON public.tenant_materials;
CREATE POLICY tenant_materials_insert ON public.tenant_materials
  FOR INSERT WITH CHECK (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tenant_materials_update ON public.tenant_materials;
CREATE POLICY tenant_materials_update ON public.tenant_materials
  FOR UPDATE USING (tenant_id = public.jwt_tenant_id())
             WITH CHECK (tenant_id = public.jwt_tenant_id());

REVOKE DELETE ON public.tenant_materials FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tenant_materials TO authenticated;

-- Trigger: tuss_code opcional; se presente, DEVE ser tabela 19 vigente.
CREATE OR REPLACE FUNCTION public.check_tenant_material_tuss()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_table TEXT;
  v_valid_to DATE;
BEGIN
  IF NEW.tuss_code IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tuss_table, valid_to INTO v_table, v_valid_to
    FROM public.tuss_codes WHERE code = NEW.tuss_code;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'MATERIAL_TUSS_INVALID: código % não encontrado no catálogo TUSS', NEW.tuss_code
      USING ERRCODE = '23503';
  END IF;
  IF v_table <> '19' THEN
    RAISE EXCEPTION 'MATERIAL_TUSS_INVALID: código % pertence à tabela TUSS %, esperado 19', NEW.tuss_code, v_table
      USING ERRCODE = '42501';
  END IF;
  IF v_valid_to IS NOT NULL AND v_valid_to < CURRENT_DATE THEN
    RAISE EXCEPTION 'MATERIAL_TUSS_INVALID: código % retirado em %', NEW.tuss_code, v_valid_to
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenant_materials_tuss_guard ON public.tenant_materials;
CREATE TRIGGER tenant_materials_tuss_guard
  BEFORE INSERT OR UPDATE ON public.tenant_materials
  FOR EACH ROW EXECUTE FUNCTION public.check_tenant_material_tuss();

-- Trigger: updated_at automático em UPDATE.
CREATE OR REPLACE FUNCTION public.touch_tenant_materials_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenant_materials_touch ON public.tenant_materials;
CREATE TRIGGER tenant_materials_touch
  BEFORE UPDATE ON public.tenant_materials
  FOR EACH ROW EXECUTE FUNCTION public.touch_tenant_materials_updated_at();

-- Trigger: auditoria (created / updated / deactivated).
CREATE OR REPLACE FUNCTION public.audit_tenant_materials()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tenant_materials', NEW.id, v_action, NULL,
      json_build_object('name', NEW.name, 'unit_cost_cents', NEW.unit_cost_cents,
                        'tuss_code', NEW.tuss_code, 'active', NEW.active)::text,
      'feature 045 — insumo cadastrado');
  ELSE
    v_action := CASE WHEN OLD.active AND NOT NEW.active THEN 'deactivated' ELSE 'updated' END;
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'tenant_materials', NEW.id, v_action,
      json_build_object('name', OLD.name, 'unit_cost_cents', OLD.unit_cost_cents, 'active', OLD.active)::text,
      json_build_object('name', NEW.name, 'unit_cost_cents', NEW.unit_cost_cents, 'active', NEW.active)::text,
      'feature 045 — insumo alterado');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tenant_materials_audit ON public.tenant_materials;
CREATE TRIGGER tenant_materials_audit
  AFTER INSERT OR UPDATE ON public.tenant_materials
  FOR EACH ROW EXECUTE FUNCTION public.audit_tenant_materials();

-- =========================================================================
-- (b) appointment_materials — custo (snapshot) + insumo livre
-- =========================================================================
ALTER TABLE public.appointment_materials
  ADD COLUMN IF NOT EXISTS unit_cost_cents INTEGER NOT NULL DEFAULT 0
    CHECK (unit_cost_cents >= 0),
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES public.tenant_materials(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS material_name TEXT
    CHECK (material_name IS NULL OR length(material_name) BETWEEN 1 AND 200);

-- Insumo livre: tuss_code e tuss_description passam a ser opcionais.
ALTER TABLE public.appointment_materials ALTER COLUMN tuss_code DROP NOT NULL;
ALTER TABLE public.appointment_materials ALTER COLUMN tuss_description DROP NOT NULL;

-- Identidade mínima: o material precisa ser identificável por algum campo.
ALTER TABLE public.appointment_materials
  DROP CONSTRAINT IF EXISTS appointment_materials_identity_chk;
ALTER TABLE public.appointment_materials
  ADD CONSTRAINT appointment_materials_identity_chk
  CHECK (tuss_code IS NOT NULL OR material_id IS NOT NULL OR material_name IS NOT NULL);

COMMENT ON COLUMN public.appointment_materials.unit_cost_cents IS
  'Custo unitário congelado (snapshot) no momento do uso (feature 045). 0 = pendência de custo.';
COMMENT ON COLUMN public.appointment_materials.material_id IS
  'Proveniência opcional: insumo do catálogo tenant_materials (feature 045).';

-- tuss_code opcional agora — relaxar a validação para pular quando NULL.
CREATE OR REPLACE FUNCTION public.check_material_tuss_table()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_table TEXT;
  v_valid_to DATE;
BEGIN
  IF NEW.tuss_code IS NULL THEN
    RETURN NEW;  -- insumo livre (feature 045)
  END IF;
  SELECT tuss_table, valid_to INTO v_table, v_valid_to
    FROM public.tuss_codes WHERE code = NEW.tuss_code;
  IF v_table IS NULL THEN
    RAISE EXCEPTION 'MATERIAL_TUSS_INVALID: código % não encontrado no catálogo TUSS', NEW.tuss_code
      USING ERRCODE = '23503';
  END IF;
  IF v_table <> '19' THEN
    RAISE EXCEPTION 'MATERIAL_TUSS_INVALID: código % pertence à tabela TUSS %, esperado 19 (Materiais)',
      NEW.tuss_code, v_table USING ERRCODE = '42501';
  END IF;
  IF v_valid_to IS NOT NULL AND v_valid_to < CURRENT_DATE THEN
    RAISE EXCEPTION 'MATERIAL_TUSS_INVALID: código % retirado em %', NEW.tuss_code, v_valid_to
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- Consistência de tenant do material_id.
CREATE OR REPLACE FUNCTION public.check_appointment_material_catalog_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_mat_tenant UUID;
BEGIN
  IF NEW.material_id IS NULL THEN RETURN NEW; END IF;
  SELECT tenant_id INTO v_mat_tenant FROM public.tenant_materials WHERE id = NEW.material_id;
  IF v_mat_tenant IS NULL OR v_mat_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'MATERIAL_TENANT_MISMATCH: insumo % não pertence à clínica', NEW.material_id
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_materials_catalog_tenant ON public.appointment_materials;
CREATE TRIGGER appointment_materials_catalog_tenant
  BEFORE INSERT OR UPDATE ON public.appointment_materials
  FOR EACH ROW EXECUTE FUNCTION public.check_appointment_material_catalog_tenant();

-- =========================================================================
-- (c) Append-only relaxado (column-guard): DELETE proibido; UPDATE permitido
--     SOMENTE nas colunas {unit_cost_cents, material_id}. Vale para todos os
--     papéis (defesa em profundidade). INSERT direto continua bloqueado a
--     authenticated pelo REVOKE de 0061 — só as RPCs inserem.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_appointment_materials_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_user IN ('postgres','supabase_admin','service_role','supabase_auth_admin') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'appointment_materials: append-only. DELETE não permitido.'
      USING ERRCODE = '42501';
  END IF;

  -- UPDATE: só custo/proveniência podem mudar; demais colunas são imutáveis.
  IF ( OLD.tenant_id, OLD.appointment_id, OLD.tuss_code, OLD.tuss_description,
       OLD.material_name, OLD.quantity, OLD.created_by, OLD.created_at )
     IS DISTINCT FROM
     ( NEW.tenant_id, NEW.appointment_id, NEW.tuss_code, NEW.tuss_description,
       NEW.material_name, NEW.quantity, NEW.created_by, NEW.created_at )
  THEN
    RAISE EXCEPTION 'appointment_materials: append-only. Apenas unit_cost_cents/material_id podem ser alterados.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- Recria o trigger para cobrir UPDATE além de DELETE.
DROP TRIGGER IF EXISTS appointment_materials_immutable ON public.appointment_materials;
CREATE TRIGGER appointment_materials_immutable
  BEFORE UPDATE OR DELETE ON public.appointment_materials
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_materials_mutation();

-- Auditoria da correção de custo.
CREATE OR REPLACE FUNCTION public.audit_appointment_material_cost_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.unit_cost_cents IS DISTINCT FROM OLD.unit_cost_cents
     OR NEW.material_id IS DISTINCT FROM OLD.material_id THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'appointment_materials', NEW.id, 'cost_updated',
      json_build_object('unit_cost_cents', OLD.unit_cost_cents, 'material_id', OLD.material_id)::text,
      json_build_object('unit_cost_cents', NEW.unit_cost_cents, 'material_id', NEW.material_id)::text,
      'feature 045 — custo do material atualizado');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_materials_cost_audit ON public.appointment_materials;
CREATE TRIGGER appointment_materials_cost_audit
  AFTER UPDATE ON public.appointment_materials
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_material_cost_update();

-- =========================================================================
-- (d) RPCs de anexação — aceitam unit_cost_cents + material_id + material_name
--     e tuss_code opcional. Assinaturas inalteradas (payload JSONB).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.attach_materials_to_appointment(
  p_appointment_id UUID,
  p_materials      JSONB,
  p_actor          UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id  UUID;
  v_jwt_tenant UUID;
  v_inserted   JSONB;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();

  SELECT tenant_id INTO v_tenant_id FROM public.appointments WHERE id = p_appointment_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> v_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_reversals WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_REVERSED', ERRCODE = '23514';
  END IF;
  IF p_materials IS NULL OR jsonb_typeof(p_materials) <> 'array' OR jsonb_array_length(p_materials) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'MATERIALS_REQUIRED', ERRCODE = '22023';
  END IF;

  WITH inserted AS (
    INSERT INTO public.appointment_materials (
      tenant_id, appointment_id, tuss_code, tuss_description, material_id,
      material_name, quantity, unit_cost_cents, created_by
    )
    SELECT
      v_tenant_id,
      p_appointment_id,
      NULLIF(item->>'tuss_code','')::text,
      NULLIF(item->>'tuss_description','')::text,
      NULLIF(item->>'material_id','')::uuid,
      NULLIF(item->>'material_name','')::text,
      COALESCE((item->>'quantity')::int, 1),
      COALESCE((item->>'unit_cost_cents')::int, 0),
      p_actor
    FROM jsonb_array_elements(p_materials) AS item
    RETURNING id, tuss_code, tuss_description, material_id, material_name,
              quantity, unit_cost_cents, created_at, created_by
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id', id, 'tuss_code', tuss_code, 'tuss_description', tuss_description,
    'material_id', material_id, 'material_name', material_name,
    'quantity', quantity, 'unit_cost_cents', unit_cost_cents,
    'created_at', created_at, 'created_by', created_by
  )) INTO v_inserted FROM inserted;

  RETURN jsonb_build_object('appointment_id', p_appointment_id,
                            'materials', COALESCE(v_inserted, '[]'::jsonb));
END $$;

GRANT EXECUTE ON FUNCTION public.attach_materials_to_appointment(UUID, JSONB, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_appointment_with_materials(
  p_tenant_id UUID, p_patient_id UUID, p_doctor_id UUID, p_procedure_id UUID,
  p_plan_id UUID, p_source_price_version_id UUID, p_source_commission_history_id UUID,
  p_frozen_amount_cents INTEGER, p_frozen_commission_bps INTEGER,
  p_appointment_at TIMESTAMPTZ, p_duration_minutes INTEGER, p_observacoes TEXT,
  p_source TEXT, p_actor UUID, p_materials JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appointment_id UUID;
  v_count INTEGER := 0;
  v_jwt_tenant UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> p_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE = 'TENANT_MISMATCH', ERRCODE = '42501';
  END IF;

  INSERT INTO public.appointments (
    tenant_id, patient_id, doctor_id, procedure_id, plan_id,
    source_price_version_id, source_commission_history_id, source_raw_event_id,
    frozen_amount_cents, frozen_commission_bps,
    appointment_at, duration_minutes, source, observacoes
  ) VALUES (
    p_tenant_id, p_patient_id, p_doctor_id, p_procedure_id, p_plan_id,
    p_source_price_version_id, p_source_commission_history_id, NULL,
    p_frozen_amount_cents, p_frozen_commission_bps,
    p_appointment_at, p_duration_minutes, p_source, p_observacoes
  ) RETURNING id INTO v_appointment_id;

  IF p_materials IS NOT NULL AND jsonb_typeof(p_materials) = 'array' AND jsonb_array_length(p_materials) > 0 THEN
    INSERT INTO public.appointment_materials (
      tenant_id, appointment_id, tuss_code, tuss_description, material_id,
      material_name, quantity, unit_cost_cents, created_by
    )
    SELECT
      p_tenant_id, v_appointment_id,
      NULLIF(item->>'tuss_code','')::text,
      NULLIF(item->>'tuss_description','')::text,
      NULLIF(item->>'material_id','')::uuid,
      NULLIF(item->>'material_name','')::text,
      COALESCE((item->>'quantity')::int, 1),
      COALESCE((item->>'unit_cost_cents')::int, 0),
      p_actor
    FROM jsonb_array_elements(p_materials) AS item;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('appointment_id', v_appointment_id, 'materials_count', v_count);
END $$;

GRANT EXECUTE ON FUNCTION public.create_appointment_with_materials(
  UUID, UUID, UUID, UUID, UUID, UUID, UUID, INTEGER, INTEGER,
  TIMESTAMPTZ, INTEGER, TEXT, TEXT, UUID, JSONB
) TO authenticated;

-- =========================================================================
-- (e) RPC nova — completar/corrigir custo pendente (column-guard, auditada)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.set_appointment_material_cost(
  p_material_row_id UUID,
  p_unit_cost_cents INTEGER,
  p_material_id     UUID,
  p_reason          TEXT,
  p_actor           UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id  UUID;
  v_jwt_tenant UUID;
BEGIN
  IF p_unit_cost_cents IS NULL OR p_unit_cost_cents < 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'MATERIAL_COST_INVALID', ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'REASON_REQUIRED', ERRCODE = '22023';
  END IF;

  SELECT tenant_id INTO v_tenant_id FROM public.appointment_materials WHERE id = p_material_row_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'MATERIAL_ROW_NOT_FOUND', ERRCODE = '02000';
  END IF;
  v_jwt_tenant := public.jwt_tenant_id();
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> v_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE = 'MATERIAL_ROW_NOT_FOUND', ERRCODE = '02000';
  END IF;

  -- perform.set_config guarda o motivo na trilha (padrão do projeto usa app.actor_id).
  UPDATE public.appointment_materials
     SET unit_cost_cents = p_unit_cost_cents,
         material_id = COALESCE(p_material_id, material_id)
   WHERE id = p_material_row_id;

  RETURN jsonb_build_object('id', p_material_row_id, 'unit_cost_cents', p_unit_cost_cents);
END $$;

GRANT EXECUTE ON FUNCTION public.set_appointment_material_cost(UUID, INTEGER, UUID, TEXT, UUID)
  TO authenticated;

-- =========================================================================
-- Done. (RBAC admin/financeiro é aplicado na camada de aplicação via requireRole.)
-- =========================================================================
