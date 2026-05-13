# Phase 1 — Data Model: Cadastro de Impostos e Imposto por Convênio

**Status**: completo. Define o schema SQL alvo (uma migration), invariantes (CHECK, triggers, RLS) e como as entidades novas se conectam ao schema existente.

## Visão geral das tabelas tocadas

| Tabela | Mudança | Status |
|---|---|---|
| `public.taxes` | **NOVA** — catálogo de impostos por tenant | criar |
| `public.health_plans` | **ALTER** — `+ tax_rate_bps INT NOT NULL DEFAULT 0` | acrescentar coluna |
| `public.expenses` | **ALTER** — `+ tax_id UUID NULL REFERENCES taxes(id)` + CHECK + trigger update | acrescentar coluna + reforçar trigger |
| `public.audit_log` | _sem schema change_ | uso via `log_audit_event` |

Todas as mudanças vão na migration única **`supabase/migrations/0076_taxes_and_plan_tax_rate.sql`**.

---

## Entidade 1 — `public.taxes`

### Schema

```sql
CREATE TABLE public.taxes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  rate_bps     INT  NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  description  TEXT CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 500),
  category     TEXT NOT NULL CHECK (category IN ('municipal', 'estadual', 'federal', 'outro')),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  deleted_at   TIMESTAMPTZ,
  deleted_by   UUID REFERENCES auth.users(id) ON DELETE RESTRICT,

  -- Nome único entre os impostos NÃO deletados, case-insensitive, trim-aware.
  -- Implementado como UNIQUE INDEX para suportar a expressão lower(trim()).
  CONSTRAINT taxes_active_name_unique  -- intencionalmente como UNIQUE INDEX (abaixo)
    EXCLUDE USING btree (tenant_id WITH =, lower(trim(name)) WITH =)
    WHERE (deleted_at IS NULL)
);
```

> **Observação**: o `EXCLUDE USING btree (... WITH =, ... WITH =)` aproveita o `btree_gist` já instalado pela migration 0055 (`btree_gist` está em `extensions` schema). Alternativa equivalente (mais portátil): `CREATE UNIQUE INDEX taxes_active_name_unique_idx ON public.taxes (tenant_id, lower(trim(name))) WHERE deleted_at IS NULL;` — esta é a forma que será usada por simplicidade e zero dependência adicional.

### Índices

```sql
CREATE INDEX taxes_tenant_active_idx
  ON public.taxes (tenant_id, is_active)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX taxes_active_name_unique_idx
  ON public.taxes (tenant_id, lower(trim(name)))
  WHERE deleted_at IS NULL;
```

### Invariantes

| ID | Invariante | Mecanismo |
|---|---|---|
| INV-T1 | `rate_bps` é inteiro entre 0 e 10000 (0–100 %) | CHECK |
| INV-T2 | `name` tem 1–80 chars | CHECK |
| INV-T3 | `category` ∈ {municipal, estadual, federal, outro} | CHECK |
| INV-T4 | dois impostos não-deletados no mesmo tenant não podem ter `lower(trim(name))` igual | UNIQUE INDEX parcial |
| INV-T5 | `id`, `tenant_id`, `name`, `category`, `created_at`, `created_by` são imutáveis | trigger `enforce_taxes_mutation` |
| INV-T6 | DELETE físico bloqueado | trigger `enforce_append_only` (função já existente) |
| INV-T7 | Toda criação/alteração registrada em `audit_log` | trigger `audit_taxes_change` chamando `log_audit_event` |
| INV-T8 | Reads filtrados por tenant; writes só admin/financeiro | RLS policies |

### Trigger de imutabilidade

```sql
CREATE OR REPLACE FUNCTION public.enforce_taxes_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  IF NEW.id         IS DISTINCT FROM OLD.id
     OR NEW.tenant_id  IS DISTINCT FROM OLD.tenant_id
     OR NEW.name       IS DISTINCT FROM OLD.name
     OR NEW.category   IS DISTINCT FROM OLD.category
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'taxes: id, tenant_id, name, category, created_at, created_by são imutáveis (audit-history integrity)';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER taxes_immutable_columns
  BEFORE UPDATE ON public.taxes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_taxes_mutation();

CREATE TRIGGER taxes_no_physical_delete
  BEFORE DELETE ON public.taxes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_append_only();
```

### Trigger de auditoria

```sql
CREATE OR REPLACE FUNCTION public.audit_taxes_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'taxes', NEW.id, 'created',
      NULL, format('%s|%s|%s%%', NEW.name, NEW.category, NEW.rate_bps::numeric/100),
      'tax-created'
    );
    RETURN NEW;
  END IF;
  -- UPDATE: registra cada coluna mutável alterada como uma linha audit.
  IF NEW.rate_bps IS DISTINCT FROM OLD.rate_bps THEN
    PERFORM public.log_audit_event(NEW.tenant_id, 'taxes', NEW.id,
      'rate_bps', OLD.rate_bps::text, NEW.rate_bps::text, 'tax-rate-updated');
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    PERFORM public.log_audit_event(NEW.tenant_id, 'taxes', NEW.id,
      'description', OLD.description, NEW.description, 'tax-description-updated');
  END IF;
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    PERFORM public.log_audit_event(NEW.tenant_id, 'taxes', NEW.id,
      'is_active', OLD.is_active::text, NEW.is_active::text,
      CASE WHEN NEW.is_active THEN 'tax-reactivated' ELSE 'tax-deactivated' END);
  END IF;
  IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL THEN
    PERFORM public.log_audit_event(NEW.tenant_id, 'taxes', NEW.id,
      'deleted_at', NULL, NEW.deleted_at::text, 'tax-soft-deleted');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER taxes_audit
  AFTER INSERT OR UPDATE ON public.taxes
  FOR EACH ROW EXECUTE FUNCTION public.audit_taxes_change();
```

### RLS

```sql
ALTER TABLE public.taxes ENABLE ROW LEVEL SECURITY;

CREATE POLICY taxes_read ON public.taxes FOR SELECT
  USING (tenant_id = public.jwt_tenant_id());

CREATE POLICY taxes_insert ON public.taxes FOR INSERT
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin','financeiro')
  );

CREATE POLICY taxes_update ON public.taxes FOR UPDATE
  USING (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin','financeiro')
  )
  WITH CHECK (
    tenant_id = public.jwt_tenant_id()
    AND public.jwt_role() IN ('admin','financeiro')
  );

REVOKE DELETE ON public.taxes FROM authenticated;
GRANT SELECT, INSERT ON public.taxes TO authenticated;
GRANT UPDATE (rate_bps, description, is_active, deleted_at, deleted_by) ON public.taxes TO authenticated;
```

---

## Entidade 2 — `public.health_plans` (extensão)

### Mudança de schema

```sql
ALTER TABLE public.health_plans
  ADD COLUMN tax_rate_bps INT NOT NULL DEFAULT 0
    CHECK (tax_rate_bps BETWEEN 0 AND 10000);
```

### Invariantes

| ID | Invariante | Mecanismo |
|---|---|---|
| INV-H1 | `tax_rate_bps` ∈ [0, 10000] | CHECK |
| INV-H2 | DEFAULT 0 garante backfill seguro de linhas existentes | DEFAULT clause |
| INV-H3 | Cada mudança auditada | trigger `audit_health_plan_tax_rate_change` |
| INV-H4 | Escrita só por admin (regra atual de `health_plans` mantida) | RLS já vigente |

### Trigger de auditoria

```sql
CREATE OR REPLACE FUNCTION public.audit_health_plan_tax_rate_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tax_rate_bps IS DISTINCT FROM OLD.tax_rate_bps THEN
    PERFORM public.log_audit_event(
      NEW.tenant_id, 'health_plans', NEW.id,
      'tax_rate_bps', OLD.tax_rate_bps::text, NEW.tax_rate_bps::text,
      'plan-tax-rate-updated'
    );
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER health_plans_tax_rate_audit
  AFTER UPDATE OF tax_rate_bps ON public.health_plans
  FOR EACH ROW EXECUTE FUNCTION public.audit_health_plan_tax_rate_change();
```

> **Nota sobre GRANT**: a coluna `tax_rate_bps` precisa entrar nas concessões de UPDATE existentes em `health_plans`. A migration 0004 não restringe colunas (faz `GRANT UPDATE ON ... TO authenticated`), então não é necessário adicionar grant específico — apenas conferir no `psql \dp`. Se houver uma policy de UPDATE com colunas explícitas em migrations posteriores, atualizá-la.

### Backfill

Não há backfill necessário — `DEFAULT 0` cobre todas as linhas existentes (`tax_rate_bps=0` = "não cobra imposto", coerente com a invariante "convênios existentes preservam comportamento atual" — SC-007).

---

## Entidade 3 — `public.expenses` (extensão)

### Mudança de schema

```sql
ALTER TABLE public.expenses
  ADD COLUMN tax_id UUID NULL REFERENCES public.taxes(id) ON DELETE RESTRICT;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_tax_link_requires_impostos_category
  CHECK (tax_id IS NULL OR category = 'impostos');

CREATE INDEX expenses_tax_idx
  ON public.expenses (tenant_id, tax_id)
  WHERE tax_id IS NOT NULL;
```

### Trigger update (estender `enforce_expenses_mutation`)

```sql
CREATE OR REPLACE FUNCTION public.enforce_expenses_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
  IF NEW.id              IS DISTINCT FROM OLD.id
     OR NEW.tenant_id     IS DISTINCT FROM OLD.tenant_id
     OR NEW.amount_cents  IS DISTINCT FROM OLD.amount_cents
     OR NEW.category      IS DISTINCT FROM OLD.category
     OR NEW.competence_date IS DISTINCT FROM OLD.competence_date
     OR NEW.created_at    IS DISTINCT FROM OLD.created_at
     OR NEW.tax_id        IS DISTINCT FROM OLD.tax_id THEN  -- NOVO
    RAISE EXCEPTION 'expenses: imutável. Apenas soft-delete (deleted_at) permitido.';
  END IF;
  RETURN NEW;
END $$;
```

### Invariantes

| ID | Invariante | Mecanismo |
|---|---|---|
| INV-E1 | `tax_id` aponta para imposto do mesmo tenant | FK + RLS (taxes visíveis só do tenant) — reforçado no caminho de aplicação |
| INV-E2 | Se `tax_id IS NOT NULL` então `category = 'impostos'` | CHECK |
| INV-E3 | `tax_id` é imutável após insert | trigger expandida |
| INV-E4 | Toda criação registrada em audit (já existente, agora incluindo `tax_id`) | trigger existente ajustada |

> **Cross-tenant integridade do `tax_id`**: o CHECK SQL não cobre "tax do mesmo tenant que expense" — depende da camada de aplicação verificar `taxes.tenant_id = session.tenantId` antes do insert (já é o padrão; `createExpense` faz `tenantId: session.tenantId` no insert e o select de tax para popular UI também filtra por tenant). Defesa adicional: a RLS de `taxes` impede leitura cross-tenant, então um payload com `tax_id` de outro tenant resultaria em "imposto inexistente" no select da UI; a FK garante referencial mas não tenant scope. Adicionar trigger de validação cross-tenant fica como `enforce_expenses_tax_same_tenant` — opcional, recomendado:

```sql
CREATE OR REPLACE FUNCTION public.enforce_expenses_tax_same_tenant()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE tax_tenant UUID;
BEGIN
  IF NEW.tax_id IS NULL THEN RETURN NEW; END IF;
  SELECT tenant_id INTO tax_tenant FROM public.taxes WHERE id = NEW.tax_id;
  IF tax_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'expenses.tax_id: imposto pertence a outro tenant (cross-tenant violation)';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER expenses_tax_same_tenant
  BEFORE INSERT ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.enforce_expenses_tax_same_tenant();
```

---

## Diagrama lógico

```
+----------------+        +-----------------+
|   tenants      |        |   auth.users    |
+----------------+        +-----------------+
        ^                            ^
        |                            |
        |                            |
+-------+----------+        +--------+--------+        +--------------------+
|     taxes        |        |   health_plans  |        |     expenses       |
+------------------+        +-----------------+        +--------------------+
| id (UUID, pk)    |        | id (UUID, pk)   |        | id (UUID, pk)      |
| tenant_id  -----------    | tenant_id ---   |        | tenant_id          |
| name             |   |    | name            |        | category           |
| rate_bps (int)   |   |    | active          |        | description        |
| description      |   |    | tax_rate_bps ★  |        | amount_cents       |
| category         |   |    | created_at      |        | competence_date    |
| is_active        |   |    +-----------------+        | recurring          |
| deleted_at       |   |                               | frequency          |
| created_at/by    |   |                               | tax_id ★ ----------+
+------------------+   |                               | created_at/by      |
                       |                               +--------------------+
                       |                                          |
                       +-------------- referenced by -------------+

★ colunas adicionadas por esta feature.
```

---

## Mapeamento Spec → Schema

| Spec requirement | Schema artifact |
|---|---|
| FR-001 (campos do imposto) | `taxes` columns |
| FR-002 (bps) | `rate_bps INT CHECK 0..10000` |
| FR-003 (unique by name, ci, trim, scoped) | `taxes_active_name_unique_idx` |
| FR-005 (desativar sem perder histórico) | `is_active` + `deleted_at` + FK RESTRICT |
| FR-006 (sem delete físico) | `enforce_append_only` trigger |
| FR-008–FR-011 (alíquota convênio) | `health_plans.tax_rate_bps` + audit trigger |
| FR-012 (sem tabela de relação) | _ausência intencional de health_plan_taxes_ |
| FR-013–FR-017 (vínculo despesa→imposto) | `expenses.tax_id` + CHECK category + cross-tenant trigger |
| FR-022–FR-023 (audit) | `audit_taxes_change` + `audit_health_plan_tax_rate_change` |
| FR-024 (RLS por tenant) | policies em `taxes` + RLS herdada em health_plans/expenses |

---

## Estados / Transições

### `taxes`

```
       (criação)
          │
          v
       [active]  ──── desativar ────>  [inactive]
          ^                                │
          │                                │
          └──── reativar ──────────────────┘
              soft-delete (futuro)
                         │
                         v
                     [deleted]  (deleted_at set, não retornado em listagens)
```

- Toda transição **gera audit**.
- Não há DELETE físico.

### `health_plans.tax_rate_bps`

```
   0 (default) ──[admin set]──> N  ──[admin set]──> M  ──[admin clear]──> 0
                                      ^
                                      │
                                  cada mudança auditada
```

---

## Concorrência

- Cadastro simultâneo do mesmo nome em duas requests concorrentes: o UNIQUE INDEX resolve via `23505` (`unique_violation`) — a camada de serviço converte para `ConflictError` (`TAX_DUPLICATE`) → HTTP 409. Padrão já usado em `createHealthPlan`.
- Edição simultânea de `rate_bps` por dois admins: "last write wins" + audit registra ambos os passos. Não há lost-update silencioso porque o audit log preserva a sequência.

---

## Considerações de tipos TS

```ts
// gerado por `pnpm supabase:gen-types`
type TaxRow = {
  id: string
  tenant_id: string
  name: string
  rate_bps: number          // 0..10000
  description: string | null
  category: 'municipal' | 'estadual' | 'federal' | 'outro'
  is_active: boolean
  created_at: string
  created_by: string
  deleted_at: string | null
  deleted_by: string | null
}
```

`expenses` ganha `tax_id: string | null`. `health_plans` ganha `tax_rate_bps: number`.

Helper TS para conversão (centraliza arredondamento):

```ts
// src/lib/validation/rate-bps.ts
export function percentToBps(input: string): number  // "6,50" -> 650, half-up
export function bpsToPercent(bps: number): string    // 650 -> "6,50"
export function bpsValid(bps: number): boolean        // 0..10000, integer
```

---

## Pronto para Phase 1 de contratos
