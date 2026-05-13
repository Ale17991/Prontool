# Quickstart — Cadastro de Impostos e Imposto por Convênio (011)

> Passo-a-passo para colocar a feature de pé localmente, aplicar a migration, rodar smoke tests e validar manualmente cada user story.

---

## Pré-requisitos

- Docker rodando (Supabase local). Confirme via `docker ps`.
- Node 20 LTS + `pnpm`.
- Branch atual: `011-cadastro-impostos`.

## Setup inicial

```powershell
# 1) Garante o stack local
pnpm supabase:reset           # aplica todas as migrations, incluindo 0076

# 2) Tipos atualizados (gera Database type com 'taxes', tax_id, tax_rate_bps)
pnpm supabase:gen-types

# 3) Sanity checks
pnpm typecheck
pnpm lint:auth
pnpm test                     # full suite (vai falhar até T-tests serem criados)
```

---

## Validação por user story (smoke)

### US1 — Cadastrar impostos da clínica

1. `pnpm dev` e logue como admin (operations@homio.com.br).
2. Vá em **Análise → Despesas → Impostos** (ou `/analise/despesas/impostos`).
3. Cadastrar:
   - Nome: `ISS`
   - Alíquota: `5,00`
   - Categoria: `Municipal`
4. **Esperado**: linha "ISS — 5,00 % — Municipal — Ativo" aparece na listagem; `audit_log` ganha 1 row (`entity='taxes'`, `field='created'`).
5. Editar a alíquota para `5,50`, salvar. Verificar nova row em audit_log com `field='rate_bps'`, `old='500'`, `new='550'`.
6. Desativar. Status muda para Inativo; tentar criar novo "ISS" → 409 (`TAX_DUPLICATE`) **se** ele continuar não-deletado. Reativar e renomear deveria falhar (DB trigger).
7. Login como `recepcionista`: deve ver listagem, mas não os botões de criar/editar/desativar.

```sql
-- Sanity SQL (rodar no Supabase local)
SELECT id, name, rate_bps, category, is_active FROM public.taxes;
SELECT entity, field, old_value, new_value, reason
  FROM public.audit_log WHERE entity = 'taxes' ORDER BY timestamp_utc DESC LIMIT 10;
```

### US2 — Alíquota do convênio

1. Vá em **Configurações → Convênios**. Clique em "Unimed" (ou crie um).
2. Em `/configuracoes/convenios/[id]`: marcar checkbox "Convênio cobra imposto?". Aparece o campo `Alíquota %`.
3. Preencher `6,50`. Salvar.
4. Recarregar a página — checkbox vem marcada, campo com `6,50`.
5. Desmarcar e salvar → ao recarregar, checkbox vem desmarcada (`tax_rate_bps=0` no banco).
6. **Verificação SQL**:

```sql
SELECT id, name, tax_rate_bps FROM public.health_plans;
SELECT * FROM public.audit_log
  WHERE entity='health_plans' AND field='tax_rate_bps'
  ORDER BY timestamp_utc DESC LIMIT 5;
```

7. Login como `financeiro`: tentar PATCH no plano → 403 (só admin).

### US3 — Vincular despesa a imposto

1. Volte para **Análise → Despesas** (`/analise/despesas`).
2. No formulário "Nova despesa", marcar `Vincular a imposto cadastrado?`.
3. Aparece select com impostos ativos. Selecionar `ISS`. Preencher amount `R$ 250,00`, competência, salvar.
4. **Esperado**: linha aparece na lista com badge `Impostos` e referência a `ISS`. Filtro `?category=impostos` mostra ela.
5. Desativar `ISS`. Voltar para o formulário de nova despesa — `ISS` não está mais no select. Mas a despesa anterior continua mostrando a referência.
6. **Verificação SQL**:

```sql
SELECT id, category, tax_id, amount_cents, description
  FROM public.expenses
  WHERE tax_id IS NOT NULL
  ORDER BY created_at DESC LIMIT 5;

-- DB CHECK: tentativa de criar despesa com tax_id e category != 'impostos'
INSERT INTO public.expenses (
  tenant_id, category, description, amount_cents, competence_date, recurring, created_by, tax_id
) VALUES (
  (SELECT id FROM public.tenants LIMIT 1), 'aluguel', 'invalid',
  100, '2026-05-01', false, '00000000-0000-0000-0000-000000000000',
  (SELECT id FROM public.taxes LIMIT 1)
);
-- Esperado: ERROR: new row for relation "expenses" violates check constraint "expenses_tax_link_requires_impostos_category"
```

### US4 — Relatórios e dashboard

1. Garantir que há ao menos 1 atendimento ativo no período corrente para o convênio "Unimed" (com `tax_rate_bps=650`).
2. Acessar **Análise → Relatórios** (`/analise/relatorios`).
3. **Esperado no card "Receita por plano"**: linha "Unimed" mostra Bruto, "Imposto do convênio" (−), Líquido.
4. **Esperado no card "Impostos"**: total = imposto do convênio + impostos da clínica (= soma das despesas categorizadas como impostos no período).
5. Conferir matemática: para `grossRevenueCents=100000` (R$ 1.000,00) e `bps=650`, `taxFromPlanCents=6500` (R$ 65,00).
6. Excel export: baixar, conferir aba "Impostos" + linha de imposto no resumo por plano.

```sql
-- Sanity SQL: total dos relatórios
SELECT
  SUM(net_amount_cents) AS gross,
  (SELECT COALESCE(SUM(amount_cents),0) FROM public.expenses
    WHERE tenant_id = $tenant AND category='impostos' AND deleted_at IS NULL
      AND competence_date BETWEEN $from AND $to) AS clinic_tax
FROM public.appointments_effective
WHERE tenant_id = $tenant
  AND appointment_at BETWEEN $from AND $to
  AND effective_status='ativo';
```

---

## Rollback (somente dev)

Se precisar reverter:

```sql
-- Em dev
DROP TRIGGER IF EXISTS taxes_audit ON public.taxes;
DROP TRIGGER IF EXISTS taxes_immutable_columns ON public.taxes;
DROP TRIGGER IF EXISTS taxes_no_physical_delete ON public.taxes;
DROP FUNCTION IF EXISTS public.audit_taxes_change();
DROP FUNCTION IF EXISTS public.enforce_taxes_mutation();
DROP TRIGGER IF EXISTS health_plans_tax_rate_audit ON public.health_plans;
DROP FUNCTION IF EXISTS public.audit_health_plan_tax_rate_change();
DROP TRIGGER IF EXISTS expenses_tax_same_tenant ON public.expenses;
DROP FUNCTION IF EXISTS public.enforce_expenses_tax_same_tenant();

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_tax_link_requires_impostos_category;
DROP INDEX IF EXISTS public.expenses_tax_idx;
ALTER TABLE public.expenses DROP COLUMN IF EXISTS tax_id;

ALTER TABLE public.health_plans DROP COLUMN IF EXISTS tax_rate_bps;

DROP TABLE IF EXISTS public.taxes;
```

> **NÃO** aplicar este rollback em ambiente com dados de produção; ferir Constitution "Migrações de banco".

---

## Suítes de teste novas (resumo)

```powershell
pnpm test tests/unit/rate-bps.test.ts                 # bps↔percent helper
pnpm test tests/contract/taxes-immutability.test.ts   # SQL triggers
pnpm test tests/contract/api-impostos-rbac.test.ts    # RBAC matrix
pnpm test:integration                                 # CRUD + report flows
```

---

## Critério de pronto

- [ ] Migration `0076_taxes_and_plan_tax_rate.sql` aplica e remove (em dev) sem erro.
- [ ] `pnpm typecheck` ✅
- [ ] `pnpm lint:auth` ✅ (rotas novas usam `requireRole`)
- [ ] `pnpm test` ✅ (todos os arquivos listados em `plan.md > Project Structure > tests/`)
- [ ] Smoke manual de US1, US2, US3, US4 reproduzível com os passos acima.
- [ ] Auditoria mostra linhas para cada operação esperada.
- [ ] RBAC: recepcionista não consegue editar (403), profissional_saude lê impostos mas não despesas.
- [ ] Excel export e dashboard exibem `Impostos` consolidado.
