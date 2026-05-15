# Data Model: Modalidades de pagamento + Profissional assistente

**Phase 1** — schema SQL completo, invariantes e diagrama. Base para migration `0084_payment_modes_and_assistants.sql`.

---

## Visão geral

```text
                        ┌──────────────────────────────────────┐
                        │            public.doctors            │
                        │ ─────────────────────────────────── │
                        │ id, tenant_id, full_name, crm,      │
                        │ active, role, specialty, council_*, │
                        │ user_id (0078)                      │
                        │ ★ payment_mode payment_mode NOT NULL│  ◀── NOVO (default 'comissionado')
                        │   DEFAULT 'comissionado'            │
                        └────────────┬─────────────────────────┘
                                     │ 1:N
        ┌────────────────────────────┼──────────────────────────┐
        │                            │                          │
        ▼                            ▼                          ▼
┌─────────────────────┐  ┌──────────────────────────────┐  ┌──────────────────────┐
│ doctor_commission_  │  │ doctor_payment_terms_history │  │ appointments         │
│   history (0005)    │  │ ──────────────────────────── │  │ (existente)          │
│ — apenas tipo       │  │ id, tenant_id, doctor_id,    │  │ ★ no asistentes      │
│   comissionado;     │  │ payment_mode, valid_from,    │  │ ★ frozen_commission_ │
│   continua sendo a  │  │ percentage_bps NULL,         │  │   bps=0 p/ fixo      │
│   fonte de          │  │ monthly_amount_cents NULL,   │  └──────────┬───────────┘
│   `frozen_commission│  │ billing_day SMALLINT NULL,   │             │ 1:N
│   _bps` no INSERT   │  │ liberal_default_cents NULL,  │             ▼
│   de appointment    │  │ reason TEXT NOT NULL,        │  ┌──────────────────────┐
└─────────────────────┘  │ created_by, created_at       │  │ appointment_         │
                         │ CHECK por modalidade         │  │   assistants (NOVO)  │
                         └─────────────┬────────────────┘  │ ──────────────────── │
                                       │                   │ id, tenant_id,       │
                                       │ DISTINCT ON       │ appointment_id,      │
                                       ▼                   │ assistant_doctor_id, │
                         ┌────────────────────────────┐    │ frozen_amount_cents, │
                         │ VIEW                       │    │ created_by,          │
                         │  doctor_payment_terms_     │    │ created_at,          │
                         │   current                  │    │ removed_at NULL,     │
                         │ ────────────────────────── │    │ removed_by NULL      │
                         │ head-of-chain por doctor   │    │ UNIQUE partial       │
                         │ (último valid_from <=      │    │  (appointment_id,    │
                         │  CURRENT_DATE)             │    │   assistant_doctor_  │
                         └────────────────┬───────────┘    │   id) WHERE          │
                                          │                │  removed_at IS NULL  │
                                          ▼                └──────────────────────┘
                         ┌────────────────────────────┐
                         │ VIEW                       │
                         │  monthly_fixed_pay_lines   │
                         │ ────────────────────────── │
                         │ linhas virtuais — 1 por    │
                         │ doctor fixo × mês a partir │
                         │ do billing_day             │
                         └────────────────────────────┘
```

---

## 1. ENUM `payment_mode`

```sql
CREATE TYPE public.payment_mode AS ENUM (
  'comissionado',  -- recebe % sobre atendimentos (comportamento legado)
  'fixo',          -- recebe valor mensal no dia configurado
  'liberal'        -- cobra por participação como assistente
);
```

**Invariantes**:

- ENUM imutável após migration (adicionar novo valor exige migration explícita + revisão de produto).
- Sem ordering semântico — comparação `=` ou `IN` apenas.

---

## 2. Tabela `doctors` — ALTER

```sql
ALTER TABLE public.doctors
  ADD COLUMN IF NOT EXISTS payment_mode public.payment_mode
    NOT NULL DEFAULT 'comissionado';

CREATE INDEX IF NOT EXISTS doctors_payment_mode_idx
  ON public.doctors (tenant_id, payment_mode);
```

**Invariantes**:

- Coluna `payment_mode` é **denormalização** do head-of-chain de `doctor_payment_terms_history`.
- Atualizada **apenas via service layer** (`update-payment-mode.ts`) que faz INSERT na history e UPDATE em `doctors.payment_mode` na mesma transação.
- Trigger `audit_doctors_payment_mode_change` (AFTER UPDATE OF payment_mode) registra mudança no audit log.
- Default `comissionado` cobre dados legados (FR-008/SC-002).

---

## 3. Tabela `doctor_payment_terms_history` — NOVA (append-only, com 1 row inicial por doctor)

```sql
CREATE TABLE IF NOT EXISTS public.doctor_payment_terms_history (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id               UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  payment_mode            public.payment_mode NOT NULL,
  percentage_bps          INTEGER     CHECK (percentage_bps      IS NULL OR percentage_bps      BETWEEN 0 AND 10000),
  monthly_amount_cents    BIGINT      CHECK (monthly_amount_cents IS NULL OR monthly_amount_cents > 0),
  billing_day             SMALLINT    CHECK (billing_day          IS NULL OR billing_day BETWEEN 1 AND 28),
  liberal_default_cents   BIGINT      CHECK (liberal_default_cents IS NULL OR liberal_default_cents > 0),
  valid_from              DATE NOT NULL,
  reason                  TEXT NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  created_by              UUID NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Exatamente o conjunto de campos da modalidade está preenchido.
  CONSTRAINT payment_terms_fields_match_mode CHECK (
    (payment_mode = 'comissionado' AND percentage_bps        IS NOT NULL
                                   AND monthly_amount_cents  IS NULL
                                   AND billing_day           IS NULL
                                   AND liberal_default_cents IS NULL)
    OR
    (payment_mode = 'fixo'         AND percentage_bps        IS NULL
                                   AND monthly_amount_cents  IS NOT NULL
                                   AND billing_day           IS NOT NULL
                                   AND liberal_default_cents IS NULL)
    OR
    (payment_mode = 'liberal'      AND percentage_bps        IS NULL
                                   AND monthly_amount_cents  IS NULL
                                   AND billing_day           IS NULL
                                   AND liberal_default_cents IS NOT NULL)
  ),
  UNIQUE (tenant_id, doctor_id, valid_from)
);

CREATE INDEX IF NOT EXISTS doctor_payment_terms_history_lookup_idx
  ON public.doctor_payment_terms_history (tenant_id, doctor_id, valid_from DESC, created_at DESC);
```

**Invariantes**:

- **Append-only stricto** — trigger `enforce_payment_terms_immutable` bloqueia UPDATE/DELETE de qualquer linha após INSERT, exceto pelo service_role.
- Cada mudança de modalidade ou parâmetro insere **nova row** com `valid_from = data da mudança` (DATE, fuso local da clínica).
- `valid_from <= CURRENT_DATE` validado pelo service (não pode programar mudança futura no MVP).
- 1 row inicial por doctor existente no backfill da migration (research Decisão 2).

**RLS**:

```sql
ALTER TABLE public.doctor_payment_terms_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_terms_read_tenant ON public.doctor_payment_terms_history;
CREATE POLICY payment_terms_read_tenant ON public.doctor_payment_terms_history
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.doctor_payment_terms_history FROM authenticated;
GRANT  SELECT                  ON public.doctor_payment_terms_history TO   authenticated;
```

INSERT só via RPC `record_payment_terms_change(p_tenant_id, p_doctor_id, p_mode, p_params, p_valid_from, p_reason, p_actor)` (SECURITY DEFINER, valida `jwt_tenant_id` + `jwt_role='admin'`).

**Triggers**:

- `enforce_payment_terms_immutable` (BEFORE UPDATE/DELETE) — append-only stricto.
- `audit_payment_terms_insert` (AFTER INSERT) — chama `log_audit_event(... entity='doctor_payment_terms', field='version_created', new_value=JSON, reason=NEW.reason)`.

---

## 4. View `doctor_payment_terms_current` — NOVA

```sql
CREATE OR REPLACE VIEW public.doctor_payment_terms_current AS
SELECT DISTINCT ON (tenant_id, doctor_id)
  tenant_id,
  doctor_id,
  payment_mode,
  percentage_bps,
  monthly_amount_cents,
  billing_day,
  liberal_default_cents,
  valid_from,
  created_at
FROM public.doctor_payment_terms_history
WHERE valid_from <= CURRENT_DATE
ORDER BY tenant_id, doctor_id, valid_from DESC, created_at DESC;

GRANT SELECT ON public.doctor_payment_terms_current TO authenticated, service_role;
```

**Uso**:

- Resolver "qual a modalidade vigente e seus parâmetros?" sem N+1.
- Consumida por: `list-doctors.ts`, `appointment_assistants` trigger de validação (`payment_mode='liberal'`?), `monthly_fixed_pay_lines` view.
- Mantém o padrão de `doctor_commission_current` (0005).

---

## 5. Tabela `appointment_assistants` — NOVA (append-only com soft-unlink)

```sql
CREATE TABLE IF NOT EXISTS public.appointment_assistants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES public.tenants(id)    ON DELETE RESTRICT,
  appointment_id        UUID NOT NULL REFERENCES public.appointments(id) ON DELETE RESTRICT,
  assistant_doctor_id   UUID NOT NULL REFERENCES public.doctors(id)    ON DELETE RESTRICT,
  frozen_amount_cents   BIGINT NOT NULL CHECK (frozen_amount_cents > 0 AND frozen_amount_cents < 100000000), -- < R$ 1M sanity
  created_by            UUID NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at            TIMESTAMPTZ,           -- NULL = ativo
  removed_by            UUID,                  -- ator que removeu
  CONSTRAINT removed_pair_complete CHECK (
    (removed_at IS NULL AND removed_by IS NULL)
    OR
    (removed_at IS NOT NULL AND removed_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS appointment_assistants_appointment_active_idx
  ON public.appointment_assistants (appointment_id) WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS appointment_assistants_doctor_period_idx
  ON public.appointment_assistants (tenant_id, assistant_doctor_id, created_at DESC) WHERE removed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS appointment_assistants_no_duplicate_active_idx
  ON public.appointment_assistants (appointment_id, assistant_doctor_id) WHERE removed_at IS NULL;
```

**Invariantes**:

- **Append-only**: UPDATE permitido **apenas** para setar `removed_at IS NULL → NOT NULL` (e `removed_by` junto). Demais colunas imutáveis após INSERT.
- `frozen_amount_cents` congelado no INSERT (research Decisão 8) — não relê do cadastro do liberal posteriormente.
- Duplicata ativa bloqueada pelo unique parcial.
- Estorno do appointment pai **não modifica** estes registros — relatório que filtra usa `NOT EXISTS (SELECT 1 FROM appointment_reversals WHERE appointment_id = aa.appointment_id)`.

**RLS**:

```sql
ALTER TABLE public.appointment_assistants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS assistants_read_tenant ON public.appointment_assistants;
CREATE POLICY assistants_read_tenant ON public.appointment_assistants
  FOR SELECT USING (tenant_id = public.jwt_tenant_id());

REVOKE INSERT, UPDATE, DELETE ON public.appointment_assistants FROM authenticated;
GRANT  SELECT                  ON public.appointment_assistants TO   authenticated;
```

INSERT/UPDATE só via RPCs (ver §7).

**Triggers** (4):

1. `enforce_appointment_assistants_mutation` (BEFORE UPDATE/DELETE):
   - DELETE → REJECT.
   - UPDATE → permite somente quando OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL AND (NEW.id, NEW.tenant_id, NEW.appointment_id, NEW.assistant_doctor_id, NEW.frozen_amount_cents, NEW.created_by, NEW.created_at) = (OLD.…); senão REJECT.
2. `check_assistant_tenant_consistency` (BEFORE INSERT):
   - `appointment_id.tenant_id = assistant_doctor_id.tenant_id = NEW.tenant_id`.
3. `check_assistant_doctor_is_liberal` (BEFORE INSERT):
   - `(SELECT payment_mode FROM doctor_payment_terms_current WHERE doctor_id = NEW.assistant_doctor_id) = 'liberal'` — senão REJECT com `ASSISTANT_NOT_LIBERAL`.
4. `audit_appointment_assistant_change` (AFTER INSERT OR AFTER UPDATE of removed_at):
   - INSERT: `log_audit_event(... entity='appointment_assistants', field='added', new_value=JSON)`.
   - UPDATE (removed_at set): `log_audit_event(... entity='appointment_assistants', field='removed', new_value=JSON{removed_at, removed_by})`.

---

## 6. View `monthly_fixed_pay_lines` — NOVA

Ver SQL completo em `research.md > Decisão 6`. Resumo:

```sql
CREATE OR REPLACE VIEW public.monthly_fixed_pay_lines AS
SELECT
  d.tenant_id, d.id AS doctor_id, d.full_name AS doctor_name,
  pt.monthly_amount_cents AS amount_cents,
  pt.billing_day,
  date_trunc('month', month_start)::date AS month_start,
  make_date(EXTRACT(YEAR FROM month_start)::int, EXTRACT(MONTH FROM month_start)::int, pt.billing_day) AS billing_date
FROM doctors d
JOIN doctor_payment_terms_current pt ON pt.doctor_id = d.id
CROSS JOIN LATERAL generate_series(
  date_trunc('month', pt.valid_from)::date,
  date_trunc('month', CURRENT_DATE)::date,
  INTERVAL '1 month'
) AS month_start
WHERE pt.payment_mode = 'fixo'
  AND make_date(EXTRACT(YEAR FROM month_start)::int, EXTRACT(MONTH FROM month_start)::int, pt.billing_day) <= CURRENT_DATE
  AND d.active = true;

GRANT SELECT ON public.monthly_fixed_pay_lines TO authenticated, service_role;
```

**Invariantes**:

- Virtual — sem row física; cálculo determinístico sobre o head-of-chain (FR-020, FR-027).
- Filtro RLS é herdado da query do consumidor (a view não tem RLS própria; quem consulta filtra `tenant_id = jwt_tenant_id()`).
- Performance: ≤ 480 linhas por tenant (20 Fixos × 24 meses).

---

## 7. RPCs novas (SECURITY DEFINER)

### 7.1 `record_payment_terms_change`

```sql
CREATE OR REPLACE FUNCTION public.record_payment_terms_change(
  p_tenant_id             UUID,
  p_doctor_id             UUID,
  p_payment_mode          public.payment_mode,
  p_percentage_bps        INTEGER,
  p_monthly_amount_cents  BIGINT,
  p_billing_day           SMALLINT,
  p_liberal_default_cents BIGINT,
  p_valid_from            DATE,
  p_reason                TEXT,
  p_actor                 UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_id UUID;
BEGIN
  -- Tenant guard
  IF public.jwt_tenant_id() IS NOT NULL AND public.jwt_tenant_id() <> p_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE='TENANT_MISMATCH', ERRCODE='42501';
  END IF;
  -- Role guard
  IF public.jwt_role() IS NOT NULL AND public.jwt_role() <> 'admin' THEN
    RAISE EXCEPTION USING MESSAGE='FORBIDDEN_ROLE', ERRCODE='42501';
  END IF;

  INSERT INTO public.doctor_payment_terms_history (
    tenant_id, doctor_id, payment_mode, percentage_bps,
    monthly_amount_cents, billing_day, liberal_default_cents,
    valid_from, reason, created_by
  ) VALUES (
    p_tenant_id, p_doctor_id, p_payment_mode, p_percentage_bps,
    p_monthly_amount_cents, p_billing_day, p_liberal_default_cents,
    p_valid_from, p_reason, p_actor
  ) RETURNING id INTO v_new_id;

  -- Espelha o head-of-chain em doctors.payment_mode (trigger audita).
  UPDATE public.doctors SET payment_mode = p_payment_mode WHERE id = p_doctor_id AND tenant_id = p_tenant_id;

  RETURN v_new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.record_payment_terms_change(UUID, UUID, public.payment_mode, INTEGER, BIGINT, SMALLINT, BIGINT, DATE, TEXT, UUID) TO authenticated;
```

### 7.2 `attach_assistant_to_appointment`

```sql
CREATE OR REPLACE FUNCTION public.attach_assistant_to_appointment(
  p_appointment_id      UUID,
  p_assistant_doctor_id UUID,
  p_amount_cents        BIGINT,
  p_actor               UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id  UUID;
  v_jwt_tenant UUID;
  v_new_id     UUID;
BEGIN
  v_jwt_tenant := public.jwt_tenant_id();

  SELECT tenant_id INTO v_tenant_id FROM public.appointments WHERE id = p_appointment_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_NOT_FOUND', ERRCODE='02000';
  END IF;
  IF v_jwt_tenant IS NOT NULL AND v_jwt_tenant <> v_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE='APPOINTMENT_NOT_FOUND', ERRCODE='02000';
  END IF;

  INSERT INTO public.appointment_assistants (
    tenant_id, appointment_id, assistant_doctor_id, frozen_amount_cents, created_by
  ) VALUES (
    v_tenant_id, p_appointment_id, p_assistant_doctor_id, p_amount_cents, p_actor
  ) RETURNING id INTO v_new_id;

  RETURN v_new_id;
END $$;

GRANT EXECUTE ON FUNCTION public.attach_assistant_to_appointment(UUID, UUID, BIGINT, UUID) TO authenticated;
```

### 7.3 `remove_appointment_assistant`

```sql
CREATE OR REPLACE FUNCTION public.remove_appointment_assistant(
  p_id     UUID,
  p_actor  UUID
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM public.appointment_assistants WHERE id = p_id;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE='ASSISTANT_NOT_FOUND', ERRCODE='02000';
  END IF;
  IF public.jwt_tenant_id() IS NOT NULL AND public.jwt_tenant_id() <> v_tenant_id THEN
    RAISE EXCEPTION USING MESSAGE='ASSISTANT_NOT_FOUND', ERRCODE='02000';
  END IF;

  UPDATE public.appointment_assistants
     SET removed_at = now(), removed_by = p_actor
   WHERE id = p_id AND removed_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE='ASSISTANT_ALREADY_REMOVED', ERRCODE='23514';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION public.remove_appointment_assistant(UUID, UUID) TO authenticated;
```

---

## 8. Backfill (na própria migration)

1. **Seed `doctor_payment_terms_history`**: 1 row por doctor com `payment_mode='comissionado'` + `percentage_bps` herdado da row mais recente de `doctor_commission_history` (DISTINCT ON head).
2. **UPDATE `doctors.payment_mode = 'comissionado'`**: já garantido pelo DEFAULT, mas explícito por segurança.
3. **Validação**: a migration ao final faz `SELECT COUNT(*)` em ambas as tabelas e raises se contagem != esperada.

---

## 9. Invariantes globais (cross-table)

1. **Cada doctor tem pelo menos 1 row em `doctor_payment_terms_history`** após o deploy desta migration. Garantido pelo backfill + pela API que sempre escreve junto no create.
2. **`doctors.payment_mode` sempre bate com o head-of-chain de `doctor_payment_terms_current`** para aquele doctor. Mantido atomicamente pela RPC `record_payment_terms_change` (INSERT + UPDATE na mesma transação).
3. **`appointment_assistants.assistant_doctor_id` tem `payment_mode='liberal'` no momento do INSERT**. Garantido pelo trigger `check_assistant_doctor_is_liberal`. Mudanças posteriores de modalidade NÃO retroagem (histórico congela).
4. **`frozen_amount_cents` em `appointment_assistants` independe de mudanças futuras em `liberal_default_cents`** (FR-014).
5. **Estorno de atendimento principal preserva registros de assistente** (FR-019); o relatório usa filtro `NOT EXISTS appointment_reversals` para exclusão.

---

## 10. Diagrama de estados — `appointment_assistants`

```text
                INSERT (RPC attach)
                ─────────────────►
   (não existe)                    ATIVO (removed_at IS NULL)
                                        │
                                        │ UPDATE (RPC remove)
                                        │ removed_at := now()
                                        │ removed_by := actor
                                        ▼
                                  REMOVIDO (removed_at IS NOT NULL)  ◀── ESTADO TERMINAL
                                  (não pode voltar a ativo;
                                   re-adicionar = novo INSERT)
```

Re-adicionar o mesmo `assistant_doctor_id` ao mesmo `appointment_id` após uma remoção é permitido (novo INSERT cria nova row ATIVA — o unique parcial só conta linhas onde `removed_at IS NULL`).

---

## 11. Compatibilidade & Migração

- ❌ Nenhuma tabela existente é dropada.
- ❌ Nenhuma coluna existente é removida.
- ✅ `doctors.payment_mode` adicionada com DEFAULT — INSERTs antigos continuam compatíveis (escolhem 'comissionado' implicitamente).
- ✅ `appointment_procedures` (0069), `appointment_materials` (0061), `appointment_completions`, `appointment_reversals` — todas inalteradas.
- ✅ `doctor_commission_history` (0005) **continua sendo a fonte autoritativa de comissão por data** para o cálculo de `frozen_commission_bps` em `appointments` no INSERT. Não duplicamos esse caminho. `doctor_payment_terms_history` é fonte autoritativa de **modalidade vigente** e parâmetros não-comissão.
- ✅ Relatórios pré-existentes que assumem "todo doctor é comissionado" continuam funcionando — o backfill garante `payment_mode='comissionado'` para todos os doctors atuais.
