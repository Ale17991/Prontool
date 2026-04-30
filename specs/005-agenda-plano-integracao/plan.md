# Implementation Plan: Integração agenda ↔ plano de tratamento + validação de conflito de horário

**Branch**: `005-agenda-plano-integracao` | **Date**: 2026-04-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/005-agenda-plano-integracao/spec.md`

## Summary

Quatro entregas que se sustentam mutuamente:

1. **Constraint de conflito à prova de falhas** — uma tabela auxiliar `appointment_slot_locks` com `EXCLUDE USING gist` é o "veto" autoritativo. Insert no `appointments` dispara o lock automaticamente; estorno libera o lock. EXCLUDE no banco é race-safe nativamente; trigger isolado não é. Decisão herdada do user input.
2. **`appointment_completions` append-only** — substitui o `agendado` derivado-por-tempo da migration 0054 por status explícito. View `appointments_effective` agora joga com 3 sources: reversals (estornado), completions (ativo), nada (agendado).
3. **`treatment_plan_steps.appointment_id`** — link 1:1 opcional. Na criação de etapa nova, transação cria o atendimento primeiro e a etapa apontando pra ele. Triggers bidirecionais sincronizam status (concluído↔completion, cancelado↔reversal).
4. **UX**: campos start/end obrigatórios em ambos os formulários, pré-check de conflito via endpoint, calendário como default por dispositivo (cookie SSR-friendly), conflitos pré-existentes destacados em vermelho no calendário.

A entrega é uma migration grande (0055) + ajustes de domain/API/UI. **Reusa** `duration_minutes` (feature 004) — não cria coluna `appointment_ends_at` separada.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui, `date-fns` 4.1, Pino 9.
**Storage**: PostgreSQL via Supabase. **Nova extensão**: `btree_gist` (no schema `extensions`) para suportar EXCLUDE com `=` em UUIDs + `&&` em `tstzrange`. Tabelas tocadas: `appointments` (sem mudança de colunas — só novos triggers/índices), `appointment_reversals` (apenas leitura por trigger novo), `treatment_plan_steps` (acrescenta `appointment_id` via column-guard relaxado para essa coluna no INSERT). Tabelas novas: `appointment_completions`, `appointment_slot_locks`.
**Testing**: Vitest (`pnpm test`/`test:integration`/`test:contract`). Playwright para E2E. **Teste de carga** (50 POSTs concorrentes) para SC-008 — usa `Promise.all` em script Node.
**Target Platform**: Web (Vercel).
**Project Type**: Web app single-project (Next.js).
**Performance Goals**: SC-002 — verificação de conflito ≤ 100 ms p95. EXCLUDE usa GIST index O(log N), excelente. SC-008 — 50 POSTs concorrentes resultam em 1 sucesso + 49 erros 409, race-free.
**Constraints**: Princípio I (imutabilidade) — `appointments` continua sem UPDATE/DELETE. `appointment_completions` é append-only. `appointment_slot_locks` **permite DELETE** (release de slot ao estornar) — é índice derivado, não registro financeiro. Princípio II — toda mudança de status (completion, reversal) já passa por `audit_log` via triggers existentes. Princípio III — RLS por `tenant_id` em todas as tabelas novas. Princípio V — `requireRole` nas rotas novas.
**Scale/Scope**: ~1k atendimentos/mês por clínica, ~200 clínicas. Esta feature toca: 1 migration grande (0055), 2 tabelas novas, 1 view atualizada, 6 triggers novos, 2 endpoints novos (check-conflict + mark-realized), 4 server functions, 5 componentes UI modificados.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Toca? | Análise |
|---|---|---|
| **I. Integridade Financeira Imutável** | Sim | `appointments` continua intocado (sem UPDATE). `appointment_completions` é append-only. `appointment_slot_locks` permite DELETE — é **derived data** (índice de slots ocupados), não registro financeiro; análogo a um índice de banco. Triggers que sincronizam status no plano operam exclusivamente em `treatment_plan_steps.status`/`completed_at`/`completed_by` (já no whitelist do column-guard). Append-only preservado em todos os registros financeiros. PASS. |
| **II. Auditabilidade Total de Preços** | Sim | `appointment_completions` registra `completed_by`, `completed_at`, `source`. Trigger de audit já existente em `appointments` permanece. Para a tabela nova, criamos audit trigger seguindo o padrão do repo. Status sync (step→appointment, appointment→step) gera entradas pareadas em `audit_log` referenciando entity_id de ambos. PASS. |
| **III. Isolamento Multi-Tenant** | Sim | `appointment_completions` e `appointment_slot_locks` herdam `tenant_id` por FK direta + RLS espelhada de `appointments`. Trigger de slot lock fixa `tenant_id` na inserção. Conflito é por `(tenant_id, doctor_id, range)` — multi-tenant naturalmente isolado. PASS. |
| **IV. Conformidade TUSS/ANS** | Não | Sem mudança em catálogo. `tuss_codes` continua intocado. PASS. |
| **V. Segurança por Perfil de Acesso (RBAC)** | Sim | Rota `/api/atendimentos/[id]/realizado` reusa o gate de `appointment.reverse` (admin + profissional do registro). Endpoint `/api/atendimentos/check-conflict` exige autenticação simples (todos os papéis com leitura podem pré-verificar). Conflito retorna 409 sem vazar dados de outro tenant (RLS no view de busca). PASS. |

**Gates**: Todos passam. Sem violações para registrar em "Complexity Tracking".

## Project Structure

### Documentation (this feature)

```text
specs/005-agenda-plano-integracao/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 — decisões de arquitetura
├── data-model.md        # Phase 1 — schema novo + migration 0055
├── quickstart.md
├── contracts/
│   ├── conflict-exclusion-constraint.md
│   ├── appointment-completion-flow.md
│   └── treatment-step-link.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (dashboard)/
│   │   └── operacao/
│   │       ├── atendimentos/
│   │       │   ├── page.tsx                     # MODIFICA: lê cookie de view default ('cal')
│   │       │   ├── atendimentos-toolbar.tsx     # MODIFICA: write cookie + localStorage on toggle
│   │       │   ├── calendar/
│   │       │   │   └── calendar-block.tsx       # MODIFICA: borda vermelha quando conflict flag
│   │       │   ├── [id]/
│   │       │   │   ├── page.tsx                 # MODIFICA: aviso de conflito + botao "Marcar realizado"
│   │       │   │   └── mark-realized-form.tsx   # NOVO (client)
│   │       │   └── novo/
│   │       │       └── new-appointment-form.tsx # MODIFICA: start_at + end_at obrigatorios + pre-check
│   │       └── pacientes/[id]/
│   │           └── treatment-steps-section.tsx  # MODIFICA: start_time/end_time inputs + pre-check
│   └── api/
│       ├── atendimentos/
│       │   ├── manual/route.ts                  # MODIFICA: aceita start/end, passa para core
│       │   ├── check-conflict/route.ts          # NOVO
│       │   └── [id]/realizado/route.ts          # NOVO (mark realized)
│       └── pacientes/[id]/etapas/
│           ├── route.ts                         # MODIFICA: cria appointment+step na mesma transacao
│           └── [stepId]/route.ts                # MODIFICA: status sync para appointment
├── lib/
│   └── core/
│       └── appointments/
│           ├── check-conflict.ts                # NOVO — query helper, usa GIST index
│           ├── mark-realized.ts                 # NOVO — INSERT em appointment_completions
│           └── create-manual.ts                 # MODIFICA: tenta auto-link a etapa pendente
└── lib/utils/
    └── calendar.ts                              # MODIFICA: helpers para detectar conflicts visuais

supabase/
└── migrations/
    └── 0055_appointment_conflict_and_completion.sql   # NOVO (migration grande)

tests/
├── integration/
│   ├── conflict-exclusion.spec.ts               # NOVO — race + estorno + back-to-back + cross-tenant
│   ├── appointment-completion.spec.ts           # NOVO — view, RPC, status sync
│   └── treatment-step-appointment-link.spec.ts  # NOVO — auto-create + auto-link FIFO + bi-sync
└── unit/
    └── conflict-pre-check.spec.ts               # NOVO — overlap math
```

**Structure Decision**: Single Next.js project, App Router. Migration única (0055) consolida tudo: extensão `btree_gist`, 2 tabelas novas, 1 ALTER TABLE, 6 triggers, 1 RPC pública, view atualizada, RLS, audit. Esta opção minimiza risco de produção (uma migration aplica ou não aplica — sem estado intermediário), aceitando o tamanho.

## Phase 0 — Research

Output em [`research.md`](./research.md). Decisões resolvidas:

1. **Por que `appointment_slot_locks` em vez de EXCLUDE direto em `appointments`** — EXCLUDE não pode usar subquery (`NOT EXISTS reversals`) na cláusula WHERE. Para que estornados liberem o slot, precisamos de uma tabela auxiliar onde DELETE é permitido. Slot lock é índice derivado, não registro financeiro; Princípio I não aplica.
2. **`btree_gist` necessária para EXCLUDE multi-coluna com `=`** — UUID equality + tstzrange overlap exige `btree_gist`. Já validada em ambientes Supabase (extensão padrão).
3. **`tstzrange` semi-aberto `[start, end)`** — back-to-back (14:00–14:30 e 14:30–15:00) não conflita por design.
4. **Recursão de triggers (step↔appointment status sync)** — `pg_trigger_depth() = 1` na entrada do trigger; pula se for re-fire.
5. **Atomicidade de "criar etapa + criar atendimento"** — uma function plpgsql `create_step_with_appointment` faz INSERT em `appointments` (que dispara INSERT em `appointment_slot_locks` via trigger) → INSERT em `treatment_plan_steps` referenciando o appointment.id. Se qualquer um falhar, transação aborta.
6. **Auto-link FIFO** — `create_manual` pega a primeira etapa `WHERE patient_id=… AND procedure_id=… AND status='pendente' AND appointment_id IS NULL ORDER BY created_at LIMIT 1` e seta o appointment_id. UPDATE no campo `appointment_id` exige relaxar o column-guard de `treatment_plan_steps` para permitir set quando `OLD.appointment_id IS NULL` (uma vez setado, vira imutável).
7. **`/api/atendimentos/check-conflict`** — query simples joga `tstzrange && tstzrange` filtrada por tenant + doctor, exclui id passado (para edição) e exclui reversed. Reusa o GIST index criado pela EXCLUDE constraint indireta no slot_locks.
8. **Cookie de preferência de view** — chave `prontool_atendimentos_view`. Server (`page.tsx`) lê via `cookies()` em SSR. Client (`atendimentos-toolbar.tsx`) escreve via `document.cookie` ao alternar. Ambos os lados sincronizados.
9. **Visual conflict no calendário** — `calendar-utils.ts` ganha `detectVisualConflicts(blocks)`: para cada par sobreposto de mesmo doctorId, marca ambos com `conflict=true`. `<CalendarBlock>` aplica borda `ring-2 ring-rose-500` quando flag.
10. **Backfill de etapas legadas** — confirmado: nenhum backfill destrutivo. UI mostra banner "etapa sem horário — agende para aparecer no calendário". Etapa pode ser **completada** (UPDATE em `appointment_id` + `start_at` + `end_at`) via formulário "Agendar agora" — coberto pelo column-guard relaxado para o caso `OLD.appointment_id IS NULL`.

## Phase 1 — Design & Contracts

Outputs em [`data-model.md`](./data-model.md), [`quickstart.md`](./quickstart.md), e [`contracts/`](./contracts/).

### Data model summary

| Entidade | Mudança | Detalhes |
|---|---|---|
| `appointments` | sem ALTER TABLE | continua exatamente como está. Novos triggers e índices em volta. |
| `appointment_completions` | NEW TABLE | `id UUID PK, tenant_id UUID FK, appointment_id UUID FK UNIQUE, completed_at TIMESTAMPTZ NOT NULL DEFAULT now(), completed_by UUID, source TEXT CHECK ('plan_step', 'manual'), reason TEXT`. Append-only (UPDATE/DELETE bloqueados). RLS por `tenant_id`. Audit trigger. |
| `appointment_slot_locks` | NEW TABLE | `id UUID PK, tenant_id UUID FK, doctor_id UUID FK, appointment_id UUID FK UNIQUE, slot_range tstzrange NOT NULL`. **EXCLUDE** `(tenant_id WITH =, doctor_id WITH =, slot_range WITH &&)` — o veto autoritativo de conflito. RLS. **Permite DELETE** (via trigger no INSERT em appointment_reversals). Sem audit (índice derivado). |
| `treatment_plan_steps` | ADD COLUMN `appointment_id UUID NULL REFERENCES appointments(id)` | UNIQUE; FK; column-guard relaxado para permitir set quando `OLD.appointment_id IS NULL` (one-shot link). |
| `appointments_effective` (view) | RECREATE | LEFT JOIN com `appointment_completions` adicionado. CASE estornado > ativo (has completion) > agendado. Substitui a heurística de tempo da migration 0054. |

Triggers introduzidos:
- `appointments_create_slot_lock` (AFTER INSERT on appointments) — INSERT em slot_locks. Falha de EXCLUDE propaga e aborta.
- `appointment_reversals_release_slot_lock` (AFTER INSERT on appointment_reversals) — DELETE de slot_locks WHERE appointment_id matches.
- `appointment_completions_audit` (AFTER INSERT) — registra em audit_log.
- `appointment_completions_immutable` (BEFORE UPDATE/DELETE) — RAISE.
- `step_status_sync_to_appointment` (AFTER UPDATE on treatment_plan_steps) — quando `status` muda para `concluido` E `appointment_id IS NOT NULL`, INSERT em completions; quando muda para `cancelado`, INSERT em reversals.
- `appointment_completion_sync_to_step` (AFTER INSERT on appointment_completions) — UPDATE step.status='concluido' WHERE appointment_id matches.
- `appointment_reversal_sync_to_step` (AFTER INSERT on appointment_reversals) — UPDATE step.status='cancelado' WHERE appointment_id matches.

Todos os triggers de sincronização verificam `pg_trigger_depth() = 1` para evitar loop.

### Contracts summary

- **`contracts/conflict-exclusion-constraint.md`** — DDL completo da `appointment_slot_locks`, dos triggers `create_slot_lock`/`release_slot_lock`, e do índice GIST. Cenários de teste de race (50 POSTs concorrentes), back-to-back, cross-tenant, estorno+rebooking.
- **`contracts/appointment-completion-flow.md`** — schema de `appointment_completions`, função `mark_appointment_realized(appointment_id, by, reason)`, view atualizada, sequência de triggers para sincronização. Inclui shape de resposta da rota `/api/atendimentos/[id]/realizado`.
- **`contracts/treatment-step-link.md`** — função `create_step_with_appointment(...)` plpgsql, payload do POST `/api/pacientes/[id]/etapas` com novos campos `start_time`/`end_time`, fluxo de auto-link FIFO em `create_manual`, comportamento da UI quando há conflito (mostra mensagem do banco).

### Quickstart

`quickstart.md` cobre:
1. `git checkout 005-agenda-plano-integracao`
2. `pnpm install` (sem deps novas — `btree_gist` é extensão Postgres)
3. `pnpm supabase start` + `pnpm supabase:reset` (aplica 0055)
4. `pnpm supabase:gen-types`
5. Testar manualmente o fluxo: criar etapa com horário → ver no calendário → tentar criar atendimento conflitante → ver erro 409 → estornar atendimento → tentar reagendar mesmo horário → sucesso.
6. Rodar `pnpm test`, `pnpm test:integration`, `pnpm test:contract`.
7. Teste de carga manual: script `tsx scripts/bench-conflict.ts` faz 50 POSTs simultâneos no mesmo slot e verifica 1 sucesso + 49 erros.

### Agent context update

Roda `.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude` ao final do plan para que o `CLAUDE.md` raiz absorva: nova extensão `btree_gist`, novas tabelas, novo endpoint `/api/atendimentos/check-conflict`, função `mark_appointment_realized`.

## Re-evaluation post-Phase 1

Re-checagem dos princípios após o desenho detalhado:

- **I. Imutabilidade**: `appointments` e `appointment_reversals` continuam intocados. `appointment_completions` é append-only por design. `appointment_slot_locks` aceita DELETE — derived data, não financeiro. PASS (reconfirmado).
- **II. Auditoria**: completions e step status sync produzem audit_log. Reversals já produziam. PASS.
- **III. Multi-tenant**: RLS espelhada de appointments em ambas as tabelas novas. Constraint EXCLUDE inclui `tenant_id WITH =`. PASS.
- **IV. TUSS**: sem mudança. PASS.
- **V. RBAC**: rotas novas têm `requireRole`. PASS.

Sem violações pós-design. Plano aprovado para `/speckit.tasks`.

## Complexity Tracking

> Sem violações de constituição — tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_ | _(none)_ | _(none)_ |

## Risk Register (não-constitucional)

Riscos não cobertos pelos gates da constituição mas dignos de monitoramento:

1. **Migration 0055 grande** — uma única migration cria 2 tabelas, ALTER em uma terceira, 6 triggers, view recreate, e habilita `btree_gist`. Mitigação: a migration usa `IF NOT EXISTS` em tudo aplicável e pode ser parcialmente revertida em dev. Em prod, é apply-only. Plano de rollback: SQL inverso documentado em `data-model.md` (DROP em ordem reversa).
2. **Loops de triggers** — sincronização bidirecional step↔appointment tem potencial de recursão. Mitigado por `pg_trigger_depth()` em cada trigger; teste de integração específico cobre o cenário.
3. **Performance da EXCLUDE em alta carga** — GIST + btree_gist é eficiente, mas não testado nesse volume. SC-008 (50 concorrentes) é o gate; resultado serve de baseline.
4. **Etapas legadas (sem appointment_id)** — bloqueadas do calendário até receberem agendamento. UX: banner persistente. Risco baixo de estranhamento para o usuário; mitigado por mensagem clara.
5. **`appointment_at` em UTC vs. fuso da clínica** — toda comparação de range é em UTC; UI converte. Já é a prática vigente, mas merece teste explícito de boundary (00:00 local = 03:00 UTC no Brasil).
