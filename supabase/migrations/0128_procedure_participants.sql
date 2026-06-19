-- 0128 — Participantes (equipe) por PROCEDIMENTO + honorário de qualquer
-- modalidade (feature 031).
--
-- ⚠️ DRAFT: escrita sem aplicação/teste local (shell indisponível na sessão).
-- APLICAR + TESTAR em dev (`pnpm supabase:reset` + suíte) ANTES de produção.
--
-- Estende a tabela append-only `appointment_assistants` (0084):
--   (a) acrescenta `procedure_id` (linha de procedimento) e
--       `participation_degree` (domínio TISS 35);
--   (b) relaxa a trava "só liberal" — qualquer médico ATIVO do tenant;
--   (c) unicidade passa a ser por (appointment, procedure, doctor) ativo;
--   (d) estende a RPC de anexar com os novos campos (params com DEFAULT,
--       mantendo compat com chamadas de 4 args).
--
-- Reuso: o repasse (aggregateLiberalByDoctor + close_monthly_payout/0126) já
-- soma esta tabela por médico → honorário de qualquer modalidade entra no
-- repasse sem novo código (FR-014). Append-only e auditoria preservados.
-- Aditiva e idempotente.

-- =========================================================================
-- 1) Colunas novas
-- =========================================================================
ALTER TABLE public.appointment_assistants
  ADD COLUMN IF NOT EXISTS procedure_id UUID NULL REFERENCES public.appointment_procedures(id),
  ADD COLUMN IF NOT EXISTS participation_degree TEXT NULL;

CREATE INDEX IF NOT EXISTS appointment_assistants_procedure_idx
  ON public.appointment_assistants (procedure_id) WHERE removed_at IS NULL;

-- =========================================================================
-- 2) Unicidade: mesmo médico pode participar de procedimentos diferentes
-- =========================================================================
DROP INDEX IF EXISTS public.appointment_assistants_no_duplicate_active_idx;
-- NULLS NOT DISTINCT (PG15+): preserva a dedup do caminho legado (procedure_id
-- NULL = nível de atendimento). Sem isso, dois registros (appointment, NULL,
-- doctor) seriam permitidos pois NULL <> NULL — regredindo a trava da 0084.
CREATE UNIQUE INDEX IF NOT EXISTS appointment_assistants_no_dup_proc_active_idx
  ON public.appointment_assistants (appointment_id, procedure_id, assistant_doctor_id)
  NULLS NOT DISTINCT
  WHERE removed_at IS NULL;

-- =========================================================================
-- 3) Trigger 3 (liberal-only) RELAXADO → qualquer médico ATIVO do tenant
--    (mantém o nome da função/trigger para não rebobinar o wiring).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_assistant_doctor_is_liberal()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_active BOOLEAN;
BEGIN
  SELECT active INTO v_active FROM public.doctors WHERE id = NEW.assistant_doctor_id;
  IF v_active IS NULL THEN
    RAISE EXCEPTION 'ASSISTANT_DOCTOR_NOT_FOUND: %', NEW.assistant_doctor_id USING ERRCODE = '23503';
  END IF;
  IF v_active <> true THEN
    RAISE EXCEPTION 'ASSISTANT_DOCTOR_INACTIVE: doctor % is not active', NEW.assistant_doctor_id
      USING ERRCODE = '42501';
  END IF;
  -- Feature 031: participante pode ser de qualquer payment_mode (não só liberal).
  RETURN NEW;
END $$;

-- =========================================================================
-- 4) Mutation guard: procedure_id e participation_degree imutáveis pós-INSERT
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_appointment_assistants_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'appointment_assistants: append-only. DELETE not permitted.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.id <> OLD.id
     OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.appointment_id <> OLD.appointment_id
     OR NEW.assistant_doctor_id <> OLD.assistant_doctor_id
     OR NEW.frozen_amount_cents <> OLD.frozen_amount_cents
     OR NEW.created_by <> OLD.created_by
     OR NEW.created_at <> OLD.created_at
     OR COALESCE(NEW.procedure_id::text, '') <> COALESCE(OLD.procedure_id::text, '')
     OR COALESCE(NEW.participation_degree, '') <> COALESCE(OLD.participation_degree, '') THEN
    RAISE EXCEPTION 'appointment_assistants: core columns immutable.'
      USING ERRCODE = '42501';
  END IF;
  IF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'appointment_assistants: already removed (id=%).', OLD.id
      USING ERRCODE = '42501';
  END IF;
  IF NEW.removed_at IS NULL OR NEW.removed_by IS NULL THEN
    RAISE EXCEPTION 'appointment_assistants: UPDATE must set both removed_at and removed_by.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

-- =========================================================================
-- 5) Tenant consistency: procedure_id (quando presente) pertence ao
--    appointment e ao tenant.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.check_assistant_tenant_consistency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_appt_tenant   UUID;
  v_doctor_tenant UUID;
  v_proc_appt     UUID;
  v_proc_tenant   UUID;
BEGIN
  SELECT tenant_id INTO v_appt_tenant   FROM public.appointments WHERE id = NEW.appointment_id;
  IF v_appt_tenant IS NULL THEN
    RAISE EXCEPTION 'appointment_assistants: appointment % nao encontrado.', NEW.appointment_id
      USING ERRCODE = '23503';
  END IF;
  SELECT tenant_id INTO v_doctor_tenant FROM public.doctors      WHERE id = NEW.assistant_doctor_id;
  IF v_doctor_tenant IS NULL THEN
    RAISE EXCEPTION 'appointment_assistants: doctor % nao encontrado.', NEW.assistant_doctor_id
      USING ERRCODE = '23503';
  END IF;
  IF NEW.tenant_id <> v_appt_tenant OR NEW.tenant_id <> v_doctor_tenant THEN
    RAISE EXCEPTION 'ASSISTANT_TENANT_MISMATCH: assistant.tenant_id=% appointment.tenant_id=% doctor.tenant_id=%',
      NEW.tenant_id, v_appt_tenant, v_doctor_tenant
      USING ERRCODE = '42501';
  END IF;
  IF NEW.procedure_id IS NOT NULL THEN
    SELECT appointment_id, tenant_id INTO v_proc_appt, v_proc_tenant
      FROM public.appointment_procedures WHERE id = NEW.procedure_id;
    IF v_proc_appt IS NULL THEN
      RAISE EXCEPTION 'appointment_assistants: procedure % nao encontrado.', NEW.procedure_id
        USING ERRCODE = '23503';
    END IF;
    IF v_proc_appt <> NEW.appointment_id OR v_proc_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'ASSISTANT_PROCEDURE_MISMATCH: procedure % nao pertence ao appointment/tenant.', NEW.procedure_id
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- =========================================================================
-- 6) RPC de anexar — estendida com procedure_id + participation_degree.
--    Params novos com DEFAULT NULL preservam chamadas de 4 args.
-- =========================================================================
DROP FUNCTION IF EXISTS public.attach_assistant_to_appointment(UUID, UUID, BIGINT, UUID);
CREATE OR REPLACE FUNCTION public.attach_assistant_to_appointment(
  p_appointment_id      UUID,
  p_assistant_doctor_id UUID,
  p_amount_cents        BIGINT,
  p_actor               UUID,
  p_procedure_id        UUID DEFAULT NULL,
  p_participation_degree TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id  UUID;
  v_jwt_tenant UUID;
  v_jwt_role   TEXT;
  v_new_id     UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();
  v_jwt_role   := public.jwt_role();

  SELECT tenant_id INTO v_tenant_id FROM public.appointments WHERE id = p_appointment_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_NOT_FOUND', ERRCODE='02000';
  END IF;
  IF v_jwt_role <> 'service_role' AND (v_jwt_tenant IS NULL OR v_jwt_tenant <> v_tenant_id) THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_NOT_FOUND', ERRCODE='02000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.appointment_reversals WHERE appointment_id = p_appointment_id) THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_REVERSED', ERRCODE='23514';
  END IF;

  INSERT INTO public.appointment_assistants (
    tenant_id, appointment_id, assistant_doctor_id, frozen_amount_cents, created_by,
    procedure_id, participation_degree
  ) VALUES (
    v_tenant_id, p_appointment_id, p_assistant_doctor_id, p_amount_cents, p_actor,
    p_procedure_id, p_participation_degree
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;

-- A nova assinatura (6 args) precisa de GRANT explícito — o DROP da versão de
-- 4 args descartou o GRANT antigo. Chamadas de 4 args resolvem nesta via DEFAULT.
GRANT EXECUTE ON FUNCTION public.attach_assistant_to_appointment(UUID, UUID, BIGINT, UUID, UUID, TEXT)
  TO authenticated, service_role;

-- =========================================================================
-- 7) Audit em INSERT passa a registrar procedure_id + participation_degree
--    (FR-008 / US4). Mantém o comportamento de remoção da 0084.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.audit_appointment_assistant_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'appointment_assistants',
      NEW.id,
      'added',
      NULL,
      json_build_object(
        'appointment_id',       NEW.appointment_id,
        'assistant_doctor_id',  NEW.assistant_doctor_id,
        'frozen_amount_cents',  NEW.frozen_amount_cents,
        'procedure_id',         NEW.procedure_id,
        'participation_degree', NEW.participation_degree,
        'created_by',           NEW.created_by
      )::text,
      'feature 031 — participante adicionado ao procedimento'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id,
      'appointment_assistants',
      NEW.id,
      'removed',
      NULL,
      json_build_object(
        'removed_at', NEW.removed_at,
        'removed_by', NEW.removed_by
      )::text,
      'feature 031 — participante removido (soft-unlink)'
    );
  END IF;
  RETURN NEW;
END $$;

COMMENT ON COLUMN public.appointment_assistants.procedure_id IS
  'Feature 031 — linha de appointment_procedures à qual a participação pertence (NULL = nível de atendimento, legado).';
COMMENT ON COLUMN public.appointment_assistants.participation_degree IS
  'Feature 031 — código do grau de participação (domínio TISS 35). Validado na camada de aplicação.';

NOTIFY pgrst, 'reload schema';
