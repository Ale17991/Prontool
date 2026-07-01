---
description: 'Task list — Permissões granulares por usuário + autonomia de super-admin'
---

# Tasks: Permissões granulares por usuário + autonomia de super-admin

**Input**: Design docs em `/specs/043-permissoes-granulares-admin/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/authz.md

**Tests**: Incluídos — é área de segurança (autorização); `canUser` e isolamento por tenant precisam de cobertura. ⚠️ Rodar testes apaga o banco local — re-seedar com `pnpm seed:demo`.

**Organization**: Tarefas por user story (P1→P3) para entrega incremental.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1=overrides (clínica), US2=usuários no /admin, US3=reset senha, US4=editar clínica, US5=impersonar

---

## Phase 1: Setup

- [x] T001 Sanity: confirmar que `0163` é o próximo número de migração livre e que a feature não adiciona dependências (plan.md). Revisar `contracts/authz.md` (invariantes de segurança) contra o código atual de `requireRole`/`can`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: a camada de autorização é a base de tudo. Nenhuma user story antes desta fase.

- [x] T002 Criar `supabase/migrations/0163_user_permission_overrides.sql`: tabela `user_permission_overrides` (id, tenant_id, user_id, action, effect grant|deny, created_at/by, updated_at) — unique `(tenant_id,user_id,action)`, índice `(tenant_id,user_id)`, RLS por tenant (admin do tenant lê/escreve; service_role full), CHECK em `effect`. Sem backfill.
- [ ] T003 `pnpm supabase:reset` + `pnpm supabase:gen-types` para regenerar os tipos com a nova tabela.
- [x] T004 [P] `src/lib/auth/rbac.ts`: adicionar `PROTECTED_ACTIONS` (`price.write`, `commission.write`, `appointment.reverse`, `audit.read`, `audit.export`), `SENSITIVE_ACTIONS` (demais escritas financeiras/config), e `canUser(role, overrides, action)` (efetivo = MATRIX ∪ grants ∖ denies; deny vence). Manter `can` legado.
- [x] T005 [P] `src/lib/auth/overrides.ts` (novo): tipos `Override`/`Effect`, `getUserOverrides(supabase, tenantId, userId)` e `computeEffective(role, overrides)`.
- [x] T006 Estender a camada autoritativa (`src/lib/auth/require-role*.ts` / helper usado em `/api/*` e server actions): carregar overrides do ATOR (`getUserOverrides`) e autorizar via `canUser`. `can(role, ...)` legado permanece para UI; a checagem de segurança passa a considerar overrides. (Núcleo de segurança — revisar com cuidado.)

**Checkpoint**: autorização com overrides operando server-side; tabela + tipos prontos.

---

## Phase 3: User Story 1 - Overrides por usuário (clínica) (Priority: P1) 🎯 MVP

**Goal**: Admin da clínica concede/revoga ações por usuário (exceto as protegidas), aplicado no servidor.

**Independent Test**: Conceder `finance.view_values` a um recepcionista → passa a ver valores (servidor permite). Revogar `appointment.reverse` de um financeiro → estorno negado mesmo via API direta. Tentar override em ação protegida → bloqueado.

- [x] T007 [US1] `src/lib/core/team/permission-overrides/set.ts` (novo): aplica mudanças de override (grant/deny/inherit) para um usuário; REJEITA ações de `PROTECTED_ACTIONS`; exige ator admin do mesmo tenant (ou super-admin); audita cada mudança (antes/depois, motivo) via `log_audit_event`.
- [x] T008 [P] [US1] `src/lib/core/team/permission-overrides/list.ts` (novo): retorna overrides + efetivo de um usuário (para a UI).
- [x] T009 [US1] `src/app/api/configuracoes/usuarios/[userId]/permissions/route.ts` (novo): `GET` (lista efetivo) e `POST` (aplica mudanças). `requireRole` admin; valida payload (Zod); audita.
- [x] T010 [US1] `src/app/(dashboard)/configuracoes/usuarios/permissions-dialog.tsx` (novo): diálogo por usuário com toggle tri-estado (herdar/conceder/revogar) por ação, agrupado; ações protegidas aparecem desabilitadas/explicadas; ações sensíveis exibem AVISO ao conceder.
- [x] T011 [US1] Ligar a ação "Permissões" no `row-actions-menu.tsx`/`users-panel.tsx` de `/configuracoes/usuarios` abrindo o diálogo.
- [x] T012 [P] [US1] Testes: unit `canUser` (grant adiciona; deny vence papel e grant; `[]`=`can`); integration — endpoint de escrita respeita `deny` via chamada direta à API; tentativa de override em ação protegida é rejeitada.

**Checkpoint**: US1 funcional e testável (MVP do pedido "controlar permissões").

---

## Phase 4: User Story 2 - Super-admin gerencia usuários da clínica (Priority: P2)

**Goal**: Super-admin cria/edita/desativa/troca papel de usuários de qualquer clínica pelo /admin.

**Independent Test**: Pelo /admin, criar admin numa clínica de teste (loga) e trocar papel de outro; último admin protegido.

- [x] T013 [US2] `src/app/admin/clinicas/[id]/actions.ts` (ou admin/actions): ações cross-tenant `adminCreateClinicUser`, `adminSetClinicUserRole`, `adminSetClinicUserStatus` — exigem `superAdminUserId()`, recebem `tenantId` alvo, reusam `createManualUser`/troca-papel/status com escopo do tenant alvo, respeitam `enforce_last_admin`, auditam com `tenant_id` alvo.
- [x] T014 [US2] `src/app/admin/clinicas/[id]/` seção "Usuários": listar usuários da clínica + UI para criar/editar/desativar/trocar papel (reusa diálogos existentes adaptados a tenant alvo).
- [ ] T015 [P] [US2] Integration: ação cross-tenant não afeta outro tenant (isolamento); último admin não pode ser desativado/rebaixado pelo /admin.

**Checkpoint**: US2 independente; US1 intacta.

---

## Phase 5: User Story 3 - Super-admin reseta senha (Priority: P2)

**Goal**: Super-admin dispara reset de senha de qualquer usuário pelo /admin.

**Independent Test**: Disparar reset → e-mail/link gerado; ação auditada; sem expor senha.

- [x] T016 [US3] `adminResetClinicUserPassword(tenantId, userId)`: reusa o fluxo de recuperação (Supabase `resetPasswordForEmail`/`generateLink`), valida super-admin, audita. (Reusar/estender as ações de reset já presentes em `src/app/admin/usuarios/actions.ts`.)
- [x] T017 [US3] Botão "Resetar senha" na seção Usuários do detalhe da clínica (confirmação + feedback).

**Checkpoint**: US3 independente.

---

## Phase 6: User Story 4 - Super-admin edita dados da clínica (Priority: P3)

**Goal**: Super-admin edita nome/CNPJ/contato da clínica pelo /admin.

**Independent Test**: Editar e salvar; CNPJ inválido rejeitado; auditado.

- [x] T018 [US4] `adminUpdateClinicProfile(tenantId, {name, cnpj, phone, ...})`: valida super-admin + CNPJ (helper existente), atualiza `tenant_clinic_profile` (e `tenants.name` se aplicável), audita antes/depois.
- [x] T019 [US4] Seção/form "Dados da clínica" no `clinic-detail.tsx` (campos + validação + feedback).

**Checkpoint**: US4 independente.

---

## Phase 7: User Story 5 - Impersonação read-only (Priority: P3)

**Goal**: Super-admin entra na clínica em modo somente-leitura, com banner e auditoria.

**Independent Test**: Iniciar impersonação → banner; navegar (leitura OK); qualquer escrita negada no servidor; encerrar/expirar → fim auditado.

- [x] T020 [US5] Mecanismo de sessão de impersonação (ex.: cookie assinado com `tenant_id` alvo + expiração) + `adminStartImpersonation(tenantId)`/`adminEndImpersonation()`; auditar início/fim.
- [x] T021 [US5] Guard central server-side: enquanto impersonando, NEGAR toda Action de ESCRITA no tenant alvo (independente do papel), em `requireRole`/handlers. (Invariante read-only.)
- [x] T022 [US5] Banner visível de impersonação no layout do dashboard + botão "Sair da clínica"; entrada pelo `/admin`.
- [ ] T023 [P] [US5] Integration: durante impersonação, uma escrita é negada no servidor; início/fim auditados; expiração encerra.

**Checkpoint**: US5 independente.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T024 [P] Revisar que telas (sidebar/cards/botões) refletem o efetivo (papel + overrides) sem serem o mecanismo de segurança — usar `canUser` nas server pages onde fizer sentido.
- [ ] T025 [P] Cobertura de auditoria: conferir que override/role/CRUD usuário/reset/impersonação e NEGAÇÕES relevantes geram `audit_log` (FR-010/011).
- [ ] T026 Rodar `pnpm typecheck`, `pnpm lint`, `pnpm lint:auth` e build de produção; validar os cenários do `quickstart.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** bloqueia tudo (migração + `canUser` + carga de overrides + wiring de autorização).
- **US1 (3)** depende só do Foundational — é o MVP.
- **US2/US3/US4/US5 (4–7)** dependem do Foundational; reusam helpers de audit/escopo. Tocam o `clinic-detail.tsx` (sequenciar as seções) e `admin actions` (mesma área — sequenciar).
- **Polish (8)** ao final.

### Acoplamento (evitar [P] entre si)

- `src/app/admin/clinicas/[id]/clinic-detail.tsx`: US2 (Usuários), US4 (Dados), US5 (Entrar) — sequenciar.
- `admin actions`: US2, US3, US4, US5 — mesma área; sequenciar.
- `requireRole`/guard: T006 (Foundational) e T021 (US5) — sequenciar.

### Paralelizável

- Foundational: T004, T005 em paralelo (arquivos distintos) após T002/T003.
- US1: T008 e T012 podem ir em paralelo; T007→T009→T010→T011 em sequência lógica.
- Testes de integração (T015/T023) em paralelo com UI da própria story.

---

## Implementation Strategy

### MVP (US1 — overrides)

1. Phase 1 + 2 (autorização + tabela).
2. Phase 3 (US1): conceder/revogar por usuário, enforce server-side.
3. **STOP & VALIDATE** (Cenários A/B/C do quickstart). Deploy/demo.

### Incremental

US1 → US2 (usuários no /admin) → US3 (reset) → US4 (dados clínica) → US5 (impersonar read-only) → Polish. Cada story agrega valor sem quebrar as anteriores.

---

## Notes

- Autorização é SEMPRE server-side; UI reflete, não protege (constituição V).
- Ações protegidas (`price.write`, `commission.write`, `appointment.reverse`, `audit.read/export`) são NÃO-overridáveis.
- Toda ação cross-tenant valida `superAdminUserId()` + escopo do tenant alvo e audita com o tenant alvo.
- ⚠️ `vitest run` apaga o banco local; re-seedar com `pnpm seed:demo`. Commit por grupo lógico.
