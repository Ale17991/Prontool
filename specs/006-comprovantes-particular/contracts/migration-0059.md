# Contract — Migration 0059

**Arquivo**: `supabase/migrations/0059_expense_receipts_table_and_particular.sql`

Migração consolidada que entrega as duas frentes da feature 006. Idempotente em todas as seções.

## Estrutura (alta-nível)

```sql
-- =========================================================================
-- (a) expense_receipts — tabela canonica de comprovantes
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.expense_receipts (...);
CREATE INDEX IF NOT EXISTS expense_receipts_expense_idx ...;
CREATE INDEX IF NOT EXISTS expense_receipts_tenant_uploaded_idx ...;
ALTER TABLE public.expense_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ... CREATE POLICY expense_receipts_read ...;
-- ... INSERT/UPDATE/DELETE policies ...
REVOKE INSERT, UPDATE, DELETE ON public.expense_receipts FROM authenticated;
GRANT SELECT ON public.expense_receipts TO authenticated;
GRANT UPDATE (deleted_at, deleted_by, deleted_reason) ON public.expense_receipts TO authenticated;

-- (b) Triggers de imutabilidade + audit em expense_receipts
CREATE OR REPLACE FUNCTION public.enforce_expense_receipt_mutability() ...;
CREATE TRIGGER expense_receipts_immutable BEFORE UPDATE OR DELETE ...;

CREATE OR REPLACE FUNCTION public.audit_expense_receipt_change() ...;
CREATE TRIGGER expense_receipts_audit_insert AFTER INSERT ...;
CREATE TRIGGER expense_receipts_audit_softdelete AFTER UPDATE
  WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) ...;

-- =========================================================================
-- (c) Backfill 1:1 → 1:N
-- =========================================================================
DO $$ ... INSERT INTO expense_receipts SELECT ... FROM expenses
         WHERE receipt_file_url IS NOT NULL
         ON CONFLICT (storage_path) DO NOTHING; ... END $$;

-- =========================================================================
-- (d) Column-guard de expenses recriado: bloqueia novos UPDATE
--     em receipt_file_*, mantem deleted_at/deleted_by mutaveis.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enforce_expenses_mutation() ...;
REVOKE UPDATE (receipt_file_name, receipt_file_url, receipt_file_size)
  ON public.expenses FROM authenticated;

-- =========================================================================
-- (e) Atendimento particular: plan_id nullable + trigger atualizado
-- =========================================================================
ALTER TABLE public.appointments ALTER COLUMN plan_id DROP NOT NULL;
ALTER TABLE public.appointments ALTER COLUMN source_price_version_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_appointment_preconditions() ...;
-- (sem CREATE TRIGGER — o trigger appointments_validate ja foi criado em 0015)
```

## Asserções pós-migração (contract test)

```sql
-- 1. Tabela existe com colunas corretas
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='expense_receipts'
 ORDER BY ordinal_position;
-- esperado: id, tenant_id, expense_id, file_name, storage_path,
--           file_size_bytes, content_type, uploaded_by, uploaded_at,
--           deleted_at, deleted_by, deleted_reason

-- 2. plan_id nullable em appointments
SELECT is_nullable FROM information_schema.columns
 WHERE table_schema='public' AND table_name='appointments' AND column_name='plan_id';
-- esperado: 'YES'

-- 3. Trigger atualizado tem branch particular
SELECT pg_get_functiondef('public.enforce_appointment_preconditions'::regproc)::text
 ILIKE '%plan_id IS NULL%';
-- esperado: TRUE

-- 4. Backfill rodou (se havia receipts no schema legado)
SELECT count(*) FROM public.expense_receipts;
-- esperado: >= count de expenses com receipt_file_url IS NOT NULL

-- 5. RLS ativo
SELECT relrowsecurity FROM pg_class WHERE relname='expense_receipts';
-- esperado: true
```

## Plano de rollback (dev)

Em ordem reversa, **com cuidado**:

```sql
-- Reverte trigger appointments para versao 0024
CREATE OR REPLACE FUNCTION public.enforce_appointment_preconditions() ... -- versao 0015 sem branch particular

-- Reverte plan_id para NOT NULL — SO funciona se nao houver registros NULL.
-- Atendimentos particulares ja criados precisam ser preenchidos com plano sentinela ou
-- estornados antes deste rollback.
ALTER TABLE public.appointments ALTER COLUMN plan_id SET NOT NULL;
ALTER TABLE public.appointments ALTER COLUMN source_price_version_id SET NOT NULL;

DROP TABLE IF EXISTS public.expense_receipts CASCADE;
-- Recriar enforce_expenses_mutation versao 0058 (sem bloqueio de receipt_file_*).
```

Em **prod, nunca rodar** — perda de dados (receipts e atendimentos particulares).

## Migration 0060 (futura, fora deste plan)

Quando confirmado:
1. Frontend ✅ deployado e lendo só de `expense_receipts`.
2. Audit log sem entries de tentativa de write em `expenses.receipt_file_*` por 1 semana.
3. Backup de prod realizado.

```sql
ALTER TABLE public.expenses
  DROP COLUMN IF EXISTS receipt_file_name,
  DROP COLUMN IF EXISTS receipt_file_url,
  DROP COLUMN IF EXISTS receipt_file_size;

CREATE OR REPLACE FUNCTION public.enforce_expenses_mutation() ...; -- remove os 3 campos da lista
```

## Sequência de aplicação em prod

Ordem critical:
1. **Aplicar 0059** no banco (via SQL Editor ou supabase db push).
2. **Deploy do frontend/backend** apontando pra `expense_receipts`. Endpoint singular `/comprovante` removido.
3. **Smoke test**: criar despesa nova, anexar comprovante, listar. Criar atendimento particular, ver badge.
4. **Esperar 1 semana** com monitoramento.
5. **Aplicar 0060** dropando colunas legadas.

Inversão dessa ordem (deploy antes de migration) quebra: `expense_receipts` não existiria e o frontend tentaria ler dela.

## Rotas API removidas (limpar pelo deploy)

- `POST /api/despesas/[id]/comprovante` (singular) — substituída por `comprovantes` (plural).
- `GET /api/despesas/[id]/comprovante`
- `DELETE /api/despesas/[id]/comprovante`

Fora dessas, nenhum endpoint existente quebra.
