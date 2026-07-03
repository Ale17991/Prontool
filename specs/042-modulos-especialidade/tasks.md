---
description: 'Task list — Módulos de Especialidade (Convênio, Odontologia, Oftalmologia)'
---

# Tasks: Módulos de Especialidade (Convênio, Odontologia, Oftalmologia)

**Input**: Design documents from `/specs/042-modulos-especialidade/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/modules.md

**Tests**: Incluídos (o projeto tem suíte vitest e há um teste de sidebar que QUEBRA sem atualização; a migração precisa de cobertura de integração). ⚠️ Rodar testes apaga o banco local — re-seedar com `pnpm seed:demo` depois.

**Organization**: Tarefas agrupadas por user story (P1→P3) para entrega incremental.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1=Convênio, US2=Odonto, US3=Oftalmo, US4=Admin toggles

---

## Phase 1: Setup

- [x] T001 Sanity check antes de editar: confirmar que `0162` é o próximo número de migração livre em `supabase/migrations/` e que a feature não introduz novas dependências (ver plan.md). Revisar os 9 pontos de gating em `specs/042-modulos-especialidade/contracts/modules.md` (G1–G9) contra o código atual.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: nenhuma user story pode ser implementada antes desta fase. O catálogo de módulos é a base de todo gating, e `MODULE_LABEL` precisa ser completo (type `Record<ModuleId,string>`) ou o build quebra.

- [x] T002 Atualizar `ModuleId` e `ALL_MODULES` em `src/lib/core/entitlements/plans.ts`: remover `'tiss'`; adicionar `'convenio'`, `'odonto'`, `'oftalmo'`. Conferir que o loop `legacy` (`buildEntitlements`) continua adicionando todos de `ALL_MODULES`.
- [x] T003 [P] Atualizar `MODULE_LABEL` em `src/app/admin/clinicas/[id]/clinic-detail.tsx`: remover `tiss`; adicionar `convenio: 'Convênio'`, `odonto: 'Odontologia'`, `oftalmo: 'Oftalmologia'` (obrigatório para completar o `Record<ModuleId,string>`).
- [x] T004 [P] Criar `supabase/migrations/0162_specialty_modules.sql`: para cada `tenant_entitlements`, renomear `tiss`→`convenio` (dedup) e auto-ativar `convenio`/`odonto`/`oftalmo` pelos sinais de uso real (data-model.md §Sinais): `appointment_procedures.plan_id`/`tenant_tiss_operator_config`/`tiss_guias` → convenio; `dental_chart_entries`/`perio_exams` → odonto; `ophthalmology_exams` → oftalmo. Idempotente e não-destrutiva.
- [x] T005 [P] Verificar que `src/app/admin/actions.ts` (lista `MODULES` derivada de `ALL_MODULES`) e `src/lib/core/entitlements/read.ts` (`getTenantEntitlements`) passam a reconhecer os 3 novos módulos sem ajuste extra; ajustar apenas se algum mapa/descrição de módulo no `/admin` quebrar.

**Checkpoint**: catálogo + rótulos + dados prontos. Build compila. Gating pode começar.

---

## Phase 3: User Story 1 - Convênio (Priority: P1) 🎯 MVP

**Goal**: Clínica com `convenio` OFF não vê NADA de convênio (sidebar, configurações, atendimento, cadastro do paciente).

**Independent Test**: No `/admin`, desligar "Convênio" numa clínica não-legacy e confirmar que TISS, Recebíveis, card Convênios, seletor convênio×particular e o campo de convênio do paciente somem; religar e tudo volta.

- [x] T006 [US1] `src/app/(dashboard)/_components/sidebar-sections.ts`: trocar o gate de "Faturamento TISS" de `ent.hasModule('tiss')` para `ent.hasModule('convenio')` e adicionar `&& ent.hasModule('convenio')` ao item "Recebíveis Convênio".
- [x] T007 [P] [US1] `src/app/(dashboard)/configuracoes/_cards.ts`: no card `convenios`, adicionar `&& ent.hasModule('convenio')` ao predicado `show`.
- [x] T008 [US1] Gatear a integração TISS por `convenio`: esconder o ponto de entrada (card/sub-rota `/configuracoes/integracoes/tiss`) quando OFF e adicionar redirect defensivo na página da integração TISS.
- [x] T009 [US1] `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`: computar `hasConvenio = ent.hasModule('convenio')` (reusando o `ent` já lido para `hasEndocrino`) e passá-lo ao `PatientDetailLayout`/`cadastro`.
- [x] T010 [US1] `src/app/(dashboard)/operacao/pacientes/[id]/_components/cadastro-tab.tsx`: esconder o campo de convênio/plano de saúde do paciente quando `!hasConvenio`.
- [x] T011 [US1] `src/app/(dashboard)/operacao/atendimentos/novo/new-appointment-form.tsx` e `src/app/(dashboard)/operacao/atendimentos/_components/add-procedure-section.tsx`: esconder o seletor convênio×particular / seleção de `plan_id` quando `!hasConvenio` (tratar atendimento como particular). Passar `hasConvenio` a partir do Server Component do atendimento.
- [x] T012 [US1] Atualizar `tests/unit/dashboard-shell-sections.spec.ts`: a matriz de visibilidade reflete "Faturamento TISS" e "Recebíveis Convênio" gateados por `convenio` (e não mais por `tiss`).

**Checkpoint**: US1 funcional e testável de forma independente (MVP).

---

## Phase 4: User Story 2 - Odontologia (Priority: P2)

**Goal**: Clínica com `odonto` OFF não vê a aba "Odonto-Space" no prontuário.

**Independent Test**: Desligar "Odontologia"; abrir um prontuário e confirmar ausência da aba Odonto-Space; acessar `?tab=odontograma` direto cai em aba padrão sem erro; religar e a aba volta.

- [x] T013 [US2] `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`: computar `hasOdonto = ent.hasModule('odonto')` e passá-lo ao `PatientDetailLayout`.
- [x] T014 [US2] `src/app/(dashboard)/operacao/pacientes/[id]/_components/patient-detail-layout.tsx`: receber prop `hasOdonto`; esconder `TabsTrigger`/`TabsContent` `value="odontograma"` quando OFF; ajustar `isValidTab`/`initialTab`/estado inicial para degradar a aba padrão quando `odonto` OFF e a URL pedir `?tab=odontograma`.
- [x] T015 [US2] Verificar e gatear por `odonto` quaisquer atalhos externos para Odonto-Space (ex.: links no quick-view/timeline), se existirem.

**Checkpoint**: US2 funcional independente; US1 intacta.

---

## Phase 5: User Story 3 - Oftalmologia (Priority: P3)

**Goal**: Clínica com `oftalmo` OFF não vê a seção de exames oftalmológicos nem os modelos de laudo.

**Independent Test**: Desligar "Oftalmologia"; confirmar que a seção de exames oftalmológicos some do prontuário e os modelos de laudo somem das Configurações; religar e reaparecem.

- [x] T016 [US3] `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`: computar `hasOftalmo = ent.hasModule('oftalmo')` e passá-lo adiante.
- [x] T017 [US3] `src/app/(dashboard)/operacao/pacientes/[id]/_components/cadastro-tab.tsx` / `…/[id]/ophthal-exam-section.tsx`: renderizar a seção de exames oftalmológicos apenas quando `hasOftalmo`.
- [x] T018 [P] [US3] `src/app/(dashboard)/configuracoes/_cards.ts`: gatear o card de Modelos de Laudo (oftalmológico) por `ent.hasModule('oftalmo')` — `exam_report_templates.exam_type='oftalmologico'` (research R6).

**Checkpoint**: US3 funcional independente; US1/US2 intactas.

---

## Phase 6: User Story 4 - Admin liga/desliga por clínica (Priority: P1)

**Goal**: Super-admin controla "Convênio", "Odontologia", "Oftalmologia" por clínica no `/admin`.

**Independent Test**: Em `/admin/clinicas/[id]`, ver os 3 toggles com rótulos legíveis; alternar e confirmar que a UI da clínica reflete no próximo carregamento.

- [x] T019 [US4] Verificar em `src/app/admin/clinicas/[id]/clinic-detail.tsx` que os 3 módulos aparecem como toggles (via `ALL_MODULES` + `MODULE_LABEL` do T003), que "TISS" não aparece mais como módulo, e que ligar/desligar persiste via `set_tenant_entitlement`. Ajustar qualquer mapa de descrição/ordem de módulo se faltar.

**Checkpoint**: Controle de módulos por clínica operante.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T020 [P] **(DEFERIDO)** Teste de integração da migração em `tests/integration/specialty-modules-migration.spec.ts`. Não escrito nesta sessão: é migração de dados one-shot (já roda no `supabase:reset`, valida sintaxe); catálogo/gating coberto por `tests/unit/specialty-modules.spec.ts` (T021); validação manual via Cenário E do quickstart. Escrever quando o stack local estiver disponível (rodar testes apaga o banco local).
- [x] T021 [P] Testes unit de gating em `tests/unit/`: hub cards (Convênios/Modelos de Laudo escondem com módulo OFF) e `getTenantEntitlements` (reconhece os 3 novos, ignora `tiss` remanescente).
- [x] T022 Rodar `pnpm typecheck`, `pnpm lint` e um build de produção (`next build`); validar os 5 cenários do `quickstart.md`.
- [x] T023 Garantir que o seed de apresentação (`pnpm seed:demo` / `seed:demo-pres`) resulte nos módulos corretos pós-migração (clínica de demo com odonto/perio deve ter `odonto`); atualizar memória/seed se necessário.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende do Setup. **BLOQUEIA** todas as stories (T002/T003 ou o build quebra; T004 é a migração de dados).
- **US1/US2/US3/US4 (Phase 3–6)**: dependem do Foundational. Podem ser feitas em paralelo por pessoas diferentes, respeitando o acoplamento de arquivo abaixo.
- **Polish (Phase 7)**: depois das stories desejadas.

### User Story Dependencies

- **US1 (P1)** — MVP. Independente após Foundational.
- **US2 (P2)** e **US3 (P3)** — independentes entre si; ambas tocam `pacientes/[id]/page.tsx` (computar flags) e US3+US1 tocam `cadastro-tab.tsx`. Edições no mesmo arquivo são sequenciais, não paralelas.
- **US4 (P1)** — substância (rótulos) já entregue no Foundational (T003); aqui é verificação.

### Arquivos compartilhados (evitar [P] entre si)

- `pacientes/[id]/page.tsx`: T009 (US1), T013 (US2), T016 (US3) — sequenciar.
- `_components/cadastro-tab.tsx`: T010 (US1), T017 (US3) — sequenciar.
- `_cards.ts`: T007 (US1), T018 (US3) — sequenciar.

### Parallel Opportunities

- Foundational: T003, T004, T005 em paralelo (arquivos distintos), após/junto de T002.
- US1: T006, T007 podem ir em paralelo entre si; T008–T011 conforme arquivos.
- Polish: T020 e T021 em paralelo.

---

## Implementation Strategy

### MVP First (US1 — Convênio)

1. Phase 1 (Setup) → Phase 2 (Foundational: catálogo + labels + migração).
2. Phase 3 (US1): esconder tudo de convênio.
3. **STOP & VALIDATE**: testar US1 no `/admin` (Cenário A do quickstart). Deploy/demo se ok.

### Incremental Delivery

US1 (convênio) → US2 (odonto) → US3 (oftalmo) → US4 (verificação admin) → Polish (testes + build + quickstart). Cada story agrega valor sem quebrar as anteriores.

---

## Notes

- Padrão de gating = `endocrino` (entitlement no server → prop booleana no client).
- `getTenantEntitlements` é fail-open: erro/ausência de linha = legacy/total. Não esconder área por erro.
- Legacy recebe todos os módulos via `buildEntitlements` — não é afetado pelo gating.
- ⚠️ `vitest run` apaga o banco local; re-seedar com `pnpm seed:demo`.
- Commitar por grupo lógico (ex.: Foundational; depois cada story).
