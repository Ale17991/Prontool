-- 0112 — Feature 029: Faturamento TISS de convênios.
--
-- Cria o schema do módulo de faturamento de convênios no Padrão TISS 04.03.00:
--   1. tenant_tiss_operator_config  — config TISS por operadora (1:1 health_plan)
--   2. tenant_tiss_certificates     — certificado ICP-Brasil A1 (.pfx) cifrado, por tenant
--   3. patient_health_plan_cards    — carteira do beneficiário por operadora (cifrada)
--   4. ALTER doctors ADD cbo        — CBO do profissional (domínio 24)
--   5. tiss_domain_tables           — catálogo de domínios TISS (38/87/26/24/59/52/...)
--   6. tiss_guias                   — guia gerada (append-only; valor congelado)
--   7. tiss_guia_procedures         — linhas de procedimento da guia (imutáveis)
--   8. tiss_lotes                   — lote de guias (append-only; XML assinado persistido)
--   9. tiss_glosas                  — glosas registradas (append-only)
--
-- Constituição:
--   - I  (imutabilidade): tiss_guias/lotes/glosas/guia_procedures são append-only via
--        enforce_append_only_columns (whitelist de transições de status). Valor da guia
--        é congelado de appointments_effective.net_amount_cents (centavos).
--   - II (audit): mutações são logadas pela camada de aplicação via log_audit_event
--        (padrão da feature 026/Memed — contexto ip/ua/actor por request).
--   - III (multi-tenant): RLS por jwt_tenant_id() em todas as tabelas com tenant_id;
--        UNIQUEs compostas carregam tenant_id; PKs UUID. tiss_domain_tables é dado
--        oficial global (sem tenant_id), leitura para autenticados.
--   - IV (TUSS/ANS): trigger de coerência garante par tuss_table+procedure_code e
--        sinaliza código TUSS fora de vigência (valid_to no passado).
--   - V  (RBAC): config/certificado = admin; guia/lote/glosa = admin|financeiro.
--
-- Segredos: pfx_enc/password_enc/card_number_enc são BYTEA cifrados via
-- enc_text_with_key(..., PATIENT_DATA_ENCRYPTION_KEY). Nenhuma rota retorna esses
-- campos ao browser — leitura/decifra acontece server-side.
--
-- Limpeza em testes: todas as tabelas tenant-scoped referenciam tenants
-- ON DELETE CASCADE; test_truncate_all_mutable() termina em TRUNCATE ... tenants
-- CASCADE, que já as alcança (não é necessário redefini-la). tiss_domain_tables é
-- seed estático (não truncado).
--
-- Domínios (valores): a ESTRUTURA é criada aqui; os VALORES oficiais são populados
-- pelo seed dedicado `scripts/seed-tiss-domains.ts` (a partir do arquivo de tabelas
-- de domínio da ANS) — evita transcrição manual sujeita a erro de conformidade.
--
-- Reversibilidade: aditiva, idempotente. supabase:reset recria.

-- =========================================================================
-- 1. tenant_tiss_operator_config — config TISS por operadora (1:1 health_plan)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_tiss_operator_config (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  health_plan_id     UUID        NOT NULL REFERENCES public.health_plans(id) ON DELETE CASCADE,
  ans_registration   TEXT        NOT NULL,
  tiss_version       TEXT        NOT NULL DEFAULT '04.03.00',
  contracted_code    TEXT        NOT NULL,
  contracted_cnpj    TEXT        NOT NULL,
  contracted_cnes    TEXT        NULL,
  procedure_table_map JSONB      NOT NULL DEFAULT '{}'::jsonb,
  active             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id),
  UNIQUE (tenant_id, health_plan_id)
);

CREATE INDEX IF NOT EXISTS tenant_tiss_operator_config_tenant_idx
  ON public.tenant_tiss_operator_config (tenant_id);

DROP TRIGGER IF EXISTS tenant_tiss_operator_config_touch_updated_at ON public.tenant_tiss_operator_config;
CREATE TRIGGER tenant_tiss_operator_config_touch_updated_at
  BEFORE UPDATE ON public.tenant_tiss_operator_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_tiss_operator_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_tiss_operator_config_tenant_read ON public.tenant_tiss_operator_config;
CREATE POLICY tenant_tiss_operator_config_tenant_read ON public.tenant_tiss_operator_config
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tenant_tiss_operator_config_admin_write ON public.tenant_tiss_operator_config;
CREATE POLICY tenant_tiss_operator_config_admin_write ON public.tenant_tiss_operator_config
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

COMMENT ON TABLE public.tenant_tiss_operator_config IS
  'Feature 029 — config TISS por operadora (1:1 health_plan). Registro ANS + código do contratado + CNPJ/CNES + mapeamentos. Habilita o convênio para faturamento TISS.';

-- =========================================================================
-- 2. tenant_tiss_certificates — certificado ICP-Brasil A1 (.pfx) cifrado
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tenant_tiss_certificates (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pfx_enc            BYTEA       NOT NULL,
  password_enc       BYTEA       NOT NULL,
  subject_cn         TEXT        NOT NULL,
  not_after          TIMESTAMPTZ NOT NULL,
  active             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id)
);

-- No máximo 1 certificado ativo por tenant.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_tiss_certificates_one_active
  ON public.tenant_tiss_certificates (tenant_id) WHERE active;

DROP TRIGGER IF EXISTS tenant_tiss_certificates_touch_updated_at ON public.tenant_tiss_certificates;
CREATE TRIGGER tenant_tiss_certificates_touch_updated_at
  BEFORE UPDATE ON public.tenant_tiss_certificates
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.tenant_tiss_certificates ENABLE ROW LEVEL SECURITY;

-- Certificado é segredo: leitura e escrita só admin (CN/validade exibidos; pfx/senha
-- nunca retornados ao browser).
DROP POLICY IF EXISTS tenant_tiss_certificates_admin_read ON public.tenant_tiss_certificates;
CREATE POLICY tenant_tiss_certificates_admin_read ON public.tenant_tiss_certificates
  FOR SELECT USING (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

DROP POLICY IF EXISTS tenant_tiss_certificates_admin_write ON public.tenant_tiss_certificates;
CREATE POLICY tenant_tiss_certificates_admin_write ON public.tenant_tiss_certificates
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin')
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() = 'admin');

COMMENT ON TABLE public.tenant_tiss_certificates IS
  'Feature 029 — certificado ICP-Brasil A1 (.pfx) por tenant, cifrado (pfx_enc/password_enc via enc_text_with_key). 1 ativo por tenant. Usado para assinar o XML do lote (XMLDSig). Nunca retornado ao browser.';

-- =========================================================================
-- 3. patient_health_plan_cards — carteira do beneficiário por operadora
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.patient_health_plan_cards (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id         UUID        NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  health_plan_id     UUID        NOT NULL REFERENCES public.health_plans(id) ON DELETE CASCADE,
  card_number_enc    BYTEA       NOT NULL,
  card_valid_until   DATE        NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id),
  UNIQUE (tenant_id, patient_id, health_plan_id)
);

CREATE INDEX IF NOT EXISTS patient_health_plan_cards_patient_idx
  ON public.patient_health_plan_cards (tenant_id, patient_id);

DROP TRIGGER IF EXISTS patient_health_plan_cards_touch_updated_at ON public.patient_health_plan_cards;
CREATE TRIGGER patient_health_plan_cards_touch_updated_at
  BEFORE UPDATE ON public.patient_health_plan_cards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.patient_health_plan_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS patient_health_plan_cards_tenant_read ON public.patient_health_plan_cards;
CREATE POLICY patient_health_plan_cards_tenant_read ON public.patient_health_plan_cards
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

-- Captura da carteira: admin, financeiro ou recepcionista (cadastro do paciente).
DROP POLICY IF EXISTS patient_health_plan_cards_write ON public.patient_health_plan_cards;
CREATE POLICY patient_health_plan_cards_write ON public.patient_health_plan_cards
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro','recepcionista'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro','recepcionista'));

COMMENT ON TABLE public.patient_health_plan_cards IS
  'Feature 029 — carteira do beneficiário por operadora (1 paciente × N convênios). card_number_enc cifrado. Campo obrigatório da guia TISS (nº da carteira).';

-- =========================================================================
-- 4. doctors.cbo — CBO do profissional (domínio 24)
-- =========================================================================

ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS cbo TEXT NULL;
COMMENT ON COLUMN public.doctors.cbo IS
  'Feature 029 — Código na Classificação Brasileira de Ocupações (domínio TISS nº 24). Obrigatório na guia TISS.';

-- =========================================================================
-- 5. tiss_domain_tables — catálogo de domínios TISS (estrutura; valores via seed)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tiss_domain_tables (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_number TEXT NOT NULL,
  code          TEXT NOT NULL,
  description   TEXT NOT NULL,
  valid_from    DATE NOT NULL DEFAULT '2000-01-01',
  valid_to      DATE NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain_number, code, valid_from)
);

CREATE INDEX IF NOT EXISTS tiss_domain_tables_lookup_idx
  ON public.tiss_domain_tables (domain_number, code);

ALTER TABLE public.tiss_domain_tables ENABLE ROW LEVEL SECURITY;

-- Domínio é dado oficial global: leitura para qualquer autenticado.
DROP POLICY IF EXISTS tiss_domain_tables_read ON public.tiss_domain_tables;
CREATE POLICY tiss_domain_tables_read ON public.tiss_domain_tables
  FOR SELECT USING (true);

-- Sem policy de escrita: apenas service_role (seed/migration) escreve. Append-only.
DROP TRIGGER IF EXISTS tiss_domain_tables_append_only ON public.tiss_domain_tables;
CREATE TRIGGER tiss_domain_tables_append_only
  BEFORE UPDATE OR DELETE ON public.tiss_domain_tables
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('valid_to');

COMMENT ON TABLE public.tiss_domain_tables IS
  'Feature 029 — catálogo de tabelas de domínio TISS (38 glosas, 87 tabela-de-tabelas, 26 conselho, 24 CBO, 59 UF, 52 tipo consulta, 36 indicação acidente, 48 técnica, 50 tipo atendimento, 23 caráter, 76 regime, 35 grau participação). Valores populados via scripts/seed-tiss-domains.ts (arquivo oficial ANS).';

-- =========================================================================
-- 6. tiss_guias — guia gerada (append-only; valor congelado)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tiss_guias (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  health_plan_id           UUID        NOT NULL REFERENCES public.health_plans(id),
  appointment_id           UUID        NOT NULL REFERENCES public.appointments(id),
  guia_type                TEXT        NOT NULL CHECK (guia_type IN ('consulta','sp_sadt')),
  guia_number_prestador    TEXT        NOT NULL,
  beneficiary_snapshot_enc BYTEA       NOT NULL,
  executante_snapshot      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  frozen_amount_cents      BIGINT      NOT NULL,
  tiss_version             TEXT        NOT NULL DEFAULT '04.03.00',
  tuss_catalog_version_id  UUID        NULL REFERENCES public.tuss_catalog_versions(id),
  status                   TEXT        NOT NULL DEFAULT 'rascunho'
                             CHECK (status IN ('rascunho','pronta','exportada','paga','glosada','parcial')),
  validation_errors        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  lote_id                  UUID        NULL,  -- FK adicionada após tiss_lotes
  supersedes_guia_id       UUID        NULL REFERENCES public.tiss_guias(id),
  exported_at              TIMESTAMPTZ NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id       UUID        NOT NULL REFERENCES auth.users(id),
  UNIQUE (tenant_id, guia_number_prestador)
);

CREATE INDEX IF NOT EXISTS tiss_guias_tenant_status_idx
  ON public.tiss_guias (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS tiss_guias_appointment_idx
  ON public.tiss_guias (appointment_id);
CREATE INDEX IF NOT EXISTS tiss_guias_lote_idx
  ON public.tiss_guias (lote_id) WHERE lote_id IS NOT NULL;

DROP TRIGGER IF EXISTS tiss_guias_touch_updated_at ON public.tiss_guias;
CREATE TRIGGER tiss_guias_touch_updated_at
  BEFORE UPDATE ON public.tiss_guias
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Append-only: apenas status/validation_errors/lote_id/exported_at podem mudar.
DROP TRIGGER IF EXISTS tiss_guias_append_only ON public.tiss_guias;
CREATE TRIGGER tiss_guias_append_only
  BEFORE UPDATE OR DELETE ON public.tiss_guias
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('status,validation_errors,lote_id,exported_at');

ALTER TABLE public.tiss_guias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiss_guias_tenant_read ON public.tiss_guias;
CREATE POLICY tiss_guias_tenant_read ON public.tiss_guias
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tiss_guias_billing_write ON public.tiss_guias;
CREATE POLICY tiss_guias_billing_write ON public.tiss_guias
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'));

COMMENT ON TABLE public.tiss_guias IS
  'Feature 029 — guia TISS (Consulta/SP-SADT) gerada de um atendimento. Append-only; valor congelado de appointments_effective. Exclusão lógica via status; reapresentação via supersedes_guia_id.';

-- =========================================================================
-- 7. tiss_guia_procedures — linhas de procedimento (imutáveis)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tiss_guia_procedures (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID    NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guia_id            UUID    NOT NULL REFERENCES public.tiss_guias(id) ON DELETE CASCADE,
  sequence           INT     NOT NULL,
  tuss_table         TEXT    NOT NULL,
  procedure_code     TEXT    NOT NULL,
  description        TEXT    NOT NULL,
  quantity           INT     NOT NULL DEFAULT 1 CHECK (quantity >= 1),
  via                TEXT    NULL,
  tecnica            TEXT    NULL,
  unit_amount_cents  BIGINT  NOT NULL CHECK (unit_amount_cents >= 0),
  total_amount_cents BIGINT  NOT NULL CHECK (total_amount_cents >= 0),
  tuss_code_id       UUID    NULL REFERENCES public.tuss_codes(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (guia_id, sequence)
);

CREATE INDEX IF NOT EXISTS tiss_guia_procedures_guia_idx
  ON public.tiss_guia_procedures (guia_id);

-- Totalmente imutável (insert-only).
DROP TRIGGER IF EXISTS tiss_guia_procedures_append_only ON public.tiss_guia_procedures;
CREATE TRIGGER tiss_guia_procedures_append_only
  BEFORE UPDATE OR DELETE ON public.tiss_guia_procedures
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

-- Coerência (Princípio IV): par tuss_table+procedure_code obrigatório; se houver
-- vínculo ao catálogo, o código TUSS não pode estar fora de vigência.
CREATE OR REPLACE FUNCTION public.tiss_guia_proc_check_coerencia()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_valid_to DATE;
BEGIN
  IF NEW.tuss_table IS NULL OR length(trim(NEW.tuss_table)) = 0
     OR NEW.procedure_code IS NULL OR length(trim(NEW.procedure_code)) = 0 THEN
    RAISE EXCEPTION USING
      MESSAGE = 'tiss_guia_procedures: par (tuss_table, procedure_code) é obrigatório (procedimento nunca é texto livre)',
      ERRCODE = '23514';
  END IF;
  IF NEW.tuss_code_id IS NOT NULL THEN
    SELECT valid_to INTO v_valid_to FROM public.tuss_codes WHERE id = NEW.tuss_code_id;
    IF v_valid_to IS NOT NULL AND v_valid_to < CURRENT_DATE THEN
      RAISE EXCEPTION USING
        MESSAGE = format('tiss_guia_procedures: código TUSS %s fora de vigência (valid_to=%s)', NEW.procedure_code, v_valid_to),
        ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tiss_guia_procedures_coerencia ON public.tiss_guia_procedures;
CREATE TRIGGER tiss_guia_procedures_coerencia
  BEFORE INSERT ON public.tiss_guia_procedures
  FOR EACH ROW EXECUTE FUNCTION public.tiss_guia_proc_check_coerencia();

ALTER TABLE public.tiss_guia_procedures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiss_guia_procedures_tenant_read ON public.tiss_guia_procedures;
CREATE POLICY tiss_guia_procedures_tenant_read ON public.tiss_guia_procedures
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tiss_guia_procedures_billing_insert ON public.tiss_guia_procedures;
CREATE POLICY tiss_guia_procedures_billing_insert ON public.tiss_guia_procedures
  FOR INSERT
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'));

COMMENT ON TABLE public.tiss_guia_procedures IS
  'Feature 029 — linhas de procedimento da guia (imutáveis). Par tuss_table(dom.87)+procedure_code obrigatório; Via/Técnica(dom.48) para SP/SADT; valores em centavos.';

-- =========================================================================
-- 8. tiss_lotes — lote de guias (append-only; XML assinado persistido)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tiss_lotes (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  health_plan_id     UUID        NOT NULL REFERENCES public.health_plans(id),
  lote_number        TEXT        NOT NULL,
  tiss_version       TEXT        NOT NULL DEFAULT '04.03.00',
  status             TEXT        NOT NULL DEFAULT 'aberto'
                       CHECK (status IN ('aberto','fechado','exportado')),
  xml_content        TEXT        NULL,
  xml_hash_md5       TEXT        NULL,
  signed_at          TIMESTAMPTZ NULL,
  certificate_id     UUID        NULL REFERENCES public.tenant_tiss_certificates(id),
  exported_at        TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID        NOT NULL REFERENCES auth.users(id),
  UNIQUE (tenant_id, health_plan_id, lote_number)
);

CREATE INDEX IF NOT EXISTS tiss_lotes_tenant_status_idx
  ON public.tiss_lotes (tenant_id, status, created_at DESC);

DROP TRIGGER IF EXISTS tiss_lotes_touch_updated_at ON public.tiss_lotes;
CREATE TRIGGER tiss_lotes_touch_updated_at
  BEFORE UPDATE ON public.tiss_lotes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Append-only: identidade do lote imutável; status/xml/hash/assinatura/export evoluem.
DROP TRIGGER IF EXISTS tiss_lotes_append_only ON public.tiss_lotes;
CREATE TRIGGER tiss_lotes_append_only
  BEFORE UPDATE OR DELETE ON public.tiss_lotes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('status,xml_content,xml_hash_md5,signed_at,certificate_id,exported_at');

ALTER TABLE public.tiss_lotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiss_lotes_tenant_read ON public.tiss_lotes;
CREATE POLICY tiss_lotes_tenant_read ON public.tiss_lotes
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tiss_lotes_billing_write ON public.tiss_lotes;
CREATE POLICY tiss_lotes_billing_write ON public.tiss_lotes
  FOR ALL
  USING  (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'))
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'));

COMMENT ON TABLE public.tiss_lotes IS
  'Feature 029 — lote de guias de UMA operadora. Guarda o XML assinado (xml_content) + hash MD-5 para reprodutibilidade do download (mesmo conteúdo/hash).';

-- FK tardia: tiss_guias.lote_id → tiss_lotes.id (definida após a criação de tiss_lotes).
ALTER TABLE public.tiss_guias
  DROP CONSTRAINT IF EXISTS tiss_guias_lote_id_fkey;
ALTER TABLE public.tiss_guias
  ADD CONSTRAINT tiss_guias_lote_id_fkey
  FOREIGN KEY (lote_id) REFERENCES public.tiss_lotes(id) ON DELETE SET NULL;

-- =========================================================================
-- 9. tiss_glosas — glosas registradas (append-only)
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.tiss_glosas (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  guia_id             UUID        NOT NULL REFERENCES public.tiss_guias(id) ON DELETE CASCADE,
  guia_procedure_id   UUID        NULL REFERENCES public.tiss_guia_procedures(id),
  motivo_code         TEXT        NOT NULL,
  motivo_text         TEXT        NOT NULL,
  glosado_amount_cents BIGINT     NOT NULL CHECK (glosado_amount_cents >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  UUID        NOT NULL REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS tiss_glosas_guia_idx
  ON public.tiss_glosas (guia_id);

-- Append-only puro (correção = nova linha).
DROP TRIGGER IF EXISTS tiss_glosas_append_only ON public.tiss_glosas;
CREATE TRIGGER tiss_glosas_append_only
  BEFORE UPDATE OR DELETE ON public.tiss_glosas
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only_columns('');

ALTER TABLE public.tiss_glosas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiss_glosas_tenant_read ON public.tiss_glosas;
CREATE POLICY tiss_glosas_tenant_read ON public.tiss_glosas
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

DROP POLICY IF EXISTS tiss_glosas_billing_insert ON public.tiss_glosas;
CREATE POLICY tiss_glosas_billing_insert ON public.tiss_glosas
  FOR INSERT
  WITH CHECK (tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','financeiro'));

COMMENT ON TABLE public.tiss_glosas IS
  'Feature 029 — glosa registrada manualmente (motivo Tabela 38 + valor glosado). Append-only. Vincula-se à guia/linha; reapresentação cria nova guia (supersedes_guia_id).';

-- =========================================================================
-- 10. Notificar PostgREST para recarregar o schema
-- =========================================================================
NOTIFY pgrst, 'reload schema';
