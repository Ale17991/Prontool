---

description: "Task list for 016 Designer Palette Rollout"
---

# Tasks: Rollout da Paleta Híbrida do Designer

**Input**: Design documents from `/specs/016-designer-palette-rollout/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Esta feature **NÃO** introduz testes automatizados novos (decisão registrada nas Assumptions do spec). Validação é por **inventário, inspeção visual e gates manuais** — incluídos como tarefas explícitas. `pnpm typecheck` é o único gate automatizado obrigatório.

**Organization**: Tasks agrupadas por user story (US1..US6). Como tokens são pré-requisito técnico para US1+US2+US5, o trabalho técnico de tokens vive na **Phase 2 (Foundational)**; a Phase 5 (US3) cobre o trabalho de **validação/auditoria** desses tokens. Cada US encerra com um commit obrigatório (regra explícita do usuário: commit + push após cada feature).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência em tarefas incompletas)
- **[Story]**: a qual user story pertence (US1..US6). Setup/Foundational/Polish não levam label.
- Caminhos absolutos a partir de `C:\My project\` quando necessário; relativos a `src/` para clareza.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: capturar baselines de medição e mapear superfície de mudança antes de tocar código.

- [~] T001 [P] Capturar baseline de LCP rodando Lighthouse mobile + Slow 3G em `/login` e `/` (dashboard); salvar screenshots/relatório em `specs/016-designer-palette-rollout/baselines/lcp-before.md` para comparação posterior (SC-006/SC-008) — **placeholder criado; captura manual pendente**
- [x] T002 [P] Auditar usos do prefixo Tailwind `dark:` no codebase (`rg "dark:" src/`); listar resultados em `specs/016-designer-palette-rollout/baselines/dark-prefix-usages.md` — orfãos serão removidos na US6 — **zero ocorrências**
- [x] T003 [P] Auditar callsites que renderizam status de appointment via `effectiveStatus` (`rg "effectiveStatus" src/`); listar em `specs/016-designer-palette-rollout/baselines/appointment-status-callsites.md` — base do trabalho da US2 — **3 callsites visuais identificados**
- [x] T004 [P] Confirmar que `pnpm typecheck` roda limpo na master antes de qualquer mudança; capturar exit code em `specs/016-designer-palette-rollout/baselines/typecheck-before.txt` — **exit 0**

**Checkpoint**: baselines capturados, superfície de mudança conhecida.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: criar a base de tokens que **todas as user stories** consomem. Sem isto, nenhum US pode começar.

**⚠️ CRITICAL**: nenhum trabalho de US1/US2/US5 pode começar até esta phase fechar.

- [ ] T005 Adicionar 12 tokens **semânticos novos** em `:root` de `src/app/globals.css` conforme `contracts/tokens.schema.json` → `semantic`: `--success`, `--success-foreground`, `--success-bg`, `--success-text`, `--warning`, `--warning-foreground`, `--info`, `--info-foreground`, `--info-bg`, `--info-text`, `--alert`, `--alert-foreground` (todos em formato HSL triple)
- [ ] T006 Atualizar tokens existentes `--accent` (de `210 40% 96%` para `180 22% 84%`) e `--accent-foreground` (de `222 47% 11%` para `182 86% 16%`) em `src/app/globals.css`
- [ ] T007 Adicionar 8 tokens de **sidebar** em `:root` de `src/app/globals.css` conforme `contracts/tokens.schema.json` → `sidebar`: `--sidebar-bg`, `--sidebar-text`, `--sidebar-active-bg`, `--sidebar-active-text`, `--sidebar-switch`, `--sidebar-hover`, `--sidebar-section-label`, `--sidebar-separator` (formato hex/rgba direto, NÃO HSL — ver `research.md` §6)
- [ ] T008 Estender `theme.extend.colors` em `tailwind.config.ts` para expor os novos tokens semânticos: `success` (DEFAULT + foreground + bg + text), `warning` (DEFAULT + foreground), `info` (DEFAULT + foreground + bg + text), `alert` (DEFAULT + foreground) — usando o padrão `hsl(var(--token))` já existente para `primary`/`secondary`
- [ ] T009 Estender `theme.extend.colors.sidebar` em `tailwind.config.ts` com as 8 chaves consumindo as vars sidebar via `var(--sidebar-*)` direto (sem `hsl()`) — ver `research.md` §6 para justificativa
- [ ] T010 Rodar `pnpm typecheck`; se falhar, corrigir até passar

**Checkpoint**: tokens prontos para consumo. US1, US2, US3, US5 podem começar em paralelo.

---

## Phase 3: User Story 1 — Identidade visual do designer aplicada (Priority: P1) 🎯 MVP

**Goal**: garantir que, ao final do rollout, as 3 famílias cromáticas (azul institucional do designer + verde accent + Blue 600 CTA) coexistem corretamente em cada tela-chave, sem conflito visual e sem substituição inadvertida do CTA.

**Independent Test**: inspeção visual lado-a-lado em 5 telas (login, dashboard, agenda, ficha paciente, configurações) verificando: (a) sidebar `#0E3C5B`, (b) badges de "Concluído" usam verde do designer, (c) botões "Salvar"/"Confirmar" mantêm Blue 600. Sob simulação de daltonismo, estados continuam distinguíveis.

> **Nota**: US1 é o **outcome de integração** de US2+US5 (e dos tokens da Phase 2). Suas tarefas são majoritariamente **validação**, executadas DEPOIS de US2 e US5 fecharem. Os checkpoints de validação ficam aqui agrupados.

- [ ] T011 [US1] Após US2+US5 fecharem, abrir cada uma das 5 telas-chave (`/login`, `/`, `/operacao/atendimentos`, `/operacao/pacientes/[id]`, `/configuracoes`) e capturar screenshot em `specs/016-designer-palette-rollout/visual-validation/` — uma pasta por tela
- [ ] T012 [US1] Comparar cada screenshot com a paleta híbrida documentada em `data-model.md` §1; produzir checklist de divergências em `specs/016-designer-palette-rollout/visual-validation/divergences.md` — zero divergências para fechar US1
- [ ] T013 [US1] Verificar via DevTools que **botões primários** ("Salvar", "Confirmar", "Criar", CTAs em geral) mantêm `background-color: rgb(37, 99, 235)` (Blue 600) nas 5 telas — SC-006
- [ ] T014 [US1] Ativar emulação de daltonismo no Chrome DevTools (deuteranopia + protanopia) e validar nas 3 telas com mais badges/estados (agenda calendário, agenda lista, ficha paciente) — registrar resultado em `visual-validation/colorblind-check.md` (SC-003)
- [ ] T015 [US1] Commit + push: `git add -A && git commit -m "feat(ui): valida identidade visual do designer aplicada (US1)"` na branch `016-designer-palette-rollout`

**Checkpoint**: identidade visual coerente confirmada nas telas-chave; pronto para revisão.

---

## Phase 4: User Story 2 — Status de consulta com cor + ícone + label (Priority: P1)

**Goal**: substituir o estilo inline de status de appointment por um componente único reutilizável que cobre 7 estados visuais (cobertura visual completa; instanciados 3 hoje, 4 reservados para domínio futuro).

**Independent Test**: abrir calendário e lista de atendimentos, verificar que cada card mostra cor + ícone + label simultaneamente; ativar emulação de daltonismo e confirmar que estados continuam distinguíveis por ícone + padrão visual (listrado/tracejado/opaco).

- [ ] T016 [US2] Criar `src/components/ui/appointment-status-badge.tsx` exportando `AppointmentStatusVariant` (union dos 7 estados) e `AppointmentStatusBadge` com props `{ variant, iconOnly?, size?, className? }` conforme `contracts/appointment-status-badge.contract.md` — incluir importação dos 7 ícones lucide (`Calendar`, `Check`, `CheckCheck`, `Clock`, `UserX`, `X`, `RotateCcw`)
- [ ] T017 [US2] Implementar o map interno `VARIANT_CONFIG` no componente associando cada `variant` a `{ label_pt, Icon, bgClass, textClass, pattern, motion }` exatamente como em `data-model.md` §3 — usar classes Tailwind dos novos tokens (`bg-info-bg text-info-text`, `bg-success-bg text-success-text`, etc.)
- [ ] T018 [US2] Implementar render de padrões visuais não-cromáticos: `no_show` com `repeating-linear-gradient` (listrado), `cancelado` com `border-dashed`, `concluido` com opacidade 60% no fundo via `bg-success-bg/60`
- [ ] T019 [US2] Implementar o indicador "em atendimento" como `<span aria-hidden className="motion-safe:animate-pulse h-1.5 w-1.5 rounded-full bg-warning-foreground" />` à esquerda do ícone — atende SC-013 e WCAG 2.3.3 (ver `research.md` §4)
- [ ] T020 [US2] Implementar variante `iconOnly`: label vai em `<span className="sr-only">{label_pt}</span>` + `aria-label={label_pt}` no wrapper
- [ ] T021 [US2] Implementar variantes `size`: `sm` usa 11px + padding reduzido (exceção autorizada da escala tipográfica); `md` (default) usa `text-caption` (12px)
- [ ] T022 [US2] Migrar `src/app/(dashboard)/operacao/atendimentos/calendar/calendar-block.tsx` — remover `statusClass` inline (linhas 35-40) e usar `<AppointmentStatusBadge variant={statusToVariant(a.effectiveStatus)} iconOnly size="sm" />`; criar helper `statusToVariant` localmente conforme `contracts/appointment-status-badge.contract.md` (mapper de domínio)
- [ ] T023 [P] [US2] Migrar `appointments-history-table.tsx` (path exato a confirmar com baseline T003) para usar `AppointmentStatusBadge` (provavelmente `size="md"` por estar em tabela, não em célula compacta)
- [ ] T024 [P] [US2] Migrar `filter-bar.tsx` (path exato a confirmar com baseline T003) — verificar se ele renderiza status ou só filtra; ajustar conforme caso
- [ ] T025 [US2] Re-rodar audit de `effectiveStatus` (`rg "effectiveStatus" src/`); para qualquer callsite ainda usando cor inline, migrar para `AppointmentStatusBadge`; atualizar `baselines/appointment-status-callsites.md` marcando ✅ cada migração
- [ ] T026 [US2] Inspeção visual: abrir `/operacao/atendimentos` em modo calendário e modo lista; confirmar que os 3 estados ativos do banco (`agendado`/`ativo`/`estornado`) renderizam corretamente cada um com cor + ícone + label
- [ ] T027 [US2] Inspeção em DevTools com emulação de `prefers-reduced-motion: reduce`: confirmar que o ponto do "em atendimento" fica estático (não há instância real desse estado hoje no banco, mas testar via Storybook-substitute — criar uma rota dev/playground temporária ou usar React DevTools para forçar a variant)
- [ ] T028 [US2] Rodar `pnpm typecheck`; corrigir até passar
- [ ] T029 [US2] Commit + push: `git add -A && git commit -m "feat(ui): AppointmentStatusBadge com cor+icone+label, 7 variantes, prefers-reduced-motion (US2)"`

**Checkpoint**: componente único de status pronto; 3 callsites migrados; daltonismo e reduced-motion validados.

---

## Phase 5: User Story 3 — Catálogo de tokens semânticos disponível e validado (Priority: P2)

**Goal**: garantir que o catálogo de tokens semânticos entregue na Phase 2 é completo, distinto entre tokens e atende WCAG AA em 100% dos pares.

**Independent Test**: inspeção em `globals.css`: cada token semântico existe com seu foreground; `--accent` ≠ `--secondary` visualmente; cada par cor/foreground tem contraste ≥ 4.5:1.

> **Nota**: a *criação* dos tokens já aconteceu na Phase 2 (Foundational). Esta phase faz a **auditoria/validação** prometida pela US3.

- [ ] T030 [US3] Validar contraste com ferramenta automatizada (ex.: WebAIM Contrast Checker ou extensão "axe DevTools"); para cada par definido em `research.md` §10 (7 pares críticos + os 5 adicionais semânticos), confirmar ≥ 4.5:1 para texto ou ≥ 3:1 para UI; registrar em `specs/016-designer-palette-rollout/visual-validation/contrast-audit.md`
- [ ] T031 [US3] Inspecionar em DevTools que `--accent` (verde suave) renderiza distinto de `--secondary` (slate-100) em algum componente shadcn que use ambos (ex.: `Button` ghost vs outline) — confirmação visual de FR-010
- [ ] T032 [US3] Documentar em `specs/016-designer-palette-rollout/visual-validation/shadcn-impact.md` o resultado de revisão visual dos componentes shadcn impactados conforme `research.md` §9: `Button` (todas variantes), `Command`, `Select`, `Dialog`, `Popover`, `Sheet`, `Table` — anotar quaisquer hovers que ficaram esquisitos
- [ ] T033 [US3] Confirmar que **nenhum componente** tem `hsl(var(--accent))` ou `hsl(var(--secondary))` hardcoded com valores antigos (slate-100) — auditoria final via grep `rg "210 40% 96"` em `src/` (que era o valor antigo de accent)
- [ ] T034 [US3] Atualizar a tabela de tokens em `quickstart.md` se descobrir tokens órfãos ou faltantes durante a auditoria; manter sincronizada com `data-model.md` §1
- [ ] T035 [US3] Rodar `pnpm typecheck`
- [ ] T036 [US3] Commit + push: `git add -A && git commit -m "feat(ui): tokens semanticos do designer (success/warning/info/alert) com WCAG AA (US3)"`

**Checkpoint**: catálogo de tokens validado; auditoria de contraste e de impacto shadcn registrada.

---

## Phase 6: User Story 4 — Escala tipográfica documentada (Priority: P2)

**Goal**: introduzir 7 classes utilitárias (`text-display`, `text-h1`, `text-h2`, `text-h3`, `text-body`, `text-caption`, `text-mono`) e garantir que nada do produto principal renderiza abaixo de 12px (exceção: rótulos de métrica em 11px).

**Independent Test**: classes utilizáveis em qualquer componente; auditoria visual em 10 telas-chave confirma que nenhum texto cai abaixo de 12px.

- [ ] T037 [US4] Adicionar bloco `@layer components` em `src/app/globals.css` com as 7 classes utilitárias exatas conforme `contracts/typography-scale.contract.md`
- [ ] T038 [P] [US4] Auditar texto < 12px no codebase (`rg -n "text-\[1[01]px\]|text-xs" src/`); para cada ocorrência, decidir se é (a) rótulo de métrica autorizado (11px), (b) candidato a `text-caption` (12px), ou (c) usado em componente terceiro/charts; registrar em `baselines/small-text-audit.md`
- [ ] T039 [P] [US4] Verificar em 10 telas-chave (`/login`, `/`, `/operacao/atendimentos`, `/operacao/pacientes`, `/configuracoes`, `/relatorios`, `/financeiro`, `/cadastros`, `/tarefas`, `/integracoes`) que nenhum texto da UI principal renderiza abaixo de 12px — exceto rótulos de métrica autorizados; documentar em `visual-validation/typography-audit.md` (SC-007)
- [ ] T040 [US4] Rodar `pnpm typecheck`
- [ ] T041 [US4] Commit + push: `git add -A && git commit -m "feat(ui): escala tipografica (display/h1..body/caption/mono) com piso de 12px (US4)"`

**Checkpoint**: classes utilitárias disponíveis; piso de 12px validado.

---

## Phase 7: User Story 5 — Sidebar fiel ao designer (Priority: P3)

**Goal**: substituir o slate-900 atual da sidebar pelos 8 tokens da família institucional do designer; alinhar pixel-a-pixel com a paleta documentada.

**Independent Test**: inspeção via DevTools dos 8 elementos da sidebar (fundo, texto, item ativo fundo/texto, hover, separador, label de seção, "Trocar clínica") batendo com `data-model.md` §5.

- [ ] T042 [US5] Em `src/app/(dashboard)/_components/dashboard-shell.tsx`, substituir `bg-slate-900` (linha 148) por `bg-sidebar` consumindo o novo token
- [ ] T043 [US5] Substituir as classes do item ativo (linha 341) `bg-primary/15 text-white shadow-inner ring-1 ring-primary/30` por `bg-sidebar-active-bg text-sidebar-active-text` — manter `shadow-inner` ou remover é decisão de revisão visual (não está no spec; default: remover, validar visualmente em T046)
- [ ] T044 [US5] Substituir hover (linha 342) `hover:bg-white/5 hover:text-white` por `hover:bg-sidebar-hover hover:text-white` — `bg-sidebar-hover` é `rgba(255,255,255,0.05)`, idêntico ao atual
- [ ] T045 [US5] Substituir labels de seção (linhas 278-279) `text-slate-500` por `text-sidebar-section-label`; substituir separadores (linhas 271, 298) `border-white/5` por `border-sidebar-separator` — **atenção**: valor muda de 0.05 para 0.1, separador fica ligeiramente mais visível
- [ ] T046 [US5] Substituir link "Trocar clínica" (linhas 256-262) `text-sky-300 hover:text-sky-200` por `text-sidebar-switch hover:text-sidebar-switch/80` (ou hover equivalente)
- [ ] T047 [US5] Inspeção visual da sidebar abrindo qualquer página do dashboard; comparar com a tabela de cores em `data-model.md` §5 — zero divergência (SC-005). Capturar screenshot em `visual-validation/sidebar.png`
- [ ] T048 [US5] Verificar que o link "Trocar clínica" só aparece quando `isMultiTenant` é true (lógica existente preservada); contraste do `#569AC6` sobre `#0E3C5B` ≥ 4.5:1
- [ ] T049 [US5] Rodar `pnpm typecheck`
- [ ] T050 [US5] Commit + push: `git add -A && git commit -m "feat(ui): sidebar com paleta institucional do designer (US5)"`

**Checkpoint**: sidebar fiel ao designer; identidade institucional aplicada.

---

## Phase 8: User Story 6 — Inter via next/font + dark mode cleanup (Priority: P3)

**Goal**: migrar Inter para `next/font/google`, eliminando FOUT e dependência de `fonts.googleapis.com` em runtime; remover declaração de dark mode inoperante.

**Independent Test**: medir LCP em conexão 3G emulada e comparar com baseline T001 (≥ 100ms melhoria OU FOUT ausente confirmado); inspecionar network e confirmar zero requests a `fonts.googleapis.com`; confirmar que `darkMode: ['class']` saiu de `tailwind.config.ts`.

- [ ] T051 [US6] Em `src/app/layout.tsx`, adicionar `import { Inter } from 'next/font/google'` e instanciar `const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' })`; aplicar `inter.variable` como className no `<html>`
- [ ] T052 [US6] Em `src/app/globals.css` (linha 1), remover `@import url('https://fonts.googleapis.com/css2?family=Inter:...')`; em linhas 36-40, alterar `font-family: 'Inter', ui-sans-serif, ...` para `font-family: var(--font-sans), ui-sans-serif, system-ui, sans-serif`; **manter** `font-feature-settings: 'cv11', 'ss01'` exatamente como está (FR-020)
- [ ] T053 [US6] Em `tailwind.config.ts`, manter `fontFamily.sans: ['Inter', ...]` ou alterar para `['var(--font-sans)', ...]` — alinhar com a estratégia de variable. Recomendado: usar `'var(--font-sans)'` para consistência
- [ ] T054 [US6] Em `tailwind.config.ts`, **remover** a linha `darkMode: ['class']` (linha 10) — FR-015
- [ ] T055 [US6] Para cada ocorrência de prefixo `dark:` encontrada em T002, decidir caso a caso: (a) remover se for órfã, (b) preservar com comentário explicando por quê. Registrar decisões em `baselines/dark-prefix-usages.md` ao lado de cada entry
- [ ] T056 [US6] Rodar `pnpm typecheck`
- [ ] T057 [US6] Build local (`pnpm build`) para validar que `next/font` baixa e cacheia Inter sem erro
- [ ] T058 [US6] Re-medir LCP em Lighthouse mobile + Slow 3G nas mesmas páginas que T001; comparar com baseline; documentar em `visual-validation/lcp-after.md` (SC-006, SC-008)
- [ ] T059 [US6] Verificar via DevTools Network (com `Disable cache`) que `fonts.googleapis.com` recebe zero requests durante carregamento do dashboard (SC-009)
- [ ] T060 [US6] Commit + push: `git add -A && git commit -m "perf(ui): Inter via next/font + remove dead dark mode declaration (US6)"`

**Checkpoint**: fonte self-hosted, sem FOUT visível, dark mode órfão limpo.

---

## Phase 9: Polish & Cross-Cutting Validation

**Purpose**: rodar o roteiro completo de validação do `quickstart.md` §5, garantir integração entre US, e fechar a feature.

- [ ] T061 [P] Rodar quickstart.md §5.1 (inspeção em DevTools) — 4 elementos validados (sidebar bg, botão primário, badge agendado, badge concluído)
- [ ] T062 [P] Rodar quickstart.md §5.2 (daltonismo) — 3 simulações em 3 telas
- [ ] T063 [P] Rodar quickstart.md §5.3 (reduced-motion) — toggle do `prefers-reduced-motion` e validar comportamento do badge "em atendimento"
- [ ] T064 [P] Rodar quickstart.md §5.4 (network) — confirmação de zero requests a `fonts.googleapis.com`
- [ ] T065 [P] Rodar quickstart.md §5.5 (Lighthouse LCP) — captura final
- [ ] T066 Amostrar 20 pares texto/fundo aleatórios no produto (badges, sidebar, botões) e validar WCAG AA em todos (SC-004); registrar em `visual-validation/random-sample-contrast.md`
- [ ] T067 Inventário final: confirmar que zero `appointmentStatusClass` inline ou hex hardcoded para os 7 estados de consulta permanecem no codebase — `rg "bg-rose-100|bg-sky-50|bg-blue-100" src/app/(dashboard)/operacao/atendimentos/` deve retornar nada relevante (SC-002)
- [ ] T068 Confirmar que `darkMode: ['class']` não aparece em `tailwind.config.ts` e que não há `.dark {` órfão em arquivos `.css` (SC-010)
- [ ] T069 Rodar `pnpm typecheck` final
- [ ] T070 Atualizar `checklists/requirements.md` marcando todos os Success Criteria como ✅ validados; anotar quaisquer SC que ficaram parciais (com link para issue de follow-up se necessário)
- [ ] T071 Commit + push: `git add -A && git commit -m "chore(ui): polish + validacao final do design system (016)"`

**Checkpoint**: feature 016 fechada. Todos os Success Criteria do spec validados.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências — pode começar imediatamente.
- **Foundational (Phase 2)**: depende de Setup; **bloqueia US1, US2, US3, US5**.
- **US4 (Phase 6)**: depende de Setup; **NÃO depende** de Foundational (classes tipográficas não consomem tokens cromáticos). Pode rodar em paralelo com Phase 2 se houver capacidade.
- **US6 (Phase 8)**: depende de Setup (precisa do baseline LCP em T001 e da auditoria de `dark:` em T002); **NÃO depende** de Foundational nem de outras US. Pode rodar em paralelo com qualquer phase após Setup.
- **US2 (Phase 4)**: depende de Foundational completa (consome tokens semânticos).
- **US3 (Phase 5)**: depende de Foundational completa (audita tokens criados).
- **US5 (Phase 7)**: depende de Foundational completa (consome tokens sidebar).
- **US1 (Phase 3)**: **bloqueia até US2 + US5 fecharem**, porque é validação do outcome integrado.
- **Polish (Phase 9)**: depende de todas as US fecharem.

### Resumo visual

```text
Setup (T001..T004)
   │
   ├──> Foundational (T005..T010)
   │       │
   │       ├──> US2 (T016..T029)  ┐
   │       ├──> US3 (T030..T036)  ├──> US1 (T011..T015)  ┐
   │       └──> US5 (T042..T050) ─┘                       │
   │                                                       ├──> Polish (T061..T071)
   ├──> US4 (T037..T041) ─────────────────────────────────┤
   │                                                       │
   └──> US6 (T051..T060) ─────────────────────────────────┘
```

### Within Each User Story

- Sem testes automatizados nesta feature → ordem natural: componentes → consumidores → validação.
- Cada US encerra com `pnpm typecheck` + commit + push.

---

## Parallel Opportunities

### Cross-phase paralelismo

- **Phase 1 (Setup)**: T001, T002, T003, T004 podem rodar em paralelo (medições/auditorias independentes).
- **Phase 2 (Foundational)**: T005, T006, T007 mexem no mesmo arquivo (`globals.css`) — sequencial; T008 e T009 mexem em `tailwind.config.ts` — sequencial entre si; mas o grupo (T005..T007) e o grupo (T008..T009) podem ser feitos por pessoas diferentes em PRs separadas se sincronizados.
- **US4** (Phase 6) é totalmente independente das phases 2/3/4/5/7 — pode rodar em paralelo após Setup.
- **US6** (Phase 8) é totalmente independente das phases 2/3/4/5/7 — pode rodar em paralelo após Setup.
- **US2, US3, US5** rodam em paralelo após Foundational fechar.
- **Polish (Phase 9)**: T061..T065 são validações de telas diferentes — paralelizáveis.

### Parallel Example: após Foundational fechar

```bash
# 3 desenvolvedores ou 3 sessões podem trabalhar simultaneamente:
Dev A: US2 — implementar AppointmentStatusBadge + migrar callsites
Dev B: US3 — auditar contraste e impacto shadcn
Dev C: US5 — restilizar dashboard-shell.tsx

# Em paralelo (independente), desde Setup:
Dev D: US4 — escala tipográfica
Dev E: US6 — Inter migration + dark mode cleanup
```

---

## Implementation Strategy

### MVP First (incremental)

Por se tratar de UI pura sem risco de regressão de domínio, recomenda-se entregar US a US, com push de cada para `master` (regra explícita do usuário):

1. **Setup + Foundational** (T001..T010) — entregar como **1 commit** de preparação ("chore(ui): baselines + design tokens fundacionais").
2. **US2** (T016..T029) — primeiro entregável visível, alto impacto. **Commit + push para master**.
3. **US5** (T042..T050) — sidebar troca de cor; visual fortemente perceptível. **Commit + push para master**.
4. **US1** (T011..T015) — validação do outcome integrado. **Commit + push para master**.
5. **US3** (T030..T036) — auditoria de qualidade. **Commit + push para master**.
6. **US4** (T037..T041) — escala tipográfica. **Commit + push para master**.
7. **US6** (T051..T060) — Inter + dark mode. **Commit + push para master**.
8. **Polish** (T061..T071) — validação cruzada. **Commit + push para master**.

> **Importante**: cada commit deve manter o produto **navegável** — nenhum estado intermediário pode quebrar `pnpm typecheck` nem deixar tela com texto invisível.

### Atalho mínimo viável (se prazo apertar)

Se houver pressão para entregar só o essencial:
- **MVP absoluto**: Setup + Foundational + **US2** (status badge) = mais impacto visual com menor superfície tocada.
- US5 (sidebar) é o segundo mais visível.
- US3, US4, US6 podem aguardar follow-up.

---

## Notes

- **[P]** = arquivos diferentes, sem dependência incompleta.
- **[Story]** = mapeia à user story do spec.md para rastreabilidade.
- Cada US é completamente entregável e testável independentemente.
- **Sem testes automatizados novos** nesta feature (decisão registrada no spec). Validação é por inventário + inspeção + DevTools.
- **`pnpm typecheck` é gate por phase**, conforme FR-030.
- **Commit + push após cada US** é regra explícita do usuário.
- Evitar: tarefas vagas, conflitos no mesmo arquivo entre [P]s, dependência cruzada entre US que quebre independência.
- **Feature 017 (badges genéricos)** é diferida — não pertence a este tasks.md (decisão clarification Q2).
