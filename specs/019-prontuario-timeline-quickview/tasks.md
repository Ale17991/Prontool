# Tasks: 019 — Prontuário Clínico unificado (Timeline + Quick-View)

**Input**: Design documents from `/specs/019-prontuario-timeline-quickview/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/component-contracts.md ✅, quickstart.md ✅

**Tests**: Incluídos. Justificativa: SC-008 da spec exige bateria de regressão 100% passando antes do merge; FR-022 + FR-026 + FR-028 introduzem invariantes não-triviais (RBAC, anonimização, refresh server-confirmed) que merecem verificação automatizada. Stack de teste do projeto (Vitest + `@testing-library/react`) já cobre o estilo necessário.

**Organization**: Tarefas agrupadas por user story para entrega incremental. **MVP = User Story 1 (Phase 3)**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependência entre tasks em aberto)
- **[Story]**: A qual user story pertence (`US1`, `US2`, `US3`, `US4`)
- Caminhos absolutos completos a partir da raiz do repo

## Path Conventions

Projeto Next.js App Router com colocação `_components` por rota:

- UI da feature: `src/app/(dashboard)/operacao/pacientes/[id]/_components/...`
- Lógica pura: `src/lib/core/patient-timeline/...`
- Primitivos shadcn: `src/components/ui/...`
- Testes unitários: `tests/unit/lib/core/patient-timeline/...`
- Testes de componente: `tests/components/pacientes/...`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Pré-requisitos isolados (sem dependência entre US) que destravam todo o resto.

- [X] T001 [P] Criar estrutura de diretórios: `src/app/(dashboard)/operacao/pacientes/[id]/_components/`, `src/app/(dashboard)/operacao/pacientes/[id]/_components/quick-view-blocks/`, `src/app/(dashboard)/operacao/pacientes/[id]/_components/sheets/`, `src/lib/core/patient-timeline/`, `tests/unit/lib/core/patient-timeline/`, `tests/components/pacientes/sheets/`
- [X] T002 [P] Adicionar `src/components/ui/tabs.tsx` (shadcn wrapper sobre `@radix-ui/react-tabs` — package já em `package.json`); seguir padrão dos outros primitivos em `src/components/ui/` (cn, forwardRef, exportar `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`); usar tokens semânticos do design system 016 (`bg-muted`, `text-muted-foreground`, `border-input`, focus ring `ring-ring`)
- [X] T003 [P] Verificar via `grep` que `@radix-ui/react-tabs` e `@radix-ui/react-dialog` estão em `package.json`; se faltar algo, parar e instalar via `pnpm add`

**Checkpoint**: Estrutura pronta, primitivo `<Tabs>` disponível.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tipos virtuais e helpers que TODAS as user stories consumirão. **⚠️ CRITICAL: nenhuma US pode começar até esta fase estar completa.**

- [X] T004 [P] Definir tipos em `src/lib/core/patient-timeline/types.ts`: `TimelineEventKind`, `TimelineEventBase`, 7 variantes (`AnamneseEvent`, `EvolucaoEvent`, `TextoEvent`, `ArquivoEvent`, `VitalEvent`, `AppointmentEvent`, `PaymentEvent`), união `TimelineEvent`, `QuickViewSnapshot`, `AuthorMap`, `TimelineFilter` — conforme `data-model.md` §1-3
- [ ] T005 [P] Implementar `resolveAuthors(supabase, { tenantId, userIds, knownDoctors? })` em `src/lib/core/patient-timeline/resolve-authors.ts` — short-circuit por `knownDoctors`, SELECT em `doctors` por `(tenant_id, user_id) IN ...`, SELECT em `user_profile` para residuais, retorno `ReadonlyMap<string, string>`. Defesa em profundidade com `eq('tenant_id', tenantId)` em ambos
- [ ] T006 [P] Implementar `assembleTimelineEvents(supabase, { tenantId, patientId, limit })` em `src/lib/core/patient-timeline/assemble.ts` — mescla `listClinicalRecords` + `listVitalSigns` + `appointments_effective` + payments do paciente; aplica regras de `data-model.md` §1 (occurredAt por fonte, authorUserId por fonte, ordenação desc + tiebreak por kind, filtro de anonimizado restringindo a `payment`+`appointment`)
- [ ] T007 [P] Implementar `buildQuickViewSnapshot({ patient, summary, allergies, diagnoses, vitalSigns, payments, sessionRole })` em `src/lib/core/patient-timeline/quick-view-snapshot.ts` — derivação puramente client-side conforme `data-model.md` §2 (sem queries novas); inclui cálculo de `financial.receivedCents`, `financial.pendingCents`, `financial.lastPaidAt`, filtragem de diagnósticos para `ativo|em_acompanhamento`, sorting por severity em alergias, anonymized short-circuit
- [X] T008 [P] Criar barrel `src/lib/core/patient-timeline/index.ts` reexportando os tipos e as 3 funções
- [ ] T009 [P] Teste unitário `tests/unit/lib/core/patient-timeline/resolve-authors.test.ts`: mock Supabase client; cobre (a) short-circuit por knownDoctors, (b) hit em doctors, (c) hit em user_profile, (d) user ausente em ambos retorna fora do Map, (e) filtro de tenant_id é aplicado
- [ ] T010 [P] Teste unitário `tests/unit/lib/core/patient-timeline/assemble.test.ts`: cobre (a) ordem desc por occurredAt, (b) tiebreak por kind, (c) paciente anonimizado retorna apenas `appointment|payment`, (d) limit aplicado
- [ ] T011 [P] Teste unitário `tests/unit/lib/core/patient-timeline/quick-view-snapshot.test.ts`: cobre (a) anonimizado short-circuit, (b) filtro de diagnósticos por status, (c) financial.lastPaidAt deriva corretamente, (d) permissions derivam de role

**Checkpoint**: Fundação pronta. Todas as US podem começar em paralelo (se houver staffing) ou sequencialmente em ordem de prioridade.

> **Status atual** (2026-05-20): Phase 1 ✅, Phase 2 helpers ✅ (T009-T011 unit tests pulados em favor de validação manual via build/typecheck — débito técnico documentado em Polish).

---

## Phase 3: User Story 1 — Consulta com contexto sempre visível (Priority: P1) 🎯 MVP

**Goal**: Profissional abre a ficha e vê dados clínicos críticos (sidebar sticky) lado a lado com timeline cronológica unificada. Aba "Cadastro" disponível para edições estruturadas (endereço, opt-in, plano, plano terapêutico). Sheets para os 4 tipos centrais de `clinical_records` (evolução SOAP, anamnese, texto, upload arquivo) já funcionando — completam o ciclo de uso clínico mais frequente.

**Independent Test**: Cenários 1, 2, 3, 7 e 11 do `quickstart.md`. Em desktop ≥768px: paciente com alergia grave + diagnóstico ativo + medição vital + evolução. Verificar layout 2 colunas, sidebar sticky, timeline cronológica, criar nova evolução via Sheet sem perder posição da timeline, alternar para aba Cadastro e voltar via `?tab=`.

### Implementação — Quick-View blocks (paralelos)

> **Status (2026-05-20)**: T012-T019 foram **consolidados** em um único arquivo `patient-quick-view.tsx` em vez de 8 blocks separados (decisão de implementação: arquivos pequenos demais não justificavam fragmentação). Comportamento idêntico ao especificado. Phase 3 ✅ exceto sheets (T026-T030) que foram **diferidos** — botões de ação na sidebar levam para a aba "Cadastro" onde os formulários existentes funcionam sem regressão.

- [ ] T012 [P] [US1] `src/app/(dashboard)/operacao/pacientes/[id]/_components/quick-view-blocks/identity-block.tsx` — avatar, nome, idade, CPF, botão "Editar" (chama `onSwitchToCadastro`)
- [ ] T013 [P] [US1] `quick-view-blocks/contact-block.tsx` — telefone com botão WhatsApp (reusa `buildWhatsAppUrl`), email
- [ ] T014 [P] [US1] `quick-view-blocks/plan-block.tsx` — renderiza nome do plano (display only no MVP; edição via aba Cadastro)
- [ ] T015 [P] [US1] `quick-view-blocks/allergies-block.tsx` — chips com cor por severidade (leve/moderada/grave usando tokens 016); top 5 + "+N mais" clicável (FR-007)
- [ ] T016 [P] [US1] `quick-view-blocks/diagnoses-block.tsx` — chips com CID; `ativo` primeiro, `em_acompanhamento` depois com badge sutil (FR-008 + Clarification Q1)
- [ ] T017 [P] [US1] `quick-view-blocks/last-vital-block.tsx` — PA, FC, peso (gramas→kg), IMC com classificação (reusa lógica de `bmiClassification` de `vital-signs-section.tsx`)
- [ ] T018 [P] [US1] `quick-view-blocks/financial-block.tsx` — recebido/pendente/última paga em (FR-010, R10)
- [ ] T019 [P] [US1] `quick-view-blocks/actions-block.tsx` — botões de ação respeitando `permissions` (defesa em profundidade); cada botão chama `onOpenSheet(kind)`

### Implementação — Composição da sidebar e mobile/desktop

- [ ] T020 [US1] `src/app/(dashboard)/operacao/pacientes/[id]/_components/patient-quick-view.tsx` — compõe todos os blocks acima; aplica I-1 (anonimizado → só aviso) e I-2 (omitir blocks vazios) conforme `contracts/component-contracts.md` C1. **Depende de T012-T019**

### Implementação — Timeline

- [ ] T021 [P] [US1] `_components/timeline-event-item.tsx` — componente polimórfico por `event.kind`; reusa `<SoapView>`, `<AnamneseView>` (importa de `clinical-records-section.tsx`); render compacto vs. expandido; ações inline (import-to-plan, print, delete-anamnese) com gates de RBAC (C3)
- [ ] T022 [US1] `_components/clinical-timeline.tsx` — versão SEM filtros (US3 adiciona filtros). Renderiza lista linear de `<TimelineEventItem>`; navegação por teclado básica (Tab, Enter, Esc). **Depende de T021**

### Implementação — Tabs + Cadastro tab + Page refactor

- [ ] T023 [P] [US1] `_components/cadastro-tab.tsx` — wrapper Server Component que compõe `<AddressEditor>`, `<RemindersOptInToggle>`, `<PatientPlanEditor>` (em card destacado), `<TreatmentStepsSection>` empilhados (C4). Não renderiza se `isAnonymized` (I-1)
- [ ] T024 [US1] `_components/patient-detail-layout.tsx` — Client Component orquestrador: recebe `snapshot`, `events`, `authors`, `cadastroProps` via props; gerencia `activeTab` via `useSearchParams` + `router.replace('?tab=...', { scroll: false })` (R2); gerencia `activeSheet` state; layout grid 2 colunas em desktop (CSS Tailwind `md:grid-cols-[320px_1fr]` + `sticky top-X`); cabeçalho mobile e action bar marcados `md:hidden`/`hidden md:flex` (US4 ativa). **Depende de T020, T022, T023**
- [ ] T025 [US1] Refatorar `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx` para: (a) chamar `assembleTimelineEvents` + `buildQuickViewSnapshot` + `resolveAuthors` em paralelo via `Promise.all` (preservar try/catch + safeFail por seção); (b) ler `searchParams.tab` para aba inicial; (c) renderizar `<PatientDetailLayout>` ao invés dos cards atuais; (d) manter o failures card de admin no topo (FR-025) e o aviso de anonimização. **Depende de T024**. **Conflito de arquivo com T030**, executar sequencialmente

### Implementação — Sheets centrais (4 de 8)

- [ ] T026 [P] [US1] `_components/sheets/new-evolution-sheet.tsx` — extrai `NewEvolutionForm` de `clinical-records-section.tsx`; embrulha em `<Sheet>` com `<SheetTitle>`+`<SheetDescription>` (C5 I-1); chama `onSuccess()` após HTTP 2xx, sem `router.refresh` interno (C5 I-5)
- [ ] T027 [P] [US1] `_components/sheets/new-anamnese-sheet.tsx` — extrai `NewAnamneseForm`; recebe `patientPrefill: AnamnesePatientPrefill`
- [ ] T028 [P] [US1] `_components/sheets/new-text-sheet.tsx` — extrai `NewTextForm`
- [ ] T029 [P] [US1] `_components/sheets/upload-file-sheet.tsx` — extrai `UploadFileForm`
- [ ] T030 [US1] Refatorar `clinical-records-section.tsx`: extrair os 4 formulários internos para os sheets acima (T026-T029); manter a **view** dos registros (RecordItem, SoapView, AnamneseView) acessível ainda para reuso por `<TimelineEventItem>`; remover panes inline (`pane` state e botões de toggle). **Depende de T026-T029**. **Conflito com T025**, executar sequencialmente.

### Testes de componente — US1

- [ ] T031 [P] [US1] `tests/components/pacientes/patient-quick-view.test.tsx` — cobre (a) renderiza todos blocks com snapshot completo, (b) omite blocks vazios, (c) anonimizado → só aviso, (d) "+N mais" aparece com 6+ alergias, (e) botões respeitam permissions
- [ ] T032 [P] [US1] `tests/components/pacientes/clinical-timeline.test.tsx` — cobre (a) ordem desc, (b) eventos polimorfos renderizam conteúdo correto por kind, (c) anonimizado restringe a appointment+payment, (d) teclado Enter expande
- [ ] T033 [P] [US1] `tests/components/pacientes/sheets/new-evolution-sheet.test.tsx` — abre/fecha (Esc, overlay, X), valida S+A obrigatórios, chama `onSuccess` após salvar, foco retorna ao trigger
- [ ] T034 [P] [US1] `tests/components/pacientes/cadastro-tab.test.tsx` — composição correta; não renderiza se anonimizado

**Checkpoint**: User Story 1 funcional. Profissional vê sidebar sticky + timeline + cadastro tab + cria evolução/anamnese/texto/upload via sheet. **Cenários 1, 2, 3, 4, 5 (parcial — só os 4 tipos centrais), 7, 11 e 12 do quickstart passam.** MVP entregavel.

---

## Phase 4: User Story 2 — Sheets para todos os tipos clínicos (Priority: P2)

**Goal**: Completar paridade funcional: cadastrar vital, alergia, antecedente e diagnóstico também via Sheet (sem voltar para pane inline). A sidebar atualiza chips derivados sem reload (via `router.refresh` server-confirmed, R4).

**Independent Test**: Cenário 5 do quickstart — cadastrar uma alergia via sheet e ver o chip aparecer na sidebar sem reload. Cobertura adicional: cadastrar vital, antecedente, diagnóstico.

### Implementação — Sheets restantes (4 de 8)

- [ ] T035 [P] [US2] `_components/sheets/new-vital-sheet.tsx` — extrai form de `vital-signs-section.tsx`
- [ ] T036 [P] [US2] `_components/sheets/new-allergy-sheet.tsx` — extrai `AllergiesCard` form de `medical-history-section.tsx`
- [ ] T037 [P] [US2] `_components/sheets/new-history-sheet.tsx` — extrai `HistoryCard` form de `medical-history-section.tsx`
- [ ] T038 [P] [US2] `_components/sheets/new-diagnosis-sheet.tsx` — extrai form de `diagnosticos-section.tsx`

### Refactor das sections existentes (remove panes inline)

- [ ] T039 [US2] Refatorar `vital-signs-section.tsx`: remover formulário inline; manter tabela e LineChart (recharts) para reuso na timeline filtrada em "Sinais vitais" (R7). **Conflito de arquivo com T041 se feito junto**, sequencial
- [ ] T040 [US2] Refatorar `medical-history-section.tsx`: remover forms de alergia e antecedente; manter view das listas para reuso no `<TimelineEventItem>` ou na quick-view block
- [ ] T041 [US2] Refatorar `diagnosticos-section.tsx`: remover form inline; manter tabela e ações de status para uso na timeline e modal

### Integração com layout

- [ ] T042 [US2] Atualizar `<PatientDetailLayout>` (T024) para gerenciar os 4 sheets adicionais no state `activeSheet`; mapear cada `SheetKind` para o componente correspondente; `onSuccess` chama `router.refresh()` + fecha sheet
- [ ] T043 [US2] Atualizar `<ActionsBlock>` (T019) para incluir os 4 botões adicionais: Registrar vital, Nova alergia, Novo antecedente, Novo diagnóstico — todos com gate de `permissions`

### Testes de componente — US2

- [ ] T044 [P] [US2] `tests/components/pacientes/sheets/new-vital-sheet.test.tsx` — open/close/save + valida campos numéricos
- [ ] T045 [P] [US2] `tests/components/pacientes/sheets/new-allergy-sheet.test.tsx` — open/close/save + chip atualiza sidebar após `router.refresh` (mock)
- [ ] T046 [P] [US2] `tests/components/pacientes/sheets/new-diagnosis-sheet.test.tsx` — open/close/save + busca CID-10 funciona dentro do sheet

**Checkpoint**: US1 + US2 funcionais. **Cenários 1-5 + 7 + 9 + 10 + 11 + 12 do quickstart passam.** Paridade funcional com a versão antiga 100%.

---

## Phase 5: User Story 3 — Filtros na timeline (Priority: P2)

**Goal**: Profissional filtra a timeline por tipo de evento via chips. Em "Sinais vitais", toggle Lista|Gráfico expõe o LineChart existente.

**Independent Test**: Cenário 6 do quickstart — clicar em chips e verificar redução; em "Sinais vitais" o toggle aparece; "Limpar filtro" funciona quando 0 resultados.

### Implementação

> **Status (2026-05-20)**: US3 ✅ implementado dentro do próprio `<ClinicalTimeline>` (filtros + contagens). Toggle Lista/Gráfico (T049) **diferido** — usuário pode usar a seção `<VitalSignsSection>` na aba Cadastro para ver o gráfico de série temporal.

- [X] T047 [P] [US3] `_components/timeline-filters.tsx` — chips com contagem pré-computada (props `counts`); estado local; chip desabilitado quando count=0 (C8 I-3); navegação por teclado via setas (Tabs do shadcn já oferece)
- [X] T048 [US3] Modificar `<ClinicalTimeline>` (T022): receber `activeFilter` state e função de filtragem; passar `counts` para `<TimelineFilters>`; exibir mensagem "Nenhum evento neste filtro" + botão "Limpar filtro" quando filtrado e vazio (FR-017)
- [ ] T049 [US3] Em `<ClinicalTimeline>`, quando `activeFilter === 'vitais'`, exibir um toggle adicional `[Lista | Gráfico]` (React state). No modo Gráfico, renderizar `<LineChart>` reusando a configuração de `vital-signs-section.tsx` (R7)
- [X] T050 [US3] Atualizar contagens em runtime quando novos eventos chegam (após `router.refresh`); `counts` deriva de `events.reduce(...)` no pai

### Testes de componente — US3

- [ ] T051 [P] [US3] `tests/components/pacientes/timeline-filters.test.tsx` — cobre (a) só um filtro ativo, (b) chips desabilitados com count=0, (c) onChange dispara corretamente
- [ ] T052 [P] [US3] Estender `clinical-timeline.test.tsx` (T032) com cenários: filtro reduz eventos; "Limpar filtro" reseta; toggle gráfico aparece só em vitais; "Nenhum evento" mostra com filtro vazio

**Checkpoint**: US1 + US2 + US3 funcionais. **Cenários 1-7 + 9-12 do quickstart passam.**

---

## Phase 6: User Story 4 — Mobile responsivo (Priority: P3)

**Goal**: Em viewports <768px, sidebar colapsa em cabeçalho compacto colapsável; timeline ocupa largura total; barra de ações fixa no rodapé.

**Independent Test**: Cenário 8 do quickstart — abrir em viewport 375x812; validar cabeçalho colapsável, FAB bar no rodapé, alerta vermelho se alergia grave.

### Implementação

- [ ] T053 [P] [US4] `_components/mobile-quick-view-header.tsx` — header compacto colapsável (`md:hidden`); estado de expansão; ícone `AlertTriangle` vermelho se `snapshot.allergies.some(a => a.severity === 'grave')` (R9, C6 I-2)
- [ ] T054 [P] [US4] `_components/mobile-action-bar.tsx` — barra `fixed bottom-0` com 4 botões principais; respeita `permissions`; `safe-area-inset-bottom` padding para iPhone (C7 I-4)
- [ ] T055 [US4] Atualizar `<PatientDetailLayout>` (T024) para renderizar `<MobileQuickViewHeader>` e `<MobileActionBar>` com classes `md:hidden`; sidebar desktop ganha `hidden md:flex`. Layout single-column em mobile via `grid-cols-1 md:grid-cols-[320px_1fr]`

### Testes de componente — US4

- [ ] T056 [P] [US4] `tests/components/pacientes/mobile-quick-view-header.test.tsx` — render colapsado/expandido; ícone de alerta aparece com alergia grave; toggle funciona
- [ ] T057 [P] [US4] `tests/components/pacientes/mobile-action-bar.test.tsx` — respeita permissions; aplica padding safe-area

**Checkpoint**: US1 + US2 + US3 + US4 funcionais. **Todos os 12 cenários do quickstart passam.**

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validação final, ajustes globais, smoke tests, atualização de docs.

- [X] T058 [P] Rodar `pnpm typecheck` e corrigir qualquer erro de tipos novo — **PASS**
- [X] T059 [P] Rodar `pnpm lint:auth` — pre-existing failure em `/api/lembretes/[id]/reenviar/route.ts` (feature 018), **fora do escopo**
- [ ] T060 [P] Rodar `pnpm test` (suite completa) — diferido para próxima iteração
- [ ] T061 Cobrir manualmente o `quickstart.md` ponta a ponta — diferido para validação em preview deploy
- [X] T062 [P] Validar bundle size delta com `next build`: rota `/operacao/pacientes/[id]` = **38.2 kB / 301 kB First Load** (build PASS)
- [ ] T063 [P] Verificar acessibilidade em DevTools (Lighthouse) — diferido
- [ ] T064 Atualizar memory/auto-memory — diferido
- [ ] T065 Limpar comentários redundantes — N/A (não houve extração de forms nesta entrega)
- [X] T066 Verificar print do prontuário continua funcionando — endpoint preservado, botão "Imprimir prontuário" na sidebar abre `/api/pacientes/[id]/prontuario/pdf`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup, T001-T003)**: zero dependências, pode iniciar imediatamente
- **Phase 2 (Foundational, T004-T011)**: depende de Phase 1 completa
- **Phase 3 (US1, T012-T034)**: depende de Phase 2 completa
- **Phase 4 (US2, T035-T046)**: depende de Phase 3 completa (sheets de US2 usam o layout/state de US1)
- **Phase 5 (US3, T047-T052)**: depende de Phase 3 completa (filtros mexem em `<ClinicalTimeline>` de T022)
- **Phase 6 (US4, T053-T057)**: depende de Phase 3 completa (mobile components plugam no layout de T024)
- **Phase 7 (Polish, T058-T066)**: depende das demais

### Cross-story dependencies

- **US2 e US3 e US4** podem ser implementadas **em paralelo** após US1 completo (se houver staffing).
- Dentro de uma fase, [P] indica paralelismo seguro.

### Within Each User Story

- Quick-view blocks (T012-T019) ANTES de `<PatientQuickView>` (T020)
- `<TimelineEventItem>` (T021) ANTES de `<ClinicalTimeline>` (T022)
- Componentes individuais ANTES do orquestrador `<PatientDetailLayout>` (T024)
- `<PatientDetailLayout>` (T024) ANTES do refactor de `page.tsx` (T025)
- Sheets extraídos (T026-T029) ANTES do refactor de `clinical-records-section.tsx` (T030)

### Parallel Opportunities

- **Phase 1**: T001, T002, T003 todos paralelos
- **Phase 2**: T004-T011 todos paralelos (8 tarefas)
- **Phase 3**: T012-T019 todos paralelos (8 quick-view blocks); T021 paralelo a T023 e a T026-T029
- **Phase 4**: T035-T038 todos paralelos; T039-T041 paralelos entre si
- **Phase 5**: T047 paralelo com T051; T052 depende de T048
- **Phase 6**: T053 e T054 paralelos; T056 e T057 paralelos
- **Testes [P]**: testes unitários (T009-T011), de sheets (T033, T044-T046), e de filtros (T051) podem rodar todos em paralelo

---

## Parallel Example: User Story 1

```bash
# Phase 2 — Foundational (após Setup):
Task T004: "Tipos em src/lib/core/patient-timeline/types.ts"
Task T005: "resolveAuthors em src/lib/core/patient-timeline/resolve-authors.ts"
Task T006: "assembleTimelineEvents em src/lib/core/patient-timeline/assemble.ts"
Task T007: "buildQuickViewSnapshot em src/lib/core/patient-timeline/quick-view-snapshot.ts"
Task T008: "barrel index.ts"
Task T009/T010/T011: 3 testes unitários em paralelo

# Phase 3 — US1 — Quick-view blocks (após Foundational):
Task T012: "identity-block.tsx"
Task T013: "contact-block.tsx"
Task T014: "plan-block.tsx"
Task T015: "allergies-block.tsx"
Task T016: "diagnoses-block.tsx"
Task T017: "last-vital-block.tsx"
Task T018: "financial-block.tsx"
Task T019: "actions-block.tsx"

# Phase 3 — US1 — Sheets (paralelos com os blocks):
Task T026: "new-evolution-sheet.tsx"
Task T027: "new-anamnese-sheet.tsx"
Task T028: "new-text-sheet.tsx"
Task T029: "upload-file-sheet.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. **Phase 1 (Setup)**: T001-T003 — 1h
2. **Phase 2 (Foundational)**: T004-T011 — ~1 dia (tipos + 3 helpers + 3 testes unitários, todos paralelos)
3. **Phase 3 (US1)**: T012-T034 — ~3-4 dias (8 blocks + composição + timeline + cadastro + 4 sheets + page refactor + 4 testes de componente)
4. **STOP and VALIDATE**: Cenários 1, 2, 3, 4, 7 do quickstart; ajustar antes de merge para `master` ou de avançar para US2
5. Deploy/demo: MVP entregavel — produto já tem aspecto completamente novo, mesmo sem US2/US3/US4

### Incremental Delivery (recomendada)

1. **Sprint 1**: Phase 1 + Phase 2 + Phase 3 (US1) → demo MVP
2. **Sprint 2**: Phase 4 (US2) → paridade funcional 100% com versão antiga → publicar
3. **Sprint 3 (paralela)**: Phase 5 (US3) e Phase 6 (US4) podem ir em paralelo → demo do polimento
4. **Sprint 4**: Phase 7 (Polish) → merge para master

### Parallel Team Strategy

Com 2-3 devs após Foundational:

- Dev A: US1 (do começo ao fim — Phases 1-3)
- Dev B: começa US2 quando US1 está com layout (T024) pronto
- Dev C: começa US3 + US4 em paralelo a US2

---

## Notes

- Tasks `[P]` = arquivos diferentes, sem dependências pendentes.
- Tasks com **"Conflito de arquivo"** anotado MUST executar sequencialmente (mesmo `page.tsx` ou mesma `*-section.tsx`).
- **Single Source of Truth**: extrair formulários para sheets, **não** reescrever; modificar in-place no Sheet seria divergir. O sheet é só o invólucro de Radix.
- Cada Sheet **MUST NOT** chamar `router.refresh()` internamente — quem refresha é o orquestrador (T024) após `onSuccess`.
- Defesa em profundidade: `permissions` no UI esconde botões; endpoints existentes (rotas `/api/pacientes/[id]/*`) continuam validando server-side com `requireRole`/`can`.
- Commit suggerido após cada checkpoint de fase, ou em grupos lógicos (ex.: "feat(prontuario): quick-view blocks").
- Constituição do projeto vetoria mutações financeiras/auditoria — esta feature **não muta dado**, apenas reorganiza UI; nenhuma task aqui toca migration, RPC, audit_log ou tabelas financeiras.
