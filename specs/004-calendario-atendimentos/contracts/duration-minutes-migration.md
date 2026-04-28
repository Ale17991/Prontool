# Contract — Migration 0053 (`duration_minutes` + catalog version)

**Arquivo**: `supabase/migrations/0053_appointments_duration_and_catalog_version.sql`

## SQL

```sql
-- 0053 — Acrescenta duration_minutes em appointments (suporte ao calendario,
-- feature 004) e registra a versao oficial TUSS Tabela 22 v202501 como
-- referencia da reconciliacao odontologica.
--
-- Decisoes:
--   1. duration_minutes e NULLABLE — atendimentos pre-feature-004 ficam NULL
--      e a UI le com COALESCE(.., 30). Preserva Principio I (Imutabilidade
--      Financeira): nenhum UPDATE em registros existentes.
--   2. CHECK 5–480 cobre 99% dos casos clinicos sem permitir valor absurdo.
--   3. INSERT em tuss_catalog_versions e documental — nao acrescenta nem
--      retira nenhum codigo de tuss_codes. Investigacao previa (commit anterior
--      desta branch) confirmou que a Tabela 22 oficial v202501 NAO contem
--      codigos odontologicos com prefixo 88, e tem 370 codigos odonto vs 380
--      da fonte charlesfgarcia/tabelas-ans (atual). Nada falta para importar.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NULL
    CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 480);

COMMENT ON COLUMN public.appointments.duration_minutes IS
  'Duracao em minutos. NULL em registros pre-feature-004; cliente le com COALESCE(., 30). Range 5-480.';

INSERT INTO public.tuss_catalog_versions (source_ref, content_hash, code_count, notes)
VALUES (
  'ans_official_202501',
  'sha256:reference-only-no-code-import',
  5964,
  'TUSS Tabela 22 oficial v202501 - referencia da reconciliacao odontologica (feature 004). 0 codigos importados; ver scripts/tuss-odonto-audit.ts.'
)
ON CONFLICT DO NOTHING;
```

## Asserções pós-migração (testes de contrato)

```sql
-- 1. Coluna existe e e NULLABLE.
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_name = 'appointments' AND column_name = 'duration_minutes';
-- expected: ('duration_minutes', 'YES', 'integer')

-- 2. CHECK constraint ativo.
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.appointments'::regclass
  AND contype = 'c'
  AND pg_get_constraintdef(oid) LIKE '%duration_minutes%';
-- expected: CHECK ((duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 480))

-- 3. tuss_catalog_versions tem a row.
SELECT count(*) FROM public.tuss_catalog_versions WHERE source_ref = 'ans_official_202501';
-- expected: 1

-- 4. Re-rodar a migration nao duplica.
-- (re-aplicar a migration deve ser idempotente; ON CONFLICT DO NOTHING garante)
```

## Reversibilidade (dev)

```sql
ALTER TABLE public.appointments DROP COLUMN IF EXISTS duration_minutes;
DELETE FROM public.tuss_catalog_versions WHERE source_ref = 'ans_official_202501';
```

Em produção: NÃO reverter — coluna NULLABLE não tem custo, e a row em `tuss_catalog_versions` é evidência auditável (Princípio II).

## Impacto em consumidores

| Consumer | Impacto |
|---|---|
| `appointments_effective` (view) | Sem mudança DDL — `SELECT a.*` propaga `duration_minutes` automaticamente. |
| `src/lib/db/generated/types.ts` | Regenerar via `pnpm supabase:gen-types` após aplicar a migration. |
| `src/app/api/atendimentos/manual/route.ts` (POST) | Aceitar `duration_minutes?: number` no body Zod (opcional, default 30 quando ausente). |
| Form "Novo atendimento" | Acrescentar campo "Duração (min)" com default 30. |
| Form de etapa de tratamento | Não acrescenta `duration_minutes` por enquanto (etapas têm seu próprio fluxo). |

## Testes

- **`tests/integration/migration-0053.spec.ts`**: aplicar a migration em DB limpo + DB com dados; verificar que registros antigos têm `duration_minutes IS NULL` e novos podem persistir 30.
