-- =====================================================================
-- MIGRATIONS PENDENTES — branch 031-honorarios-participantes
-- Para colar no SQL Editor do Supabase (produção).
--
-- Ordem: 0127 (TISS lote payments) -> 0128 (participantes) -> 0129 (repasse).
-- Tudo idempotente (IF NOT EXISTS / CREATE OR REPLACE) — seguro re-rodar.
--
-- ATENCAO:
--  * Rodar via SQL Editor NAO registra em supabase_migrations.schema_migrations.
--    Um futuro `supabase db push` tentara reaplicar — como e idempotente, ok.
--    (Opcional: ver bloco comentado no fim para marcar como aplicado.)
--  * 0129 reescreve close_monthly_payout sobre a versao 0100. O branch
--    financeiro (0126) tambem reescreve essa funcao — a ultima aplicada vence.
--  * Executar dentro de uma transacao: o SQL Editor ja roda em transacao
--    unica por execucao; se algo falhar, nada e commitado.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 0127_tiss_lote_payments.sql
-- =====================================================================
-- 0127 — tiss_lote_payments: conciliação de recebimentos por lote TISS (US6).
--
-- Modela a "conta a receber da operadora" de forma TISS-nativa: cada lote
-- exportado representa um valor faturado (soma das guias); os recebimentos do
-- convênio (inclusive parciais por glosa) são lançados aqui (append-only).
-- Quando o recebido alcança o faturado, as guias do lote passam a `paga`.
--
-- DECISÃO (usuário, 2026-06-17): o repasse médico permanece sobre o valor
-- FATURADO (regra atual) — esta tabela NÃO altera close_monthly_payout nem a
-- comissão; é puramente financeira (entrada de caixa da operadora).
--
-- Numerada 0127 para não colidir com 0126 (branch de financeiro). Aditiva,
-- idempotente.

CREATE TABLE IF NOT EXISTS public.tiss_lote_payments (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lote_id            UUID        NOT NULL REFERENCES public.tiss_lotes(id) ON DELETE CASCADE,
  amount_cents       BIGINT      NOT NULL CHECK (amount_cents > 0),
  received_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  note               TEXT        NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS tiss_lote_payments_lote_idx
  ON public.tiss_lote_payments (tenant_id, lote_id);

-- Append-only puro (correção = nova linha; não há UPDATE/DELETE).
DROP TRIGGER IF EXISTS tiss_lote_payments_append_only ON public.tiss_lote_payments;
CREATE TRIGGER tiss_lote_payments_append_only
  BEFORE UPDATE OR DELETE ON public.tiss_lote_payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

ALTER TABLE public.tiss_lote_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiss_lote_payments_tenant_read ON public.tiss_lote_payments;
CREATE POLICY tiss_lote_payments_tenant_read ON public.tiss_lote_payments
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tiss_lote_payments_billing_write ON public.tiss_lote_payments;
CREATE POLICY tiss_lote_payments_billing_write ON public.tiss_lote_payments
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'));

COMMENT ON TABLE public.tiss_lote_payments IS
  'Feature 029 (US6) — recebimentos do convênio por lote TISS (append-only). Não afeta repasse: regra de comissão permanece sobre o valor faturado.';

NOTIFY pgrst, 'reload schema';


-- =====================================================================
-- 0128_procedure_participants.sql
-- =====================================================================
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


-- =====================================================================
-- 0129_payout_includes_participations.sql
-- =====================================================================
-- 0129 — Repasse mensal passa a somar os HONORÁRIOS de participação
-- (appointment_assistants) em `liberal_payment_cents` (feature 031, US2).
--
-- Contexto: a 0100 (última versão de close_monthly_payout) gravava
-- `liberal_payment_cents = 0` — os honorários de participantes NUNCA entravam
-- no repasse, apesar de a tabela existir desde a 0084. A feature 031
-- (decisão do usuário 2026-06-18) exige que o honorário de cada participação
-- entre no repasse do profissional participante, de QUALQUER modalidade
-- (liberal/fixo/comissionado), e saia quando o atendimento for estornado.
--
-- Mecanismo: agrega `appointment_assistants` ativos (removed_at IS NULL) cujo
-- atendimento esteja ATIVO no mês (via appointments_effective, que já exclui
-- estornados), por `assistant_doctor_id`, e grava em `liberal_payment_cents`.
-- O total (`total_due_cents`) é coluna GERADA = commission+fixed+liberal+adj,
-- então a soma flui automaticamente. Sem dupla contagem: o executante
-- principal não é participante (FR-015).
--
-- Idempotente — CREATE OR REPLACE. Mantém leitura de tenants.timezone (0100).

CREATE OR REPLACE FUNCTION public.close_monthly_payout(
  p_tenant_id UUID,
  p_month TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role TEXT;
  v_count INTEGER;
  v_total BIGINT;
  v_tz TEXT;
  v_from_iso TIMESTAMPTZ;
  v_to_iso TIMESTAMPTZ;
  v_year INT;
  v_month INT;
BEGIN
  v_role := public.jwt_role();

  IF v_role <> 'service_role' THEN
    IF v_role <> 'admin' OR public.jwt_tenant_id() <> p_tenant_id THEN
      RAISE EXCEPTION USING MESSAGE = 'forbidden', ERRCODE = '42501';
    END IF;
  END IF;

  IF p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION USING MESSAGE = 'invalid_month', ERRCODE = '22000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.monthly_payouts
     WHERE tenant_id = p_tenant_id AND month = p_month AND closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'already_closed', ERRCODE = '23505';
  END IF;

  SELECT COALESCE(timezone, 'America/Sao_Paulo') INTO v_tz
    FROM public.tenants WHERE id = p_tenant_id;
  IF v_tz IS NULL THEN v_tz := 'America/Sao_Paulo'; END IF;

  v_year := substring(p_month from 1 for 4)::INT;
  v_month := substring(p_month from 6 for 2)::INT;
  v_from_iso := ((p_month || '-01')::DATE)::TIMESTAMP AT TIME ZONE v_tz;
  v_to_iso := (CASE WHEN v_month = 12
                    THEN ((v_year + 1)::TEXT || '-01-01')::DATE
                    ELSE (v_year::TEXT || '-' || lpad((v_month + 1)::TEXT, 2, '0') || '-01')::DATE
               END)::TIMESTAMP AT TIME ZONE v_tz;

  WITH active_doctors AS (
    SELECT d.id AS doctor_id
      FROM public.doctors d
     WHERE d.tenant_id = p_tenant_id AND d.active = true
  ),
  appt_agg AS (
    SELECT ae.doctor_id,
           COALESCE(SUM(ae.frozen_amount_cents), 0) AS gross,
           COALESCE(SUM(ae.net_commission_cents), 0) AS commission
      FROM public.appointments_effective ae
     WHERE ae.tenant_id = p_tenant_id
       AND ae.effective_status = 'ativo'
       AND ae.appointment_at >= v_from_iso
       AND ae.appointment_at < v_to_iso
     GROUP BY ae.doctor_id
  ),
  -- Honorários de participação: por médico participante, atendimento ATIVO no
  -- mês (appointments_effective exclui estornados), participação não removida.
  assist_agg AS (
    SELECT aa.assistant_doctor_id AS doctor_id,
           COALESCE(SUM(aa.frozen_amount_cents), 0) AS liberal
      FROM public.appointment_assistants aa
      JOIN public.appointments_effective ae ON ae.id = aa.appointment_id
     WHERE aa.tenant_id = p_tenant_id
       AND aa.removed_at IS NULL
       AND ae.effective_status = 'ativo'
       AND ae.appointment_at >= v_from_iso
       AND ae.appointment_at < v_to_iso
     GROUP BY aa.assistant_doctor_id
  ),
  adj_agg AS (
    SELECT doctor_id, COALESCE(SUM(delta_cents), 0) AS adjustments
      FROM public.monthly_payouts_adjustments
     WHERE tenant_id = p_tenant_id AND applied_month = p_month
     GROUP BY doctor_id
  )
  INSERT INTO public.monthly_payouts (
    tenant_id, doctor_id, month,
    gross_revenue_cents, commission_cents,
    fixed_payment_cents, liberal_payment_cents, adjustments_cents
  )
  SELECT
    p_tenant_id,
    ad.doctor_id,
    p_month,
    COALESCE(aa.gross, 0),
    COALESCE(aa.commission, 0),
    0,
    COALESCE(asg.liberal, 0),
    COALESCE(adj.adjustments, 0)
    FROM active_doctors ad
    LEFT JOIN appt_agg aa  ON aa.doctor_id = ad.doctor_id
    LEFT JOIN assist_agg asg ON asg.doctor_id = ad.doctor_id
    LEFT JOIN adj_agg adj  ON adj.doctor_id = ad.doctor_id
   ON CONFLICT (tenant_id, doctor_id, month) DO NOTHING;

  UPDATE public.monthly_payouts
     SET closed_at = now(),
         closed_by = COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::UUID),
         updated_at = now()
   WHERE tenant_id = p_tenant_id AND month = p_month AND closed_at IS NULL;

  SELECT count(*), COALESCE(SUM(total_due_cents), 0)
    INTO v_count, v_total
    FROM public.monthly_payouts
   WHERE tenant_id = p_tenant_id AND month = p_month;

  PERFORM public.log_audit_event(
    p_tenant_id,
    'monthly_payouts',
    NULL,
    'closed',
    NULL,
    p_month,
    'count=' || v_count::TEXT || ';total_cents=' || v_total::TEXT
  );

  RETURN jsonb_build_object(
    'month', p_month,
    'payouts_count', v_count,
    'total_value_cents', v_total,
    'closed_at', now()
  );
END $$;

NOTIFY pgrst, 'reload schema';


COMMIT;

-- =====================================================================
-- OPCIONAL — marcar como aplicadas para o CLI nao reaplicar no db push.
-- Descomente se voce usa `supabase db push` no fluxo de deploy.
-- (A coluna `statements` pode ser NOT NULL em algumas versoes do CLI;
--  se der erro, remova-a do INSERT.)
-- =====================================================================
-- INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
--   ('0127','tiss_lote_payments'),
--   ('0128','procedure_participants'),
--   ('0129','payout_includes_participations')
-- ON CONFLICT (version) DO NOTHING;
