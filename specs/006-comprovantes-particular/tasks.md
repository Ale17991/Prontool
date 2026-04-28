---

description: "Task list for feature 006 — comprovantes 1:N + atendimento particular"
---

# Tasks: Múltiplos comprovantes em despesas + atendimento particular

**Input**: Design documents from `/specs/006-comprovantes-particular/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos onde plan/research definiu cenários críticos: trigger 0015 v2 (caminhos convênio + particular), upload N arquivos com validação, soft-delete admin com audit, matriz de auto-detect particular. Todos rodam via `pnpm test`/`test:integration`/`test:contract`.

**Organization**: Tasks agrupadas por user story para entrega independente. **MVP recomendado**: US4 (atendimento particular) como primeiro PR — isolado e toca código financeiro crítico.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Paralelizável (arquivos diferentes, sem dependência pendente).
- **[Story]**: User story (US1, US2, US3, US4) — apenas em fases de user story.
- Caminhos relativos à raiz `C:\My project\`.

## Path Conventions

Single Next.js project — `src/`, `tests/`, `supabase/migrations/` na raiz. Detalhes em `plan.md`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirma branch e ambiente local. Nenhuma dependência nova.

- [ ] T001 Confirmar branch `006-comprovantes-particular` ativa (`git branch --show-current`) e working tree limpo.
- [ ] T002 Subir Supabase local (`pnpm supabase start`) — pré-requisito para a migration e testes de integração.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Migration única (0059) consolida o schema das duas user stories P1. Sem ela, nenhuma user story arranca.

**⚠️ CRITICAL**: T003 → T004 → T005 sequenciais. T006 (contract test) depende da migration aplicada.

- [ ] T003 Criar `supabase/migrations/0059_expense_receipts_table_and_particular.sql` consolidando: (a) `CREATE TABLE expense_receipts` + índices + RLS espelhada de `expenses` + GRANT UPDATE só nos 3 campos `deleted_*`; (b) trigger `enforce_expense_receipt_mutability` (BEFORE UPDATE/DELETE — bloqueia DELETE físico, permite só `deleted_*` no UPDATE); (c) trigger `audit_expense_receipt_change` (AFTER INSERT loga `field='upload'`, AFTER UPDATE WHEN soft-delete loga `field='soft_delete'`); (d) `ALTER TABLE appointments ALTER COLUMN plan_id DROP NOT NULL` + idem `source_price_version_id`; (e) `CREATE OR REPLACE FUNCTION enforce_appointment_preconditions()` v2 com branch condicional (pseudocódigo em `data-model.md`); (f) `CREATE OR REPLACE FUNCTION enforce_expenses_mutation()` recriado para bloquear UPDATE em `receipt_file_*`; (g) `REVOKE UPDATE (receipt_file_*)`; (h) `DO $$ ... INSERT INTO expense_receipts SELECT ... FROM expenses WHERE receipt_file_url IS NOT NULL ON CONFLICT (storage_path) DO NOTHING ... $$` (backfill).
- [ ] T004 Aplicar migrations + regenerar tipos: `pnpm supabase migration up && pnpm supabase:gen-types`. Verificar `appointments.Row.plan_id: string | null` em `src/lib/db/generated/types.ts` e existência de `expense_receipts` no schema `Tables`.
- [ ] T005 [P] Contract test em `tests/integration/migration-0059.spec.ts` conforme `contracts/migration-0059.md`: asserta (a) `expense_receipts` existe com colunas + UNIQUE em storage_path, (b) `appointments.plan_id` is_nullable=YES, (c) `pg_get_functiondef(enforce_appointment_preconditions)` contém `plan_id IS NULL`, (d) backfill rodou (count de receipts = count de expenses com receipt_file_url IS NOT NULL no fixture), (e) re-aplicar migration é idempotente.

**Checkpoint**: Foundation pronta — US1 e US4 podem começar em paralelo (US2/US3 esperam US1).

---

## Phase 3: User Story 4 — Checkbox "Atendimento particular" (Priority: P1) 🎯 MVP

**Goal**: Permitir cadastrar atendimento e etapa de plano de tratamento como particular (`plan_id = NULL`), com auto-detect baseado no plano do paciente e na coverage do procedimento. Badge "Particular" propagado em todas as listagens.

**Independent Test**: Após Foundation. Cadastrar atendimento para paciente sem plano → checkbox auto-marcado, valor vem do `default_amount_cents`, registro persistido com `plan_id = NULL`. Badge "Particular" visível em detalhe + lista + calendário. Trigger 0015 v2 aceita o INSERT.

### Tests for User Story 4

- [ ] T006 [P] [US4] Integration test em `tests/integration/particular-appointment.spec.ts` cobrindo `contracts/particular-flow.md` cenários 1–6: (a) INSERT com `plan_id NULL` aceito; (b) INSERT com `plan_id` UUID + price_versions ativa preenche `source_price_version_id`; (c) INSERT com `plan_id NULL + source_price_version_id SET` falha com `APPOINTMENT_PARTICULAR_NO_PRICE_VERSION`; (d) INSERT com `plan_id` UUID sem price_versions falha com `APPOINTMENT_PRICE_MISSING`; (e) TUSS retired check roda nos dois caminhos; (f) RPC `create_step_with_appointment` com `p_plan_id NULL` cria step + appointment vinculados.
- [ ] T007 [P] [US4] Unit test em `tests/unit/particular-detection.spec.ts` cobrindo a matriz `(paciente.plan_id, procedimento.covered_by_plan)` → estado inicial do checkbox conforme tabela em `contracts/particular-flow.md`.

### Implementation for User Story 4

- [ ] T008 [P] [US4] Modificar `src/app/api/atendimentos/manual/route.ts` schema Zod: trocar `plan_id: z.string().uuid()` por `plan_id: z.string().uuid().nullable()`.
- [ ] T009 [P] [US4] Modificar `src/lib/core/appointments/create-manual.ts`: aceitar `planId: string | null` em `CreateManualAppointmentInput`. Quando `planId IS NULL`: pular `resolvePrice` e `commission` (usar `procedure.default_amount_cents` como sugestão; usar `amountCentsOverride` se vier; falhar com `DomainError('PARTICULAR_AMOUNT_REQUIRED', 'Valor particular obrigatorio', { status: 400 })` se nenhum dos dois estiver disponível). Inserir com `plan_id: null, source_price_version_id: null`. Manter caminho atual quando `planId IS NOT NULL`.
- [ ] T010 [P] [US4] Modificar `src/app/api/pacientes/[id]/etapas/route.ts` schema Zod: `health_plan_id: z.string().uuid().nullable()`. Quando null, passa null para o RPC `create_step_with_appointment` (que já aceita após T004).
- [ ] T011 [P] [US4] Modificar `src/lib/core/treatment-steps/create-with-appointment.ts`: aceitar `healthPlanId: string | null`. Quando null, pular `resolvePrice` (calcular via `procedure.default_amount_cents`); validar valor no caller. RPC já aceita `p_plan_id NULL`.
- [ ] T012 [US4] Modificar `src/app/(dashboard)/operacao/atendimentos/novo/new-appointment-form.tsx`: adicionar `<Checkbox>` "Atendimento particular" antes do select de plano. Estado `particular: boolean`. `useEffect` com auto-detect (matriz: paciente sem plano + procedimento `covered_by_plan === false` → forçado true). Override manual via `userOverrode` ref. Quando marcado: select de plano se esconde, valor pré-preenche com `default_amount_cents`. Quando desmarcado: select reaparece, valor via `/api/precos/vigente`. Submit envia `plan_id: particular ? null : planId`.
- [ ] T013 [US4] Modificar `src/app/(dashboard)/operacao/pacientes/[id]/treatment-steps-section.tsx` `NewStepForm`: mesmo checkbox + lógica de T012, eliminando o sentinela `__none__` no select de plano. Submit envia `health_plan_id: particular ? null : healthPlanId`.
- [ ] T014 [P] [US4] Adicionar badge "Particular" em `src/app/(dashboard)/operacao/atendimentos/[id]/page.tsx`: render condicional baseado em `appointment.plan_id === null`.
- [ ] T015 [P] [US4] Adicionar badge "Particular" em `src/app/(dashboard)/operacao/atendimentos/page.tsx` (Lista) — coluna nova ou inline ao lado do Status; usar mesmo render.
- [ ] T016 [P] [US4] Adicionar badge "Particular" em `src/app/(dashboard)/operacao/atendimentos/calendar/calendar-block.tsx`: ícone `DollarSign` ou texto inline na linha do bloco quando `plan_id === null`. Atualizar `AppointmentWeekRow` em `src/lib/core/appointments/list-week.ts` para incluir `planId: string | null` no DTO.
- [ ] T017 [P] [US4] Adicionar badge "Particular" em `src/app/(dashboard)/operacao/pacientes/[id]/treatment-steps-section.tsx` `StepRow`: render condicional em `step.healthPlanId === null`.
- [ ] T018 [US4] Validar acceptance scenarios manualmente conforme `quickstart.md` Casos A–E: paciente sem plano (auto-marcado), com plano (desmarcado), procedimento não coberto (forçado), procedimento sem `default_amount_cents` (aviso + manual obrigatório), nova etapa.

**Checkpoint**: US4 entregue como MVP. Pode parar aqui e ir para produção sem US1/US2/US3.

---

## Phase 4: User Story 1 — Anexar múltiplos comprovantes (Priority: P1)

**Goal**: Substituir o modelo single-receipt por 1:N. Usuário anexa N arquivos a uma despesa, no cadastro inicial ou depois. Validações de tipo e tamanho. Migração 1:1 → 1:N preserva dados existentes.

**Independent Test**: Após Foundation. Cadastrar despesa com 3 anexos (PDF + PDF + JPG) → 3 entries em `expense_receipts`, 3 objetos no Storage. Adicionar mais 1 a despesa existente → 4 entries. Tentar `.docx` ou > 10 MB → rejeitado.

### Tests for User Story 1

- [ ] T019 [P] [US1] Integration test em `tests/integration/expense-receipts.spec.ts` cobrindo `contracts/expense-receipts-api.md` cenários 1–8: upload múltiplo (3 files), mesmo nome (sufixo `-1`), cross-tenant (404), tamanho excedido (413), soft-delete preserva binário no storage, audit log para upload + soft_delete, RBAC financeiro tenta DELETE → 403, recepcionista tenta POST → 403.

### Implementation for User Story 1

- [ ] T020 [P] [US1] Reescrever `src/lib/core/expenses/upload-receipt.ts` para operar em `expense_receipts`: nova função `uploadExpenseReceipt(supabase, { tenantId, expenseId, file, contentType, actorUserId })` valida tipo + tamanho, calcula path único (sufixo `-N` se conflito via SELECT), faz upload no bucket `expense-receipts`, INSERT em `expense_receipts`. Cleanup do storage se INSERT falhar. Re-export como `uploadReceipt` para callers existentes.
- [ ] T021 [P] [US1] Criar `src/lib/core/expenses/list-receipts.ts`: `listReceiptsForExpense(supabase, { tenantId, expenseId, includeDeleted? })` retorna `[{id, fileName, fileSizeBytes, contentType, uploadedAt, uploadedBy, uploadedByLabel}]`. JOIN best-effort com `auth.users` para `uploadedByLabel`.
- [ ] T022 [P] [US1] Criar endpoint `POST /api/despesas/[id]/comprovantes/route.ts` aceitando multipart com 1+ `files`. Loop: chama `uploadExpenseReceipt` para cada. Retorna 201 com array de uploaded ou 207 Multi-Status quando misto. Auth: `requireRole(['admin', 'financeiro'])`.
- [ ] T023 [P] [US1] Criar `GET /api/despesas/[id]/comprovantes/route.ts`: `requireRole(['admin','financeiro','recepcionista','profissional_saude'])` chama `listReceiptsForExpense` retornando `{receipts: [...]}`.
- [ ] T024 [P] [US1] APAGAR endpoint singular legado `src/app/api/despesas/[id]/comprovante/route.ts` (substituído por plural). E `src/app/(dashboard)/cadastros/despesas/receipt-actions.tsx` (substituído por `<ReceiptList>` em T026).
- [ ] T025 [US1] Criar `src/app/(dashboard)/cadastros/despesas/receipt-list.tsx` (client): recebe `expenseId, canWrite, canDelete, initialReceipts`. Mostra lista de receipts (nome + tamanho + uploaded_at + uploaded_by_label). Botão "+ Adicionar comprovante" abre file picker (multi-select); upload imediato para `POST /comprovantes`. Após sucesso, `router.refresh()`.
- [ ] T026 [US1] Modificar `src/app/(dashboard)/cadastros/despesas/page.tsx`: trocar `<ReceiptActions>` por `<ReceiptList>`. Server-side carrega receipts agregados via JOIN: `SELECT expense_id, COUNT(*) FILTER (WHERE deleted_at IS NULL) FROM expense_receipts WHERE expense_id IN (...)`. Mostra ícone de clipe + count na coluna "Comprovantes"; clicar expande mostrando `<ReceiptList>` para a despesa.
- [ ] T027 [US1] Modificar `src/app/(dashboard)/cadastros/despesas/new-expense-form.tsx`: campo `<input type="file" multiple>` aceitando 0+ arquivos. Após POST da despesa, faz `POST /api/despesas/[id]/comprovantes` com todos os arquivos numa chamada. Falha do upload não bloqueia despesa criada — mensagem clara orientando anexar pela lista.
- [ ] T028 [US1] Validar acceptance scenarios conforme `quickstart.md` Feature 1 itens 1–10: cadastrar com 3 anexos, expandir, adicionar mais, mesmo nome (sufixo), tipo não suportado, tamanho excedido.

**Checkpoint**: US1 entregue. US2 e US3 podem arrancar em paralelo agora.

---

## Phase 5: User Story 2 — Visualizar e baixar comprovantes (Priority: P2)

**Goal**: Acabar o ciclo de auditoria: lista mostra contagem; expandir mostra preview com botões "Visualizar" + "Baixar"; URL assinada de 60s.

**Independent Test**: Após US1. Numa despesa com 2 receipts, expandir → ver previews. Clicar "Visualizar" no PDF → nova aba com PDF. Clicar "Baixar" → download. Imagens mostram thumbnail inline.

### Implementation for User Story 2

- [ ] T029 [P] [US2] Criar `GET /api/despesas/[id]/comprovantes/[receiptId]/url/route.ts`: `requireRole(['admin','financeiro','recepcionista','profissional_saude'])`. Lookup do receipt + signed URL de 60s do bucket. Retorna `{url, file_name, content_type}`.
- [ ] T030 [P] [US2] Em `<ReceiptList>` (T025) acrescentar 2 botões por item: "Visualizar" → fetch URL → `window.open(url, '_blank')`; "Baixar" → fetch URL → criar `<a download>` invisível e clicar. Loading state por item via `pending: receiptId | null`.
- [ ] T031 [P] [US2] Suporte a thumbnail em `<ReceiptList>`: quando `content_type` começa com `image/`, fazer fetch da URL assinada e exibir `<img>` 64×64 com `object-cover`. Para PDF, ícone `FileText` da lucide. Fallback `Paperclip` para outros.
- [ ] T032 [US2] Validar manualmente conforme `quickstart.md` Feature 1 itens 4–7: visualizar PDF, baixar JPG, expandir lista mostra preview, contagem correta no clipe.

**Checkpoint**: US2 entregue.

---

## Phase 6: User Story 3 — Soft-delete admin only (Priority: P3)

**Goal**: Admin remove comprovante específico; arquivo binário permanece no storage; audit log registra evento.

**Independent Test**: Após US1. Como admin, clicar lixeira em um item → confirmar → desaparece da lista. Como financeiro, lixeira não aparece. Verificar via SELECT que `deleted_at IS NOT NULL` e que arquivo no storage continua presente.

### Implementation for User Story 3

- [ ] T033 [P] [US3] Criar `src/lib/core/expenses/soft-delete-receipt.ts`: `softDeleteReceipt(supabase, { tenantId, receiptId, actorUserId, reason? })` faz UPDATE setando `deleted_at = now(), deleted_by = actorUserId, deleted_reason = reason`. Falha com `RECEIPT_ALREADY_DELETED` se `deleted_at` já preenchido. **NÃO** chama `storage.remove()`.
- [ ] T034 [P] [US3] Criar `DELETE /api/despesas/[id]/comprovantes/[receiptId]/route.ts`: `requireRole(['admin'])`, body opcional `{reason?: string}`. Chama `softDeleteReceipt`. Retorna 204.
- [ ] T035 [US3] Em `<ReceiptList>` (T025/T030) adicionar botão "Remover" condicional `canDelete`. `confirm()` antes de chamar DELETE. Após sucesso, `router.refresh()`. Mostra erro inline se a chamada falhar.
- [ ] T036 [US3] Validar manualmente conforme `quickstart.md` Feature 1 item 11–13: admin remove (some da lista), audit log tem entry, RBAC bloqueia financeiro/recepcionista de ver botão.

**Checkpoint**: US3 entregue. Feature 1 completa.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Acabamento e validação cruzada. Rodar antes de merge para master.

- [ ] T037 [P] Atualizar `CLAUDE.md` raiz: completar "Recent Changes" com nota sobre `expense_receipts`, ALTER `appointments.plan_id`, trigger `enforce_appointment_preconditions` v2 (branch particular), endpoints `/comprovantes` (plural), badge "Particular" propagado.
- [ ] T038 [P] Rodar suíte completa: `pnpm typecheck && pnpm lint:auth && pnpm test && pnpm test:integration && pnpm test:contract`. Corrigir regressões.
- [ ] T039 [P] Validar SC-003 (clipe + count em ≤ 50 ms p95 com 200 despesas): seed 200 despesas com 0–5 receipts cada, abrir `/cadastros/despesas`, medir tempo de render via Performance API. Se passar do limite, adicionar índice composto em `expense_receipts (expense_id) WHERE deleted_at IS NULL`.
- [ ] T040 Rodar `quickstart.md` ponta-a-ponta como release validation; marcar `checklists/requirements.md` como completo.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001, T002 sem dependência externa.
- **Foundational (Phase 2)**: T003 → T004 → T005 (sequencial). BLOQUEIA todas as user stories.
- **User Stories (Phase 3+)**: Todas dependem de Foundation.
  - **US4 (P1) — MVP**: independente de US1/US2/US3. Pode ir para produção sozinha.
  - **US1 (P1)**: independente de US4. Bloqueia US2 e US3 (que estendem `<ReceiptList>` e o endpoint de upload).
  - **US2 (P2)**: depende de US1.
  - **US3 (P3)**: depende de US1.
- **Polish (Phase 7)**: depende das user stories desejadas.

### User Story Dependencies

- **US4**: depende apenas de Foundation. T008/T009/T010/T011 paralelos (arquivos diferentes). T012/T013 modificam forms — sequenciais entre si dentro do mesmo arquivo, paralelos entre forms diferentes. T014–T017 são render-only paralelos.
- **US1**: depende de Foundation. T020–T024 paralelos (helpers + endpoints + apagar legado). T025/T026 dependem dos helpers. T027 depende de T022 (endpoint plural).
- **US2**: depende de US1 (`<ReceiptList>` precisa existir). T029–T031 paralelos.
- **US3**: depende de US1 (`<ReceiptList>` para botão remover). T033–T034 paralelos.

### Within Each User Story

- Tests podem ser TDD ou paralelo com a implementação.
- Helpers/endpoints antes de componentes UI que os consomem.
- Validação manual ao final.

### Parallel Opportunities

- **Foundation**: T005 paralelo com qualquer trabalho que não toque DB.
- **US4 — implementação**: T008, T009, T010, T011 paralelos (4 arquivos distintos). T014–T017 paralelos (render-only, arquivos distintos).
- **US4 — tests**: T006 e T007 paralelos.
- **US1**: T020, T021, T022, T023, T024 paralelos (helpers + endpoints + cleanup).
- **US2**: T029, T030, T031 paralelos.
- **US3**: T033, T034 paralelos.
- **Polish**: T037, T038, T039 paralelos; T040 sequencial.

---

## Parallel Example: User Story 4 (MVP)

```bash
# Após Foundation (T003-T005), abrir 4 trabalhos em paralelo:
Task: "Modificar /api/atendimentos/manual schema Zod (plan_id nullable)"  # T008
Task: "Modificar create-manual.ts (skip resolvePrice quando null)"         # T009
Task: "Modificar /api/pacientes/[id]/etapas (health_plan_id nullable)"     # T010
Task: "Modificar create-with-appointment.ts (healthPlanId nullable)"       # T011

# Em paralelo, escrever os tests:
Task: "tests/integration/particular-appointment.spec.ts"                   # T006
Task: "tests/unit/particular-detection.spec.ts"                            # T007

# Quando T008-T011 terminarem, T012/T013 (forms) arrancam.
# T014-T017 (badges) podem rodar em paralelo a qualquer hora.
# T018 (validação manual) ao final.
```

---

## Implementation Strategy

### MVP First (User Story 4 Only)

1. Phase 1 (T001-T002): Setup.
2. Phase 2 (T003-T005): Foundation — migration completa.
3. Phase 3 (T006-T018): US4 atendimento particular.
4. **STOP** — validar `quickstart.md` Feature 2 Casos A–E, deployar como MVP.
5. Resultado: clínicas com pacientes particulares cadastram com 1 clique a menos. Trigger 0015 v2 valida tanto convênio quanto particular.

### Incremental Delivery

1. MVP (US4) → deploy → operação testa por 1–2 dias.
2. US1 (comprovantes 1:N) → deploy → financeiro testa upload múltiplo.
3. US2 (visualizar/baixar) → deploy → fluxo de auditoria fechado.
4. US3 (soft-delete admin) → deploy.
5. Polish (Phase 7) → release final da feature.

### Parallel Team Strategy

Com 2+ devs após Foundation:

- **Dev A**: US4 (P1, código financeiro crítico — atenção especial).
- **Dev B**: US1 (P1, mas isolado a despesas — sem risco financeiro).
- **Dev A ou B (ocioso)**: US2 + US3 + Polish.

Coordenação principal: T012 e T028 (ambos modificam `new-appointment-form.tsx`?). Conferir — não conflitam, são features distintas (US4 mexe em plan_id; US1 nem toca esse arquivo).

---

## Notes

- Toda task tem checkbox + ID + (opcional) `[P]` + (em fases de US) `[Story]` + caminho de arquivo.
- Migration 0059 é única e idempotente (`CREATE TABLE IF NOT EXISTS`, `ALTER COLUMN ... DROP NOT NULL`, `CREATE OR REPLACE FUNCTION`, `ON CONFLICT DO NOTHING` no backfill).
- Princípio I (imutabilidade) preservado: `appointments` row imutável (só `plan_id` permitido NULL no INSERT, nunca UPDATE); `expense_receipts` é append + soft-delete (UPDATE só nos 3 campos `deleted_*`); storage **nunca apagado**.
- Princípio II (auditoria): upload + soft-delete entram em `audit_log` via triggers.
- Princípio III: RLS em `expense_receipts` por tenant; bucket Storage com RLS já em 0058.
- Princípio V: POST/DELETE com `requireRole`; matriz de RBAC documentada em `contracts/expense-receipts-api.md`.
- Migration 0060 (drop das colunas legadas em `expenses`) **fora deste tasks.md** — PR separado depois de 1 semana de prod estável.
- Endpoint singular `/comprovante` removido pelo deploy junto com 0059 — feature anterior subiu há ~1 dia, sem clientes externos esperados.
