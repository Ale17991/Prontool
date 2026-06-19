---
description: "Task list — Odontograma Interativo (Módulo Odontológico Fase 1)"
---

# Tasks: Odontograma Interativo (Módulo Odontológico — Fase 1)

**Input**: Design documents from `/specs/039-odontograma-interativo/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: INCLUÍDOS — a Constituição (Princípios III/V + Quality Gates) torna obrigatórios testes de imutabilidade (append-only), isolamento entre tenants e autorização por papel para features multi-tenant/RBAC.

**Organization**: Tarefas agrupadas por user story para implementação e teste independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos distintos, sem dependência pendente)
- **[Story]**: US1 / US2 / US3 (mapeia para spec.md)
- Caminhos de arquivo absolutos a partir da raiz do repo

## Path Conventions

Web app single-app (Next.js App Router): `src/`, `supabase/migrations/`, `tests/` na raiz `C:\My project\`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Estrutura de diretórios da feature.

- [X] T001 [P] Criar diretório de core odontológico `src/lib/core/dental/` (com subpastas `status-catalog/` e `chart/`) e um `index.ts` de barrel vazio
- [X] T002 [P] Criar diretório de UI `src/app/(dashboard)/operacao/pacientes/[id]/_components/odontogram/`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Banco + modelo de domínio que TODAS as stories dependem.

**⚠️ CRITICAL**: Nenhuma user story começa antes desta fase.

- [X] T003 Criar migration `supabase/migrations/0133_odontogram.sql` — header padrão (feature 039, idempotente); tabela global `dental_status_catalog` (id, code UNIQUE, label, color, icon, scope CHECK tooth/face/both, tuss_code_id FK→tuss_codes nullable, sort_order, is_active, is_system, created_at/by, updated_at/by) conforme `data-model.md`
- [X] T004 Na mesma migration `0133`: tabela per-tenant `dental_chart_entries` (id, tenant_id FK, patient_id FK, appointment_id FK nullable, tooth_fdi SMALLINT CHECK conjunto FDI, surface TEXT CHECK enum nullable, status_id FK→catalog, note CHECK ≤2000, recorded_at, created_by, created_at) + índices `(tenant_id,patient_id,tooth_fdi,surface,recorded_at DESC)` e `(tenant_id,appointment_id)`
- [X] T005 Na `0133`: triggers — `enforce_append_only_columns('')` (BEFORE UPDATE/DELETE) em `dental_chart_entries`; consistência de tenant (BEFORE INSERT: patient_id e appointment_id pertencem ao tenant, padrão `appointment_materials`); coerência escopo↔surface (face⇒surface NOT NULL, tooth⇒surface NULL, both⇒qualquer); auditoria AFTER INSERT via `log_audit_event(...,'dental_chart_entries',...)`
- [X] T006 Na `0133`: proteção do catálogo — trigger BEFORE UPDATE impede mudança de `code`; impede DELETE/desativação de linhas `is_system=TRUE`
- [X] T007 Na `0133`: RLS — `dental_status_catalog` SELECT para `authenticated` (global, sem filtro tenant), GRANT SELECT; `dental_chart_entries` SELECT `tenant_id=jwt_tenant_id()`, INSERT com `jwt_role() IN ('admin','profissional_saude')`, GRANT SELECT/INSERT
- [X] T008 Na `0133`: RPC `dental_chart_current(p_tenant_id, p_patient_id)` SECURITY DEFINER (`DISTINCT ON (tooth_fdi,surface) ORDER BY ... recorded_at DESC`, guarda `p_tenant_id=jwt_tenant_id()` quando authenticated), GRANT EXECUTE TO authenticated
- [X] T009 Na `0133`: seed idempotente (`ON CONFLICT (code) DO NOTHING`) dos 10 status padrão da `data-model.md` (`none` is_system + cárie, restauração, selante, fratura, ausente, implante, coroa, extração indicada, canal)
- [X] T010 Aplicar e validar a migration: `pnpm supabase:reset` (aplicou OK; migration renumerada 0133→0134 por colisão) (verificar que sobe sem erro e semeia o catálogo)
- [X] T011 Regerar tipos do banco: `pnpm supabase:gen-types` (dental_status_catalog, dental_chart_entries, dental_chart_current presentes) (atualiza `src/lib/db/generated/types.ts` com as novas tabelas/RPC)
- [X] T012 [P] Criar modelo de domínio `src/lib/core/dental/teeth.ts` — `PERMANENT_TEETH`, `DECIDUOUS_TEETH`, `SURFACES`, `dentitionOf`, `isAnterior`, `assertValidTooth`, `assertValidSurface`

**Checkpoint**: Banco + tipos + domínio prontos — user stories podem começar.

---

## Phase 3: User Story 1 - Registrar e visualizar o estado dentário (Priority: P1) 🎯 MVP

**Goal**: Odontograma SVG interativo na aba do prontuário: paleta + pintar, cor muda na hora, estado atual persiste.

**Independent Test**: Marcar "cárie" na face oclusal do dente 16 e "ausente" no dente 38, recarregar e confirmar persistência + cores (usa o catálogo semeado; não depende da UI admin).

### Tests for User Story 1 ⚠️

- [X] T013 [P] [US1] Teste de contrato append-only em `tests/contract/dental-chart-entries-append-only.test.ts` — UPDATE/DELETE em `dental_chart_entries` falha (42501)
- [X] T014 [P] [US1] Teste de integração de isolamento de tenant em `tests/integration/odontogram-tenant-isolation.test.ts` — RPC/leitura do tenant B não retorna marcações do tenant A
- [X] T015 [P] [US1] Teste de integração RBAC em `tests/integration/odontogram-rbac.test.ts` — `recepcionista` recebe 403 no POST; `admin`/`profissional_saude` conseguem criar
- [X] T016 [P] [US1] Teste de validação em `tests/integration/odontogram-validation.test.ts` — `toothFdi` inválido → 400; status `tooth` com surface → 422; status `face` sem surface → 422

### Implementation for User Story 1

- [X] T017 [P] [US1] `src/lib/core/dental/status-catalog/list.ts` — `listActiveStatuses(supabase)` (somente `is_active`, ordenado por `sort_order`) + DTO
- [X] T018 [P] [US1] `src/lib/core/dental/chart/create-entry.ts` — `createChartEntry(supabase, {tenantId, patientId, toothFdi, surface?, statusId, note?, appointmentId?, actorUserId})`: assert paciente no tenant, valida escopo↔surface contra o status, insert, retorna DTO (padrão `createVitalSigns`)
- [X] T019 [P] [US1] `src/lib/core/dental/chart/list-current.ts` — `listCurrentChart(supabase, {tenantId, patientId})` via RPC `dental_chart_current`, retorna estado atual + DTO
- [X] T020 [US1] `src/app/api/pacientes/[id]/odontograma/route.ts` — GET (`requireRole(['admin','financeiro','profissional_saude'])`: estado atual + catálogo ativo) e POST (`requireRole(['admin','profissional_saude'])`: cria marcação, Zod, `createSupabaseServiceClient`, `toHttpResponse`) conforme `contracts/odontograma-api.md`
- [X] T021 [P] [US1] `src/app/api/dental-status/route.ts` — GET catálogo ativo para `authenticated` (paleta)
- [X] T022 [P] [US1] `src/app/(dashboard)/operacao/pacientes/[id]/_components/odontogram/tooth.tsx` — SVG de 1 dente com 5 faces clicáveis (mesial/distal/oclusal-incisal/vestibular/lingual-palatina), cor por status, `aria-label` (dente+face+status), label oclusal vs incisal por `isAnterior`
- [X] T023 [P] [US1] `src/app/(dashboard)/operacao/pacientes/[id]/_components/odontogram/status-palette.tsx` — paleta de status selecionável, filtrada por escopo do alvo (face: `face|both`; dente: `tooth|both`)
- [X] T024 [US1] `src/app/(dashboard)/operacao/pacientes/[id]/_components/odontogram/odontogram-chart.tsx` (client) — carta dentária com quadrantes FDI, toggle permanente/decídua, modelo "paleta + pintar" com atualização otimista (pinta no clique, POST, reverte em erro)
- [X] T025 [US1] `src/app/(dashboard)/operacao/pacientes/[id]/_components/odontogram/odontogram-tab.tsx` — wrapper server→client (carrega estado atual + catálogo via core, passa ao chart)
- [X] T026 [US1] Integrar a aba **Odontograma** em `src/app/(dashboard)/operacao/pacientes/[id]/_components/patient-detail-layout.tsx` (novo `TabsTrigger`/`TabsContent` junto de Evolução/Clínico/Cadastro)

**Checkpoint**: US1 funcional e testável de forma independente — MVP entregável.

---

## Phase 4: User Story 2 - Administrar o catálogo de status no /admin (Priority: P2)

**Goal**: Super-admin cria/edita/ativa-desativa status no `/admin`; mudanças valem em todas as clínicas sem deploy.

**Independent Test**: Criar status "Selante", desativar "Coroa"; confirmar que "Selante" aparece na paleta e "Coroa" some de novas marcações; usuário não super-admin é bloqueado.

### Tests for User Story 2 ⚠️

- [X] T027 [P] [US2] Teste de contrato em `tests/contract/dental-status-catalog-immutability.test.ts` — PATCH de `code` rejeitado (422); DELETE/desativação de `is_system` rejeitado
- [X] T028 [P] [US2] Teste de integração de gating em `tests/integration/dental-status-admin-access.test.ts` — não super-admin recebe negação em GET/POST/PATCH `/api/admin/dental-status`

### Implementation for User Story 2

- [X] T029 [P] [US2] `src/lib/core/dental/status-catalog/create.ts` — `createStatus(supabase, {...})`: valida slug `code` único, hex color, scope, `tussCodeId` (se presente, `tuss_table='22'`), insert com `created_by`
- [X] T030 [P] [US2] `src/lib/core/dental/status-catalog/update.ts` — `updateStatus(supabase, id, {...})`: campos editáveis (label/color/icon/scope/tussCodeId/sortOrder/isActive), bloqueia mudança de `code` e desativação de `is_system`, grava `updated_by`
- [X] T031 [US2] `src/app/api/admin/dental-status/route.ts` — GET (todos, `requireSuperAdmin`) e POST (criar) conforme `contracts/dental-status-admin-api.md`
- [X] T032 [US2] `src/app/api/admin/dental-status/[id]/route.ts` — PATCH (editar/ativar/desativar, `requireSuperAdmin`)
- [X] T033 [P] [US2] `src/app/admin/catalogo/status-odontologicos/status-form.tsx` (client) — form criar/editar (label, color picker, icon, scope, busca TUSS tabela 22 via `searchTussCatalog`, sortOrder, isActive)
- [X] T034 [P] [US2] `src/app/admin/catalogo/status-odontologicos/status-table.tsx` (client) — tabela do catálogo (ativos + inativos) com ação ativar/desativar/editar
- [X] T035 [US2] `src/app/admin/catalogo/status-odontologicos/page.tsx` — SSR `requireSuperAdmin` + `createSupabaseServiceClient`, lista catálogo, renderiza tabela + form
- [X] T036 [US2] Adicionar entrada de navegação para "Status odontológicos" no hub `/admin/catalogo` (ou layout admin existente)

**Checkpoint**: US1 + US2 funcionam de forma independente.

---

## Phase 5: User Story 3 - Vincular a atendimento e auditar histórico (Priority: P3)

**Goal**: Marcações vinculadas a atendimento + histórico append-only auditado por posição.

**Independent Test**: Registrar marcação a partir de um atendimento; confirmar `audit_log` com ator/horário/status; conferir que histórico por dente lista eventos em ordem.

### Tests for User Story 3 ⚠️

- [X] T037 [P] [US3] Teste de integração de auditoria em `tests/integration/odontogram-audit.test.ts` — INSERT gera linha em `audit_log` (entity `dental_chart_entries`, actor, tenant)
- [X] T038 [P] [US3] Teste de integração de vínculo em `tests/integration/odontogram-appointment-link.test.ts` — `appointmentId` de outro tenant/paciente é rejeitado; vínculo válido persiste

### Implementation for User Story 3

- [X] T039 [P] [US3] `src/lib/core/dental/chart/list-history.ts` — `listChartHistory(supabase, {tenantId, patientId, toothFdi, surface?})` ordenado por `recorded_at DESC` com autor e status
- [X] T040 [US3] `src/app/api/pacientes/[id]/odontograma/historico/route.ts` — GET histórico por posição (`requireRole(['admin','financeiro','profissional_saude'])`)
- [X] T041 [US3] No `odontogram-chart.tsx`: ao abrir um dente/face, exibir popover de histórico (consome `/historico`) e permitir nota opcional ao marcar
- [X] T042 [US3] Propagar contexto de atendimento: quando o odontograma é aberto a partir de um atendimento, enviar `appointmentId` no POST da marcação

**Checkpoint**: Todas as user stories independentemente funcionais.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Acabamento que cruza as stories.

- [X] T043 [P] Alinhar cores do catálogo semeado com o design system (paleta feature 016) em `0133_odontogram.sql` (placeholders → cores oficiais)
- [X] T044 [P] Passe de acessibilidade no SVG (foco por teclado, `role`/`aria-label`, contraste das cores de status)
- [X] T045 Rodar `pnpm lint:auth` (rotas com `requireRole`/`requireSuperAdmin`, sem env direto) e `pnpm typecheck`
- [X] T046 Rodar `tests/` completo (`pnpm test`) e validar os fluxos do `quickstart.md` manualmente (re-seedar `pnpm seed:demo` após testes)
- [X] T047 [P] Documentar o módulo odontológico (entrada nas notas da feature / README de domínio se aplicável) e registrar follow-ups de fase 2 (plano de tratamento, periograma, anexos, gating por entitlement `odonto`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende do Setup; **bloqueia todas as user stories**. Dentro dela: T003→T004→T005/T006/T007/T008/T009 (mesma migration, sequencial) → T010 → T011; T012 [P] pode ser feito em paralelo aos itens de SQL.
- **US1 (Phase 3)**: depende da Foundational. MVP.
- **US2 (Phase 4)**: depende da Foundational; independente da US1 (mas a paleta da US1 consome o catálogo que a US2 administra — ambos já funcionam com o seed).
- **US3 (Phase 5)**: depende da Foundational; estende a UI/rotas da US1.
- **Polish (Phase 6)**: depende das stories desejadas concluídas.

### User Story Dependencies

- **US1 (P1)**: após Foundational. Sem dependência de outras stories.
- **US2 (P2)**: após Foundational. Independente da US1.
- **US3 (P3)**: após Foundational. Reaproveita rotas/UI da US1 (T040–T042 tocam arquivos da US1) — agendar após US1 para evitar conflito de arquivo.

### Within Each User Story

- Testes escritos primeiro e devem FALHAR antes da implementação.
- Core (lib) antes das rotas; rotas antes/junto da UI.

### Parallel Opportunities

- T001, T002 em paralelo (Setup).
- T012 em paralelo com o SQL da migration.
- Testes da US1 (T013–T016) todos [P]; core da US1 T017/T018/T019 [P]; UI T022/T023 [P].
- US2 core T029/T030 [P]; UI T033/T034 [P].
- Com equipe: após Foundational, US1 e US2 podem ser tocadas por devs diferentes em paralelo.

---

## Parallel Example: User Story 1

```bash
# Testes da US1 juntos:
Task: "Append-only test em tests/contract/dental-chart-entries-append-only.test.ts"
Task: "Tenant isolation em tests/integration/odontogram-tenant-isolation.test.ts"
Task: "RBAC em tests/integration/odontogram-rbac.test.ts"
Task: "Validação em tests/integration/odontogram-validation.test.ts"

# Core da US1 juntos:
Task: "status-catalog/list.ts"
Task: "chart/create-entry.ts"
Task: "chart/list-current.ts"
```

---

## Implementation Strategy

### MVP First (apenas US1)

1. Phase 1 (Setup) → 2. Phase 2 (Foundational, CRÍTICA) → 3. Phase 3 (US1) → **PARAR e VALIDAR** o odontograma com o catálogo semeado → demo.

### Incremental Delivery

1. Setup + Foundational → base pronta.
2. US1 → testar → demo (MVP: odontograma funcionando com status padrão).
3. US2 → testar → demo (catálogo administrável no /admin).
4. US3 → testar → demo (vínculo a atendimento + histórico/auditoria).

---

## Notes

- [P] = arquivos distintos, sem dependência pendente.
- Constituição: testes de imutabilidade, isolamento de tenant e RBAC são obrigatórios (já incluídos em T013–T016, T027–T028, T037–T038).
- `pnpm test` apaga o banco local — re-seedar com `pnpm seed:demo` antes de teste manual.
- Catálogo é global (sem tenant_id) — auditoria por `created_by`/`updated_by`, não `audit_log`.
- Fora de escopo (fase 2): plano de tratamento, periograma, anexos de imagem, evolução clínica dedicada, gating por entitlement.
