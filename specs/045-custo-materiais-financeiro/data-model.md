# Phase 1 — Data Model

Feature: Custo de materiais e métrica "Gasto com materiais" (045)
Migration: `supabase/migrations/0172_material_costs.sql`

## Nova tabela: `public.tenant_materials` (catálogo de insumos)

Catálogo de insumos/materiais por clínica, com custo unitário editável. **Não** é append-only (custo é config atualizável), mas toda mudança é auditada; a imutabilidade financeira vive no snapshot de uso.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `tenant_id` | UUID NOT NULL | FK → `tenants(id)` ON DELETE RESTRICT |
| `name` | TEXT NOT NULL | `length BETWEEN 1 AND 200` |
| `unit_cost_cents` | INTEGER NOT NULL | `DEFAULT 0`, `CHECK (unit_cost_cents >= 0)` |
| `tuss_code` | TEXT NULL | FK → `tuss_codes(code)`; se presente, DEVE ser tabela 19 vigente (trigger) |
| `active` | BOOLEAN NOT NULL | `DEFAULT true` |
| `created_by` | UUID NOT NULL | ator |
| `created_at` | TIMESTAMPTZ NOT NULL | `DEFAULT now()` (UTC) |
| `updated_by` | UUID NULL | ator da última edição |
| `updated_at` | TIMESTAMPTZ NULL | atualizado em edição |

- **Índices**: `(tenant_id, active)`; `(tenant_id, lower(name))` para busca; parcial `(tenant_id, tuss_code) WHERE tuss_code IS NOT NULL`.
- **Unicidade**: `UNIQUE (tenant_id, lower(name)) WHERE active` — evita insumo ativo duplicado por nome na mesma clínica.
- **RLS**: SELECT/INSERT/UPDATE por `tenant_id = jwt_tenant_id()`. Sem DELETE físico (desativar via `active=false`).
- **Trigger `check_tenant_material_tuss`**: se `tuss_code` não nulo, valida tabela 19 e vigência (reusa a lógica de `check_material_tuss_table`).
- **Trigger de auditoria**: `log_audit_event(tenant, 'tenant_materials', id, 'created'|'updated'|'deactivated', old, new, motivo)` em INSERT/UPDATE.
- **Estado**: `active` true → false (desativação); linhas desativadas permanecem visíveis no histórico, indisponíveis para novos lançamentos (FR-003).

## Tabela alterada: `public.appointment_materials`

Acrescenta o custo congelado (snapshot). Comportamento append-only mantido, **exceto** UPDATE de coluna única para completar/corrigir custo pendente (ver trigger).

| Coluna nova | Tipo | Regras |
|---|---|---|
| `unit_cost_cents` | INTEGER NOT NULL | `DEFAULT 0`, `CHECK (unit_cost_cents >= 0)` — snapshot no INSERT |
| `material_id` | UUID NULL | FK → `tenant_materials(id)`; proveniência (NULL = ad-hoc/legado); trigger valida mesmo `tenant_id` |

- **Custo total** (derivado, não persistido): `unit_cost_cents * quantity`.
- **Pendência de custo** (derivada): `unit_cost_cents = 0`.
- **Compatibilidade**: linhas legadas (feature 007) assumem `unit_cost_cents = 0` (pendência) e `material_id = NULL` — não quebram nada.
- **Trigger append-only relaxado** (`enforce_appointment_materials_mutation`): DELETE segue proibido; UPDATE permitido **somente** quando as colunas alteradas ⊆ `{unit_cost_cents, material_id}` (demais colunas imutáveis). Fora disso, exceção `42501`.
- **Auditoria**: a correção de custo emite `log_audit_event(..., 'cost_updated', valor_anterior, valor_novo, motivo)`.

## Views/consultas de agregação (sem tabela nova)

**Gasto com materiais do período** (usado por `reports/materials-cost.ts`):

```sql
SELECT SUM(am.unit_cost_cents * am.quantity) AS materials_cost_cents
FROM appointment_materials am
JOIN appointments a ON a.id = am.appointment_id
WHERE am.tenant_id = :tenant
  AND a.appointment_at >= :from AND a.appointment_at < :to
  AND NOT EXISTS (SELECT 1 FROM appointment_reversals r WHERE r.appointment_id = a.id);
```

- **Group by profissional**: `a.doctor_id`.
- **Group by convênio**: `a.plan_id`.
- **Drilldown**: lista de `appointment_materials` do período com `name`/`tuss_description`, quantidade, custo unitário e total.
- Fronteiras `:from`/`:to` calculadas no fuso do tenant, idênticas às de `operating-result` (`ymdStartOfDayUtc`).

## Impacto no cálculo financeiro (sem schema novo)

`OperatingResultLines` ganha `materialsCostCents`. Fórmula:

```
netProfit = grossRevenue − commissions − fixedPayments − liberalPayments
          − taxes − operatingExpenses − materialsCost
```

`grossRevenue`, `commissions` e `monthly_payouts` **inalterados** (Decisão D1).

## Entidades (mapa)

- **Insumo** = `tenant_materials` (catálogo).
- **Material usado no atendimento** = `appointment_materials` (uso + snapshot de custo).
- **Gasto com materiais** = agregação derivada (linha no resultado; coluna nos relatórios).
