# Implementation Plan: Múltiplos comprovantes em despesas + atendimento particular

**Branch**: `006-comprovantes-particular` | **Date**: 2026-04-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-comprovantes-particular/spec.md`

## Summary

Duas frentes consolidadas em uma sprint, ambas tocando o caminho financeiro com cuidado de Princípio I:

1. **Comprovantes 1:N** — nova tabela `expense_receipts` substitui o modelo single-receipt em `expenses` (entregue na sprint anterior, commit `37df456`). Tabela própria com RLS por tenant + soft-delete (Princípio II — auditoria forense). Bucket Supabase Storage `expense-receipts` reutilizado da feature anterior. Backfill em `DO` block migra os ≤ 1 receipts existentes para a nova tabela; colunas legadas em `expenses` ficam **deprecated mas preservadas** (drop em migration futura quando confirmarmos prod limpa).

2. **Atendimento particular** — `appointments.plan_id` deixa de ser `NOT NULL`. Trigger `enforce_appointment_preconditions` (0015) recria-se para pular o lookup em `price_versions` quando `plan_id IS NULL`, exigindo apenas que `frozen_amount_cents > 0`. UI: checkbox "Atendimento particular" em Novo atendimento + Nova etapa, auto-marcado quando o paciente não tem plano (`patients.plan_id IS NULL`) ou o procedimento tem `covered_by_plan = false`. Badge "Particular" propagado em todas as áreas que exibem o atendimento.

Migration única (0059) faz as duas coisas — risco controlado por idempotência (`IF NOT EXISTS`, `ALTER COLUMN ... DROP NOT NULL` é idempotente, `CREATE OR REPLACE FUNCTION`). Drop das colunas legadas em `expenses` fica para 0060 quando prod estiver migrada.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel).
**Primary Dependencies**: Next.js 14.2 (App Router), React 18.3, `@supabase/ssr` 0.5, `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind CSS 3.4, shadcn/ui, `lucide-react`, `date-fns` 4.1.
**Storage**: PostgreSQL via Supabase + Supabase Storage. Tabelas tocadas: `appointments` (ALTER `plan_id` para nullable), `expenses` (3 colunas legadas mantidas até 0060), `audit_log` (uso, sem schema change). Tabelas novas: `expense_receipts`. Bucket: `expense-receipts` (já criado em 0058).
**Testing**: Vitest (`pnpm test`/`test:integration`/`test:contract`). Playwright para fluxos UI principais. Tests de migração para `0059` cobrindo (a) plan_id nullable + trigger novo, (b) backfill receipts.
**Target Platform**: Web (Vercel).
**Project Type**: Web app single-project (Next.js).
**Performance Goals**: SC-003 — clipe + count na lista de despesas em ≤ 50 ms p95 com 200 despesas (count via JOIN agregado, sem N+1). SC-001 — uploads ≤ 10 MB completam em ≤ 5 s em rede normal.
**Constraints**: Princípio I (imutabilidade) — `expenses` continua append-only no row principal; `expense_receipts` é **append + soft-delete** (insert + UPDATE de `deleted_at`/`deleted_by`/`deleted_reason`). Storage objects **nunca são apagados** (auditoria forense). `appointments.plan_id` passa a aceitar NULL; trigger novo valida que `frozen_amount_cents > 0` quando `plan_id IS NULL` para prevenir registros zero-value.
**Scale/Scope**: ~50 despesas/mês × 200 clínicas; ≤ 5 receipts/despesa em média. ~1k atendimentos/mês com fração crescente de particulares. Migration aplica em prod com 0–10 receipts existentes (modelo single-receipt foi muito recente).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                                    | Toca? | Análise                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável**       | Sim   | `expenses` permanece append-only — colunas legadas `receipt_file_*` viram nullable e read-only via column-guard atualizado, drop apenas em 0060. `expense_receipts` é append + soft-delete (UPDATE de campos `deleted_*` permitido apenas para admin via RLS — file_name/storage_path/file_size_bytes ficam imutáveis). `appointments.plan_id` passa a aceitar NULL — atendimentos antigos não são alterados; só novos podem ser criados particular. Storage binário **nunca apagado**. PASS. |
| **II. Auditabilidade Total de Preços**       | Sim   | Upload de comprovante → `audit_log` com `entity='expense_receipts'`, `field='upload'`, `new_value=file_name`. Soft-delete → `field='soft_delete'`, `reason` no campo `reason`. Atendimento particular: o INSERT em `appointments` com `plan_id=NULL` e `frozen_amount_cents` é registrado normalmente pelo audit existente em appointments. PASS.                                                                                                                                             |
| **III. Isolamento Multi-Tenant**             | Sim   | `expense_receipts` herda `tenant_id` por FK direta + RLS espelhada de `expenses`. Bucket `expense-receipts` mantém RLS por `(storage.foldername(name))[1] = tenant_id` (já em 0058). Trigger novo de `appointments` opera no escopo do `tenant_id` da row inserida. PASS.                                                                                                                                                                                                                     |
| **IV. Conformidade TUSS/ANS**                | Não   | Sem mudança em catálogo TUSS. PASS.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **V. Segurança por Perfil de Acesso (RBAC)** | Sim   | Upload (POST) admin/financeiro; soft-delete (DELETE) admin only — alinhado com 0058. Visualização/download (GET) admin/financeiro/recepcionista/profissional_saude. Particular: papéis que já criavam atendimentos (admin/recepcionista) continuam a fazê-lo, agora com a opção de `plan_id=NULL`. PASS.                                                                                                                                                                                      |

**Gates**: Todos passam. Sem violações para registrar em "Complexity Tracking".

## Project Structure

### Documentation (this feature)

```text
specs/006-comprovantes-particular/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 — decisoes
├── data-model.md        # Phase 1 — schema completo da 0059 + sequencia de migracoes
├── quickstart.md
├── contracts/
│   ├── expense-receipts-api.md
│   ├── particular-flow.md
│   └── migration-0059.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── (dashboard)/
│   │   ├── cadastros/
│   │   │   └── despesas/
│   │   │       ├── page.tsx                   # MODIFICA: lista com count, expandir, ReceiptList
│   │   │       ├── new-expense-form.tsx       # MODIFICA: aceita N arquivos no upload inicial
│   │   │       ├── receipt-actions.tsx        # APAGADO (substituido por <ReceiptList>)
│   │   │       └── receipt-list.tsx           # NOVO (client) — lista, +Adicionar, baixar, soft-delete
│   │   └── operacao/
│   │       ├── atendimentos/
│   │       │   └── novo/
│   │       │       └── new-appointment-form.tsx  # MODIFICA: checkbox Particular, auto-detect, plan_id null
│   │       └── pacientes/[id]/
│   │           └── treatment-steps-section.tsx   # MODIFICA: checkbox Particular no NewStepForm
│   └── api/
│       └── despesas/[id]/
│           ├── comprovante/route.ts           # APAGAR (substituido por comprovantes/)
│           └── comprovantes/
│               ├── route.ts                   # NOVO — POST upload, GET listar
│               └── [receiptId]/
│                   ├── route.ts               # NOVO — DELETE soft-delete admin
│                   └── url/route.ts           # NOVO — GET URL assinada
├── lib/
│   └── core/
│       └── expenses/
│           ├── upload-receipt.ts              # MODIFICA: opera em expense_receipts
│           ├── list-receipts.ts               # NOVO
│           └── soft-delete-receipt.ts         # NOVO

supabase/
└── migrations/
    └── 0059_expense_receipts_table_and_particular.sql   # NOVO

tests/
├── integration/
│   ├── expense-receipts.spec.ts               # NOVO — upload N, listar, soft-delete, audit
│   └── particular-appointment.spec.ts         # NOVO — plan_id=null, trigger novo, badge propagado
└── unit/
    └── particular-detection.spec.ts           # NOVO — auto-detect baseado em paciente/procedimento
```

**Structure Decision**: Single Next.js project, App Router. Migration única (0059) consolida os dois domínios — eliminamos risco de estado intermediário. Drop das colunas legadas em `expenses` fica reservado para 0060 num PR separado, depois que confirmarmos prod migrada com sucesso. APAGAR `comprovante/route.ts` (singular) e `receipt-actions.tsx` da feature anterior é parte da entrega.

## Phase 0 — Research

Output em [`research.md`](./research.md). Decisões fechadas (com base no user input):

1. **Tabela separada `expense_receipts` em vez de JSONB array** — JSONB não suporta RLS por elemento, audit individual, soft-delete por arquivo. Tabela permite: GIN index em (expense_id, deleted_at), JOIN agregado para count, `audit_log` referência por `entity_id = receipt.id`.
2. **`appointments.plan_id` nullable + trigger atualizado** — `ALTER COLUMN ... DROP NOT NULL` é idempotente. Trigger `enforce_appointment_preconditions` recria-se com nova lógica:
   - Se `plan_id IS NOT NULL`: comportamento atual (busca em `price_versions`).
   - Se `plan_id IS NULL`: pula price_versions, exige `frozen_amount_cents > 0` (já garantido pelo CHECK existente). `procedures.default_amount_cents` é apenas sugestão na UI; o backend confia no `frozen_amount_cents` do payload (que pode vir de override).
3. **Backfill 1:1 → 1:N**:
   ```sql
   INSERT INTO expense_receipts (tenant_id, expense_id, file_name, storage_path, file_size_bytes, content_type, uploaded_by, uploaded_at)
   SELECT tenant_id, id, receipt_file_name, receipt_file_url, receipt_file_size, 'application/octet-stream', created_by, created_at
   FROM expenses
   WHERE receipt_file_url IS NOT NULL;
   ```
   `content_type='application/octet-stream'` como fallback para registros antigos sem mime. As colunas legadas em `expenses` continuam existindo até 0060 — código novo lê só de `expense_receipts`, mas se algum cliente legado escrever em `expenses.receipt_file_*`, vira no-op (column-guard atualizado).
4. **Soft-delete preserva binário no storage** — confirmado. Coluna `deleted_at TIMESTAMPTZ NULL` na tabela; arquivo no bucket nunca tocado por trigger nem API. Limpeza física é responsabilidade de job futuro com retenção legal (fora do escopo).
5. **Múltiplos arquivos com mesmo nome em uma despesa** — sufixo numérico no path: `tenant/expense/{filename}` → se conflito, `tenant/expense/{base}-1.{ext}`. Verificação via `head` do storage antes do upload. Alternativa rejeitada: apenas mostrar erro — UX ruim.
6. **URL assinada** — 60 segundos (alinhado com 0058). Endpoint `/api/despesas/[id]/comprovantes/[receiptId]/url` retorna `{url, file_name, content_type}`.
7. **Visualizar vs. Baixar** — duas ações distintas no client. Visualizar: `window.open(url, '_blank')`. Baixar: `<a href={url} download={file_name}>` ou fetch + Blob URL com `download` attribute.
8. **Thumbnail de imagens** — preview client-side via `URL.createObjectURL` (na hora do upload) ou via fetch do próprio URL assinado quando o tipo é `image/*`. Sem pipeline server-side de redimensionamento — imagens raramente passam de poucos MB.
9. **Auto-detect particular** — server (`page.tsx` de `/operacao/atendimentos/novo`) carrega `patients.plan_id` quando o paciente já está selecionado (via prop). Para o caso "selecionar paciente e ver checkbox auto-marcar", lógica vai no client component `<NewAppointmentForm>` com `useEffect` em `patientId`. Combina com `procedures.covered_by_plan = false` que **força** marcado.
10. **Badge "Particular"** — propagado em: detalhe atendimento, lista atendimentos, calendário block, step row do plano de tratamento. Renderização condicional baseada em `plan_id === null` ou `priceSource === 'particular'`.

## Phase 1 — Design & Contracts

Outputs em [`data-model.md`](./data-model.md), [`quickstart.md`](./quickstart.md), e [`contracts/`](./contracts/).

### Data model summary

| Entidade               | Mudança                       | Detalhes                                                                                                                                                                                                                                                              |
| ---------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expenses`             | Sem ALTER schema              | Colunas `receipt_file_*` ficam deprecated mas preservadas (0060 dropa). Column-guard atualizado para impedir UPDATE nelas.                                                                                                                                            |
| `expense_receipts`     | NEW TABLE                     | `id, tenant_id, expense_id, file_name, storage_path UNIQUE, file_size_bytes, content_type, uploaded_by, uploaded_at, deleted_at, deleted_by, deleted_reason`. RLS espelhada de `expenses`. Audit trigger AFTER INSERT + AFTER UPDATE WHEN deleted_at became non-null. |
| `appointments`         | ALTER `plan_id DROP NOT NULL` | Trigger 0015 recriado com lógica condicional `IF plan_id IS NOT NULL`.                                                                                                                                                                                                |
| `treatment_plan_steps` | Sem mudança schema            | `plan_id` já é nullable. UI passa a usar checkbox em vez de sentinela `__none__`.                                                                                                                                                                                     |
| `audit_log`            | Sem schema change             | Recebe `entity='expense_receipts'`.                                                                                                                                                                                                                                   |

### Contracts summary

- **`contracts/expense-receipts-api.md`** — endpoints `POST /api/despesas/[id]/comprovantes`, `GET /api/despesas/[id]/comprovantes`, `DELETE /api/despesas/[id]/comprovantes/[receiptId]`, `GET /api/despesas/[id]/comprovantes/[receiptId]/url`. Multipart no POST. Limites: 10 MB, PDF/JPG/PNG. RBAC por endpoint.
- **`contracts/particular-flow.md`** — payload de `POST /api/atendimentos/manual` com `plan_id?: string | null`; payload de `POST /api/pacientes/[id]/etapas` com mesma assinatura. Trigger SQL atualizado: pseudo-código + casos de teste. Auto-detect na UI: matriz `(paciente.plan_id, procedimento.covered_by_plan)` → estado inicial do checkbox.
- **`contracts/migration-0059.md`** — DDL completo da 0059, incluindo (a) CREATE TABLE expense_receipts + RLS + audit + immutability triggers, (b) ALTER appointments + trigger 0015 v2, (c) backfill DO block, (d) column-guard atualizado em expenses. Plano de rollback em dev.

### Quickstart

`quickstart.md`:

1. `git checkout 006-comprovantes-particular`
2. `pnpm install` (sem deps novas)
3. `pnpm supabase start && pnpm supabase:reset`
4. `pnpm supabase:gen-types`
5. Validar manualmente — cadastrar despesa com 3 anexos, expandir, baixar; criar atendimento particular para paciente sem plano (checkbox auto-marcado), ver badge "Particular" no calendário.
6. `pnpm test`, `pnpm test:integration`, `pnpm test:contract`, `pnpm typecheck`, `pnpm lint:auth`.

### Agent context update

Roda `.specify/scripts/powershell/update-agent-context.ps1 -AgentType claude` ao final do plan.

## Re-evaluation post-Phase 1

Re-checagem dos princípios após o desenho:

- **I. Imutabilidade**: `expenses` row continua append-only; `expense_receipts` é append + soft-delete (UPDATE só de `deleted_*`); storage binário nunca apagado; `appointments.plan_id` já é registrado uma vez no INSERT, nullable apenas pra novos. PASS (reconfirmado).
- **II. Auditoria**: Upload + soft-delete em audit_log; appointment com `plan_id=NULL` herda audit existente. PASS.
- **III. Multi-tenant**: RLS em `expense_receipts` com `tenant_id = jwt_tenant_id`; bucket Storage com path `{tenant_id}/...` (já em 0058). PASS.
- **IV. TUSS**: sem mudança. PASS.
- **V. RBAC**: rotas com `requireRole`. PASS.

Sem violações pós-design. Plano aprovado para `/speckit.tasks`.

## Complexity Tracking

> Sem violações de constituição — tabela vazia.

| Violation | Why Needed | Simpler Alternative Rejected Because |
| --------- | ---------- | ------------------------------------ |
| _(none)_  | _(none)_   | _(none)_                             |

## Risk Register (não-constitucional)

1. **Coexistência single-receipt + multi-receipt durante a transição** — código novo lê `expense_receipts`; código legado pode ler `expenses.receipt_file_*` (até deploy). Mitigação: backfill na 0059 garante paridade no momento da apply; column-guard impede novo write nas colunas legadas; deploy do app substitui os caminhos de leitura na mesma janela.
2. **Trigger 0015 recriado** — qualquer regressão na validação de preço afeta criação de atendimento (ponto crítico). Mitigação: teste integração `particular-appointment.spec.ts` cobre os dois caminhos (plan_id null e não-null), incluindo cenário de `price_versions` ausente para combinação inválida.
3. **Backfill encontra row com path duplicado** — improvável dado que a feature anterior era 1:1, mas migration usa `ON CONFLICT DO NOTHING` no INSERT em `expense_receipts` para tolerar.
4. **Cliente legado tenta usar o endpoint singular `/comprovante`** — rota some no deploy. Antes de fazer hard-delete, manter a rota velha redirecionando para a nova por 1 release. Decisão de plan: **delete na mesma migration** (a feature foi muito recente em prod, ninguém depende de URL externa).
5. **Storage RLS já em vigor** — sem mudança no bucket; apenas a tabela auxiliar é nova.
