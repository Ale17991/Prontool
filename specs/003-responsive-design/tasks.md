---
description: 'Task list for Responsividade total (mobile, tablet e desktop)'
---

# Tasks: Responsividade total (mobile, tablet e desktop)

**Input**: Design documents from `/specs/003-responsive-design/`
**Prerequisites**: plan.md, spec.md, research.md, quickstart.md

**Tests**: Sim — testes solicitados explicitamente no plan (Playwright snapshots @1280×720 + smoke flow não-regressão).

**Organization**: Tasks agrupados por user story para entrega incremental e teste independente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos diferentes, sem dependências de tasks incompletas)
- **[Story]**: A qual user story o task pertence (US1/US2/US3)
- Caminhos de arquivo absolutos relativos à raiz do repositório

## Path Conventions

- **Web app (Next.js)**: `src/` na raiz, `tests/` na raiz
- Mudanças concentradas em `src/app/(dashboard)/_components/` e `src/components/ui/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Adicionar dependência de UI nova e capturar baseline visual antes de qualquer mudança.

- [ ] T001 Capturar screenshots baseline em `tests/e2e/__screenshots__/baseline/` rodando o sistema em viewport 1280×720 nas 4 páginas-chave (login, lista de pacientes, ficha de paciente, dashboard financeira) — sem alterar código. Esses screenshots viram o oracle de regressão.
- [x] T002 [P] Adicionar `Sheet` do shadcn/ui em `src/components/ui/sheet.tsx` (cópia do registry shadcn — `sheet.tsx` é built on `@radix-ui/react-dialog`, sem precisar instalar pacote novo já que `@radix-ui/react-dialog` está nas dependencies via Dialog).
- [x] T003 [P] Verificar `tailwind.config.ts` tem as animations `accordion-down`, `slide-in-from-left`, `fade-in`, `fade-out` necessárias para o Sheet (provavelmente já existem via shadcn) — se faltar, adicionar.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Refactor do Dialog base e da Table base — propagam para todos os modais e tabelas existentes sem precisar tocar em cada caller.

**⚠️ CRITICAL**: Phase 2 desbloqueia US2 (modais responsivos) sem precisar tocar em cada modal individual. Phase 3+ pode começar em paralelo após Phase 2.

- [x] T004 [P] Atualizar `src/components/ui/dialog.tsx` — `DialogContent` ganha `max-h-[90dvh] overflow-y-auto` e padding muda de `p-6` para `p-4 sm:p-6`. Verificar visualmente que os 5 modais existentes (cleanup-button, print-chart-button, RecordPaymentDialog do financeiro-section, SOAP form é inline-não-modal) continuam funcionando em viewport 1280px (zero regressão visual via Playwright em T020).
- [x] T005 [P] Atualizar `src/components/ui/table.tsx` — wrapper externo ganha `position: relative` e dois pseudo-elementos com `linear-gradient` na borda esquerda e direita (CSS-only, via `before:` e `after:` Tailwind classes), `pointer-events-none`. Gradient sempre visível quando há overflow horizontal (sem listener JS por simplicidade — pode ser refinado depois).

**Checkpoint**: Após Phase 2, qualquer modal que abrir em mobile/tablet com conteúdo alto vai scrollar internamente. Qualquer tabela com scroll horizontal mostra indicador visual.

---

## Phase 3: User Story 1 — Recepcionista cadastra paciente pelo celular (Priority: P1) 🎯 MVP

**Goal**: App utilizável em viewport 360px. Sidebar vira drawer off-canvas. Tab bar com overflow-x. Padding reduzido em mobile.

**Independent Test**: Em DevTools com viewport 375×667 (iPhone SE), logar como recepcionista, navegar até /operacao/pacientes/novo, preencher e salvar paciente. Sucesso: paciente criado, sem zoom manual, sem campos sobrepostos pela navegação.

### Implementation for User Story 1

- [x] T006 [US1] Em `src/app/(dashboard)/_components/dashboard-shell.tsx`, importar Sheet, SheetContent, SheetTitle, SheetTrigger de `@/components/ui/sheet`. Adicionar `Menu` de `lucide-react` e estado local `const [drawerOpen, setDrawerOpen] = useState(false)`.
- [x] T007 [US1] Em `dashboard-shell.tsx`, transformar `<aside class="z-20 flex w-64 shrink-0 ...">` em condicional: em viewport ≥md, manter como sidebar fixa atual (`hidden md:flex`); em <md, esconder e usar Sheet com `<SheetContent side="left" className="w-72 max-w-[80vw] bg-slate-900 p-6">`. O conteúdo da nav (categorias, divider, link Configurações, integrations badge, user pill) é o MESMO em ambos — extrair em sub-componente `<SidebarInner>` para não duplicar.
- [x] T008 [US1] Em `dashboard-shell.tsx`, adicionar botão hamburger no `<header>` antes do título: `<button className="md:hidden ..." onClick={() => setDrawerOpen(true)} aria-label="Abrir menu"><Menu className="h-5 w-5" /></button>`. Sheet é controlado por `open={drawerOpen} onOpenChange={setDrawerOpen}`.
- [x] T009 [US1] Em `dashboard-shell.tsx`, no `<SidebarLink>`, adicionar `onClick={() => setDrawerOpen(false)}` para auto-fechar drawer ao navegar (FR-005). Verificar que o link continua navegando normalmente (Next.js Link prefetch).
- [x] T010 [US1] Em `dashboard-shell.tsx`, adicionar `<SheetTitle className="sr-only">Navegação</SheetTitle>` dentro do `<SheetContent>` (acessibilidade — Radix exige title pra screen readers).
- [x] T011 [US1] Em `dashboard-shell.tsx`, ajustar padding global: `<header>` muda `px-8` → `px-4 md:px-8`; tab bar wrapper muda `px-8` → `px-4 md:px-8`; conteúdo principal muda `p-8` → `p-4 md:p-8`. Search input do header já tem `hidden md:block`, manter.
- [x] T012 [US1] Em `dashboard-shell.tsx`, na tab bar, transformar `<div className="flex shrink-0 items-center gap-1 border-b ... bg-white px-4 md:px-8">` em scrollable: adicionar `overflow-x-auto` + `[&::-webkit-scrollbar]:hidden` (esconder scrollbar visual em desktop) e `whitespace-nowrap` em cada `<CategoryTab>` para evitar wrap.
- [x] T013 [US1] Em `dashboard-shell.tsx`, no componente `CategoryTab`, adicionar `useEffect` que, quando `active === true`, chama `ref.current?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })` no mount — garante que a aba ativa fica visível ao carregar (FR-009).

**Checkpoint**: User Story 1 funciona — app navegável em 360px, drawer abre/fecha, abas scrollam, padding correto.

---

## Phase 4: User Story 2 — Profissional usa tablet durante consulta (Priority: P2)

**Goal**: Modais com conteúdo alto scrollam internamente; action bar da ficha não corta botões em viewport apertado.

**Independent Test**: Em viewport 768×1024, abrir ficha de paciente com >5 evoluções e abrir os 3 modais principais (Limpar dados, Imprimir prontuário, Registrar pagamento). Cada modal scrolla internamente sem fazer o background scrollar.

> Pré-condição: Phase 2 (T004) já completou — modais base ganharam `max-h` + `overflow-y-auto`. Esta fase só ajusta a action bar do paciente que ficou de fora.

### Implementation for User Story 2

- [x] T014 [US2] Em `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`, ajustar o action bar do header: trocar `<div className="flex items-center justify-between gap-2">` por `<div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">`. Os botões Voltar / Imprimir / Limpar dados ficam empilhados em <640px e lado-a-lado em ≥640px (FR-018).
- [x] T015 [US2] Em `pacientes/[id]/page.tsx`, garantir que o segundo div interno (`<div className="flex items-center gap-2">` que agrupa PrintChartButton + PatientCleanupButton) tenha `flex-wrap` — em viewport bem estreito, os botões fazem wrap em vez de cortar.

**Checkpoint**: User Story 2 funciona — modais base já cobertos pelo Phase 2; action bar do paciente já não corta em mobile.

---

## Phase 5: User Story 3 — Desktop continua estável (Priority: P3)

**Goal**: Todas as mudanças preservam pixel-perfect o layout em viewports ≥1024px (zero regressão visual).

**Independent Test**: Comparar screenshots @1280×720 antes e depois das Phase 1-4 — Playwright detecta zero diffs perceptíveis.

> Phase 5 é puramente de **validação de regressão**. Não introduz código novo de produção, mas falha em snapshot bloqueia merge.

### Implementation for User Story 3

- [x] T016 [US3] Criar `tests/e2e/responsive-snapshots.spec.ts` com Playwright + `toHaveScreenshot()`. Capturar 4 páginas-chave em viewport 1280×720: `/login`, `/operacao/pacientes`, `/operacao/pacientes/[id]` (com seed de paciente), `/analise/relatorios`. Comparar contra baseline gravado em T001.
- [x] T017 [US3] No mesmo arquivo `responsive-snapshots.spec.ts`, adicionar testes complementares em viewports `375×812` (iPhone) e `768×1024` (iPad portrait) com a flag de snapshot inicial — esses screenshots viram **novo baseline** para futuras regressões. Não comparam com desktop.
- [x] T018 [US3] Adicionar entrada no `package.json` em `scripts`: `"test:visual": "playwright test tests/e2e/responsive-snapshots.spec.ts"`. Documentar em `quickstart.md` como rodar.
- [ ] T019 [US3] Rodar `pnpm test:e2e tests/e2e/smoke-flow.spec.ts` — smoke flow existente (criar tenant, criar paciente, aplicar anamnese) precisa passar sem mudanças. Esta validação prova que mudanças de layout não quebraram fluxos funcionais (FR-022).

**Checkpoint**: User Story 3 valida — desktop intacto, mobile/tablet com novo baseline, smoke flow passa.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validação manual final + cleanup.

- [ ] T020 Rodar checklist manual completa de `quickstart.md` — todos os checkboxes nos 3 viewports (360, 768, 1280). Documentar qualquer issue encontrada como follow-up.
- [x] T021 [P] `pnpm typecheck && pnpm lint && pnpm lint:auth` — todos retornam 0.
- [ ] T022 [P] Atualizar `CLAUDE.md` (se necessário) com aviso sobre breakpoint `md` (768px) como cutoff mobile/desktop oficial do projeto.
- [ ] T023 Commit final + PR para master com message: `feat: responsividade total mobile/tablet/desktop`. PR description linka spec.md e quickstart.md, lista os 6 FRs (US1) + 2 FRs (US2) + 4 tasks de regressão (US3).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 (baseline) precisa rodar **antes** de qualquer mudança visual; T002+T003 podem rodar em paralelo com T001.
- **Foundational (Phase 2)**: depende de T002 (Sheet existir, mas T004/T005 não usam Sheet). Pode rodar em paralelo com Phase 3 — mas idealmente T004/T005 vão primeiro porque desbloqueiam Phase 4 sem precisar tocar em cada caller.
- **User Stories (Phase 3+)**: dependem do Sheet (T002) e podem rodar em qualquer ordem após Phase 2.
- **Polish (Phase 6)**: depende de todas as user stories implementadas.

### User Story Dependencies

- **US1 (P1) — Mobile**: depende de T002 (Sheet). Independente de US2/US3.
- **US2 (P2) — Modais/Action bars**: depende de T004 (Dialog base). Pode acontecer em paralelo com US1.
- **US3 (P3) — Regressão visual**: depende de US1+US2 estarem implementadas (a validação só faz sentido com tudo no lugar). T001 captura baseline antes; T016-T019 capturam após.

### Within Each User Story

- US1: T006 → T007 (refactor da sidebar) → T008 (hamburger) → T009 (auto-close) → T010 (a11y) → T011 (padding) → T012 (overflow tabs) → T013 (auto-scroll). Sequencial — todos editam o mesmo arquivo `dashboard-shell.tsx`.
- US2: T014 → T015. Mesmo arquivo `pacientes/[id]/page.tsx`. Sequencial.
- US3: T016/T017 podem rodar em paralelo (arquivos diferentes); T018 (script) e T019 (smoke run) sequenciais.

### Parallel Opportunities

- T002 + T003 (Setup): paralelo (arquivos diferentes).
- T004 + T005 (Foundational): paralelo (`dialog.tsx` vs `table.tsx`).
- US1 vs US2: paralelo (arquivos diferentes — `dashboard-shell.tsx` vs `pacientes/[id]/page.tsx`).
- T021 + T022 (Polish): paralelo (typecheck/lint vs CLAUDE.md edit).

---

## Parallel Example: Phases 1-2

```bash
# After T001 (baseline screenshots) completes:
Task: "T002 Add Sheet component in src/components/ui/sheet.tsx"
Task: "T003 Verify tailwind animations config"

# After T002 completes:
Task: "T004 Update Dialog base with max-h in src/components/ui/dialog.tsx"
Task: "T005 Update Table base with fade gradient in src/components/ui/table.tsx"
Task: "T006-T013 (US1) — sequential edit of dashboard-shell.tsx"
```

## Parallel Example: Two-developer split

```bash
# Dev A: User Story 1 (todos os T006-T013 em dashboard-shell.tsx)
# Dev B: User Story 2 (T014-T015 em pacientes/[id]/page.tsx)
# Dev C: começa preparando T016-T018 (Playwright test scaffolding) enquanto US1+US2 estão em flight
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T001 — capturar baseline.
2. T002+T003 — Setup paralelo.
3. T004+T005 — Phase 2 paralelo.
4. T006-T013 — US1 sequencial.
5. **STOP & VALIDATE**: testar manualmente em viewport 375 — drawer funciona, padding ok, abas scrollam.
6. Deploy/demo se ok. **Esse é o MVP** — destrava mobile como um todo.

### Incremental Delivery

1. MVP (P1 só) → demo "agora dá pra usar no celular".
2. Add US2 → demo "modais não quebram mais em tablet".
3. Add US3 (snapshots) → CI gate para futuras mudanças.
4. Polish + PR.

### Single-developer strategy

T001 → T002 → T003 → T004 → T005 → T006-T013 → T014-T015 → T016-T019 → T020-T023.

Total: ~6-8h de trabalho focado (sem inclui o tempo do baseline manual + cross-browser checks).

---

## Notes

- [P] = arquivos diferentes, sem dependências.
- [Story] mapeia task ao user story para rastreabilidade.
- Cada user story é independentemente testável — é possível fazer merge só do US1 e ainda assim ter ganho real.
- T001 (baseline) é **crítico** — sem ele, T016 não tem oracle de regressão.
- Commit após cada checkpoint (não cada task).
- Avoid: editar `dashboard-shell.tsx` em paralelo com vários devs (conflitos certos).
- Atenção em T012 (`overflow-x-auto`): testar que quando NÃO há overflow (ex: viewport 1280px com poucas abas), a scrollbar invisível não cria espaço residual.
