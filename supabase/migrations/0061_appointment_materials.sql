-- 0061 — Feature 007: Materiais utilizados no atendimento (TUSS tabela 19).
--
-- Decisoes:
--   1. Tabela append-only (Principio I). Trigger rejeita UPDATE/DELETE de
--      authenticated; service_role / postgres bypassam.
--   2. RLS por tenant_id usando public.jwt_tenant_id() (consistente com
--      0017_rls_policies.sql).
--   3. tuss_description e SNAPSHOT — congelado no momento do INSERT pra
--      preservar historia caso o catalogo TUSS mude.
--   4. Trigger check_material_tuss_table valida que o codigo pertence a
--      TUSS tabela 19 e ainda esta vigente (valid_to IS NULL). Defesa em
--      profundidade — service tambem pre-valida.
--   5. Trigger check_material_tenant_consistency valida que o tenant_id
--      do material bate com o tenant_id do appointment.
--   6. Trigger audit_appointment_materials grava log via log_audit_event
--      (entity='appointment_materials', field='created', new_value=JSON).
--   7. RPCs SECURITY DEFINER seguindo padrao de mark_appointment_realized
--      (0055): rodam com privilegios elevados mas verificam jwt_tenant_id()
--      explicitamente. Permite atomicidade (multi-INSERT em uma transacao)
--      sem expor service_role ao cliente.
--   8. INSERT direto bloqueado para authenticated. Anexacao soh via RPC
--      attach_materials_to_appointment ou create_appointment_with_materials.
--      SELECT permitido a authenticated com filtro RLS.

-- =========================================================================
-- (a) Tabela appointment_materials
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.appointment_materials (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  appointment_id    UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  tuss_code         TEXT NOT NULL REFERENCES public.tuss_codes(code) ON DELETE RESTRICT,
  tuss_description  TEXT NOT NULL CHECK (length(tuss_description) BETWEEN 1 AND 500),
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_by        UUID NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_materials_appointment_idx
  ON public.appointment_materials (appointment_id);

CREATE INDEX IF NOT EXISTS appointment_materials_tenant_idx
  ON public.appointment_materials (tenant_id, created_at DESC);

COMMENT ON TABLE public.appointment_materials IS
  'Materiais (TUSS tabela 19) usados em um atendimento. Append-only (feature 007).';
COMMENT ON COLUMN public.appointment_materials.tuss_description IS
  'Snapshot da descricao no momento da insercao — preserva historia se o catalogo TUSS mudar.';

-- =========================================================================
-- (b) RLS — leitura por authenticated, INSERT/UPDATE/DELETE bloqueados
-- =========================================================================
ALTER TABLE public.appointment_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_materials_read ON public.appointment_materials;
CREATE POLICY appointment_materials_read ON public.appointment_materials
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.appointment_materials FROM authenticated;
GRANT SELECT ON public.appointment_materials TO authenticated;

-- =========================================================================
-- (c) Trigger: append-only enforcement
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_appointment_materials_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'appointment_materials: append-only. UPDATE/DELETE not permitted.'
    USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS appointment_materials_immutable ON public.appointment_materials;
CREATE TRIGGER appointment_materials_immutable
  BEFORE UPDATE OR DELETE ON public.appointment_materials
  FOR EACH ROW EXECUTE FUNCTION public.enforce_appointment_materials_mutation();

-- =========================================================================
-- (d) Trigger: tenant consistency com appointment
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_material_tenant_consistency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_appointment_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_appointment_tenant
    FROM public.appointments
   WHERE id = NEW.appointment_id;

  IF v_appointment_tenant IS NULL THEN
    RAISE EXCEPTION 'appointment_materials: appointment % nao encontrado', NEW.appointment_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.tenant_id <> v_appointment_tenant THEN
    RAISE EXCEPTION 'MATERIAL_TENANT_MISMATCH: material.tenant_id (%) <> appointment.tenant_id (%)',
      NEW.tenant_id, v_appointment_tenant
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_materials_tenant_consistency ON public.appointment_materials;
CREATE TRIGGER appointment_materials_tenant_consistency
  BEFORE INSERT ON public.appointment_materials
  FOR EACH ROW EXECUTE FUNCTION public.check_material_tenant_consistency();

-- =========================================================================
-- (e) Trigger: codigo TUSS deve ser tabela 19 e vigente
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_material_tuss_table()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_table TEXT;
  v_valid_to DATE;
BEGIN
  SELECT tuss_table, valid_to INTO v_table, v_valid_to
    FROM public.tuss_codes
   WHERE code = NEW.tuss_code;

  IF v_table IS NULL THEN
    RAISE EXCEPTION 'MATERIAL_TUSS_INVALID: codigo % nao encontrado no catalogo TUSS', NEW.tuss_code
      USING ERRCODE = '23503';
  END IF;

  IF v_table <> '19' THEN
    RAISE EXCEPTION 'MATERIAL_TUSS_INVALID: codigo % pertence a tabela TUSS %, esperado 19 (Materiais)',
      NEW.tuss_code, v_table
      USING ERRCODE = '42501';
  END IF;

  IF v_valid_to IS NOT NULL AND v_valid_to < CURRENT_DATE THEN
    RAISE EXCEPTION 'MATERIAL_TUSS_INVALID: codigo % retirado em %', NEW.tuss_code, v_valid_to
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_materials_tuss_guard ON public.appointment_materials;
CREATE TRIGGER appointment_materials_tuss_guard
  BEFORE INSERT ON public.appointment_materials
  FOR EACH ROW EXECUTE FUNCTION public.check_material_tuss_table();

-- =========================================================================
-- (f) Trigger: audit log no INSERT
-- =========================================================================
CREATE OR REPLACE FUNCTION public.audit_appointment_materials_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit_event(
    NEW.tenant_id,
    'appointment_materials',
    NEW.id,
    'created',
    NULL,
    json_build_object(
      'appointment_id', NEW.appointment_id,
      'tuss_code',      NEW.tuss_code,
      'tuss_description', NEW.tuss_description,
      'quantity',       NEW.quantity,
      'created_by',     NEW.created_by
    )::text,
    'feature 007 — material adicionado ao atendimento'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS appointment_materials_audit ON public.appointment_materials;
CREATE TRIGGER appointment_materials_audit
  AFTER INSERT ON public.appointment_materials
  FOR EACH ROW EXECUTE FUNCTION public.audit_appointment_materials_insert();

-- =========================================================================
-- (g) RPC: attach_materials_to_appointment
--     Anexa N materiais a um atendimento existente. Verifica:
--       - atendimento existe e pertence ao tenant do JWT
--       - atendimento NAO esta cancelado
--     Retorna array das rows inseridas.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.attach_materials_to_appointment(
  p_appointment_id UUID,
  p_materials      JSONB,
  p_actor          UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id    UUID;
  v_jwt_tenant   UUID;
  v_inserted     JSONB;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();

  SELECT tenant_id INTO v_tenant_id
    FROM public.appointments
   WHERE id = p_appointment_id;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  -- Multi-tenant: se chamada do client (jwt presente), exige match.
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> v_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_NOT_FOUND', ERRCODE = '02000';
  END IF;

  -- Bloqueia anexacao a atendimento cancelado.
  IF EXISTS (
    SELECT 1 FROM public.appointment_reversals WHERE appointment_id = p_appointment_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'APPOINTMENT_REVERSED', ERRCODE = '23514';
  END IF;

  IF p_materials IS NULL OR jsonb_typeof(p_materials) <> 'array' OR jsonb_array_length(p_materials) = 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'MATERIALS_REQUIRED', ERRCODE = '22023';
  END IF;

  WITH inserted AS (
    INSERT INTO public.appointment_materials (
      tenant_id, appointment_id, tuss_code, tuss_description, quantity, created_by
    )
    SELECT
      v_tenant_id,
      p_appointment_id,
      (item->>'tuss_code')::text,
      (item->>'tuss_description')::text,
      COALESCE((item->>'quantity')::int, 1),
      p_actor
    FROM jsonb_array_elements(p_materials) AS item
    RETURNING id, tuss_code, tuss_description, quantity, created_at, created_by
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id',                id,
    'tuss_code',         tuss_code,
    'tuss_description',  tuss_description,
    'quantity',          quantity,
    'created_at',        created_at,
    'created_by',        created_by
  )) INTO v_inserted FROM inserted;

  RETURN jsonb_build_object(
    'appointment_id', p_appointment_id,
    'materials',      COALESCE(v_inserted, '[]'::jsonb)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.attach_materials_to_appointment(UUID, JSONB, UUID)
  TO authenticated;

-- =========================================================================
-- (h) RPC: create_appointment_with_materials
--     Cria appointment + N materiais em transacao implicita.
--     Mesmo padrao de create_step_with_appointment (0055): caller passa
--     todos os campos necessarios; funcao trusta caller (que ja passou
--     por requireRole + validacoes na app layer).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.create_appointment_with_materials(
  p_tenant_id              UUID,
  p_patient_id             UUID,
  p_doctor_id              UUID,
  p_procedure_id           UUID,
  p_plan_id                UUID,         -- NULL em particular
  p_source_price_version_id   UUID,      -- NULL em particular
  p_source_commission_history_id UUID,
  p_frozen_amount_cents    INTEGER,
  p_frozen_commission_bps  INTEGER,
  p_appointment_at         TIMESTAMPTZ,
  p_duration_minutes       INTEGER,      -- NULLABLE
  p_observacoes            TEXT,         -- NULLABLE
  p_source                 TEXT,         -- 'manual' usualmente
  p_actor                  UUID,
  p_materials              JSONB         -- array de {tuss_code, tuss_description, quantity}
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_appointment_id UUID;
  v_count          INTEGER := 0;
  v_jwt_tenant     UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();

  -- Multi-tenant: se chamada do client (jwt presente), exige match.
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
      tenant_id, appointment_id, tuss_code, tuss_description, quantity, created_by
    )
    SELECT
      p_tenant_id,
      v_appointment_id,
      (item->>'tuss_code')::text,
      (item->>'tuss_description')::text,
      COALESCE((item->>'quantity')::int, 1),
      p_actor
    FROM jsonb_array_elements(p_materials) AS item;

    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'appointment_id',   v_appointment_id,
    'materials_count',  v_count
  );
END $$;

GRANT EXECUTE ON FUNCTION public.create_appointment_with_materials(
  UUID, UUID, UUID, UUID, UUID, UUID, UUID, INTEGER, INTEGER,
  TIMESTAMPTZ, INTEGER, TEXT, TEXT, UUID, JSONB
) TO authenticated;

-- =========================================================================
-- Done.
-- =========================================================================
