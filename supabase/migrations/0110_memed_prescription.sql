-- 0110 — Feature 026: Integração Memed — Prescrição Digital.
-- (Renumerada de 0108 por colisão com 0108_audit_public_booking_security_definer
--  e 0109_support_tickets já presentes no master/produção.)
--
-- Cria as 3 tabelas que sustentam a prescrição digital via Memed:
--   1. tenant_memed_config   — conexão Memed por clínica (par de chaves cifrado)
--   2. memed_prescribers     — vínculo profissional ↔ prescritor Memed (1:1 por tenant)
--   3. prescription_records  — registro auditável de prescrições (append-only)
--
-- Constituição:
--   - I  (imutabilidade): prescription_records é append-only; trigger anti-delete
--        e anti-update fora do path 'issued' → 'deleted'.
--   - II (audit): ações (memed.connect/disconnect, prescriber.enable,
--        prescription.issued/deleted) são logadas pela camada de aplicação via
--        log_audit_event (contexto de ip/ua/actor por request).
--   - III (multi-tenant): RLS por tenant_id; UNIQUEs compostas carregam tenant_id.
--   - V  (RBAC): writes adicionalmente gated por jwt_role() nas policies.
--
-- Segredos: api_key_enc / secret_key_enc são BYTEA cifrados via
-- enc_text_with_key(..., PATIENT_DATA_ENCRYPTION_KEY). Nenhuma rota retorna
-- esses campos ao browser — leitura/decifra acontece server-side.
--
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

-- =========================================================================
-- 1. tenant_memed_config — conexão Memed por clínica (1 linha por tenant)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_memed_config (
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  environment        TEXT        NOT NULL DEFAULT 'staging'
                       CHECK (environment IN ('staging', 'production')),
  api_key_enc        BYTEA       NOT NULL,
  secret_key_enc     BYTEA       NOT NULL,
  connected          BOOLEAN     NOT NULL DEFAULT TRUE,
  terms_accepted_at  TIMESTAMPTZ NULL,
  terms_accepted_by  UUID        NULL REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id),
  PRIMARY KEY (tenant_id),
  -- Invariante FR-024: produção exige aceite do termo de responsabilidade.
  CONSTRAINT memed_production_requires_terms
    CHECK (environment <> 'production' OR terms_accepted_at IS NOT NULL)
);

DROP TRIGGER IF EXISTS tenant_memed_config_touch_updated_at ON public.tenant_memed_config;
CREATE TRIGGER tenant_memed_config_touch_updated_at
  BEFORE UPDATE ON public.tenant_memed_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_memed_config ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer usuário autenticado do tenant (a UI precisa saber se a
-- clínica oferece prescrição). Os campos *_enc nunca são selecionados pelas
-- rotas que respondem ao browser.
DROP POLICY IF EXISTS tenant_memed_config_tenant_read ON public.tenant_memed_config;
CREATE POLICY tenant_memed_config_tenant_read ON public.tenant_memed_config
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

-- Escrita: admin do tenant (requireRole na rota é a 1ª camada; RLS é a 2ª).
DROP POLICY IF EXISTS tenant_memed_config_admin_write ON public.tenant_memed_config;
CREATE POLICY tenant_memed_config_admin_write ON public.tenant_memed_config
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

COMMENT ON TABLE public.tenant_memed_config IS
  'Feature 026 — conexão Memed por clínica (1 linha/tenant). api_key_enc/secret_key_enc cifrados via enc_text_with_key(PATIENT_DATA_ENCRYPTION_KEY); nunca retornados ao browser. connected=FALSE desconecta mantendo histórico de aceite.';

-- =========================================================================
-- 2. memed_prescribers — vínculo profissional ↔ prescritor Memed (1:1/tenant)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.memed_prescribers (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doctor_id          UUID        NOT NULL REFERENCES public.doctors(id) ON DELETE CASCADE,
  external_id        UUID        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'registered', 'error')),
  memed_specialty_id TEXT        NULL,
  last_error         TEXT        NULL,
  last_synced_at     TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id),
  UNIQUE (tenant_id, doctor_id)
);

CREATE INDEX IF NOT EXISTS memed_prescribers_tenant_idx
  ON public.memed_prescribers (tenant_id);

DROP TRIGGER IF EXISTS memed_prescribers_touch_updated_at ON public.memed_prescribers;
CREATE TRIGGER memed_prescribers_touch_updated_at
  BEFORE UPDATE ON public.memed_prescribers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.memed_prescribers ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer papel autenticado do tenant (a UI mostra se o profissional
-- está apto a prescrever).
DROP POLICY IF EXISTS memed_prescribers_tenant_read ON public.memed_prescribers;
CREATE POLICY memed_prescribers_tenant_read ON public.memed_prescribers
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

-- Escrita: admin do tenant.
DROP POLICY IF EXISTS memed_prescribers_admin_write ON public.memed_prescribers;
CREATE POLICY memed_prescribers_admin_write ON public.memed_prescribers
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

COMMENT ON TABLE public.memed_prescribers IS
  'Feature 026 — vínculo 1:1 doctor↔prescritor Memed por tenant. external_id = doctor_id (decisão D3). status: pending→registered (POST/GET /usuarios) | →error (falha) | error→registered (retry).';

-- =========================================================================
-- 3. prescription_records — registro auditável de prescrições (append-only)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.prescription_records (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  appointment_id        UUID        NULL REFERENCES public.appointments(id) ON DELETE SET NULL,
  patient_id            UUID        NOT NULL REFERENCES public.patients(id),
  doctor_id             UUID        NOT NULL REFERENCES public.doctors(id),
  memed_prescription_id TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'issued'
                          CHECK (status IN ('issued', 'deleted')),
  issued_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id    UUID        NOT NULL REFERENCES auth.users(id),
  -- Idempotência do registro de emissão (evento prescricaoImpressa).
  UNIQUE (tenant_id, memed_prescription_id)
);

CREATE INDEX IF NOT EXISTS prescription_records_tenant_issued_idx
  ON public.prescription_records (tenant_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS prescription_records_appointment_idx
  ON public.prescription_records (appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS prescription_records_patient_idx
  ON public.prescription_records (tenant_id, patient_id);

ALTER TABLE public.prescription_records ENABLE ROW LEVEL SECURITY;

-- Leitura: qualquer papel autenticado do tenant (prontuário/atendimento
-- indicam prescrições emitidas).
DROP POLICY IF EXISTS prescription_records_tenant_read ON public.prescription_records;
CREATE POLICY prescription_records_tenant_read ON public.prescription_records
  FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

-- Escrita: profissional_saude ou admin do tenant (emitir/marcar deletado).
DROP POLICY IF EXISTS prescription_records_clinical_insert ON public.prescription_records;
CREATE POLICY prescription_records_clinical_insert ON public.prescription_records
  FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

DROP POLICY IF EXISTS prescription_records_clinical_update ON public.prescription_records;
CREATE POLICY prescription_records_clinical_update ON public.prescription_records
  FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin', 'profissional_saude')
  );

-- Imutabilidade (Princípio I): proibido apagar.
CREATE OR REPLACE FUNCTION public.prescription_records_block_delete()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    MESSAGE = 'DELETE not allowed on append-only table prescription_records',
    ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS prescription_records_no_delete ON public.prescription_records;
CREATE TRIGGER prescription_records_no_delete
  BEFORE DELETE ON public.prescription_records
  FOR EACH STATEMENT EXECUTE FUNCTION public.prescription_records_block_delete();

-- Imutabilidade (Princípio I): única transição de UPDATE permitida é
-- status 'issued' → 'deleted' com deleted_at indo de NULL para timestamp.
-- Qualquer outra mudança de coluna é rejeitada.
CREATE OR REPLACE FUNCTION public.prescription_records_enforce_immutability()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'issued'
     AND NEW.status = 'deleted'
     AND OLD.deleted_at IS NULL
     AND NEW.deleted_at IS NOT NULL
     -- nenhuma outra coluna pode mudar
     AND NEW.id                    IS NOT DISTINCT FROM OLD.id
     AND NEW.tenant_id             IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.appointment_id        IS NOT DISTINCT FROM OLD.appointment_id
     AND NEW.patient_id            IS NOT DISTINCT FROM OLD.patient_id
     AND NEW.doctor_id             IS NOT DISTINCT FROM OLD.doctor_id
     AND NEW.memed_prescription_id IS NOT DISTINCT FROM OLD.memed_prescription_id
     AND NEW.issued_at             IS NOT DISTINCT FROM OLD.issued_at
     AND NEW.created_at            IS NOT DISTINCT FROM OLD.created_at
     AND NEW.created_by_user_id    IS NOT DISTINCT FROM OLD.created_by_user_id
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING
    MESSAGE = 'prescription_records is append-only: only the issued→deleted transition (setting deleted_at) is allowed',
    ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS prescription_records_immutability ON public.prescription_records;
CREATE TRIGGER prescription_records_immutability
  BEFORE UPDATE ON public.prescription_records
  FOR EACH ROW EXECUTE FUNCTION public.prescription_records_enforce_immutability();

COMMENT ON TABLE public.prescription_records IS
  'Feature 026 — append-only. 1 linha por prescrição emitida. NÃO armazena conteúdo clínico (só metadados de rastreabilidade — LGPD/minimização). Exclusão = transição issued→deleted (deleted_at), nunca DELETE físico.';

-- =========================================================================
-- 4. test_truncate_all_mutable — incluir as 3 tabelas novas na limpeza
-- =========================================================================

CREATE OR REPLACE FUNCTION public.test_truncate_all_mutable(wipe_catalog BOOLEAN DEFAULT FALSE)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- TRUNCATE bypassa BEFORE DELETE/UPDATE triggers per-row; mantemos o disable
  -- explícito de integration_sync_log por consistência com a versão anterior.
  ALTER TABLE public.integration_sync_log DISABLE TRIGGER integration_sync_log_no_update;

  TRUNCATE
    public.prescription_records,
    public.memed_prescribers,
    public.tenant_memed_config,
    public.integration_sync_log,
    public.audit_log,
    public.alert_status_transitions,
    public.alerts,
    public.webhook_event_transitions,
    public.raw_webhook_events,
    public.appointment_reversals,
    public.appointments,
    public.price_versions,
    public.doctor_commission_history,
    public.doctors,
    public.patients,
    public.procedures,
    public.health_plans,
    public.tenant_integrations,
    public.tenant_ghl_config,
    public.user_tenants,
    public.tenants
  RESTART IDENTITY CASCADE;

  ALTER TABLE public.integration_sync_log ENABLE TRIGGER integration_sync_log_no_update;

  IF wipe_catalog THEN
    TRUNCATE public.tuss_codes, public.tuss_catalog_versions RESTART IDENTITY CASCADE;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.test_truncate_all_mutable(BOOLEAN) TO service_role;
