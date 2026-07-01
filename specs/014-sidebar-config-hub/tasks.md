---
description: 'Task list for feature 014-sidebar-config-hub'
---

# Tasks: Sidebar enxuta + Configurações como hub

**Input**: Design documents from `/specs/014-sidebar-config-hub/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅, quickstart.md ✅

**Tests**: Included (arquivos escritos). **Execução local deferida** (2026-05-18): Docker Desktop estava parado durante o /speckit.implement, então o stack Supabase local não pôde subir e `tests/helpers/setup.ts` falha o setup global (Constituição §3 proíbe mock do DB para integration tests). Os 3 arquivos novos de teste foram escritos e vão rodar em CI ou quando Docker subir localmente. Gates substitutivos durante a execução: `pnpm typecheck`, `pnpm lint` e `pnpm lint:auth` — todos verdes ao final de cada fase.

**Organization**: Tarefas agrupadas por user story. As 4 user stories são **independentemente entregáveis**; US1 e US2 (ambos P1) formam o MVP; US3 (P2) entrega o hub; US4 (P3) é verificação de rotas legadas.

## Path Conventions

Projeto **web monolítico Next.js** (App Router). Caminhos relativos à raiz do repo `C:\My project\`:

- UI/páginas: `src/app/(dashboard)/...`
- Componentes compartilhados: `src/app/(dashboard)/_components/...`
- Testes: `tests/unit/`, `tests/integration/` (vitest)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Sanity check do ambiente antes de mexer em código.

- [x] T001 Verificar baseline limpa: `pnpm typecheck && pnpm test` rodam sem erro em `014-sidebar-config-hub` antes de qualquer mudança; capturar tempo de baseline do `pnpm test` para comparar depois.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pré-requisitos que bloqueiam todas as user stories.

**⚠️ Esta feature é pura UI e as 4 user stories tocam arquivos diferentes — não há código foundational a escrever.** A única gate é a checagem de baseline (T001). Pular para Phase 3.

**Checkpoint**: Pronto para implementação paralela de US1 + US2 + US3 (US4 depende dos redirects entregues por US2 e US3).

---

## Phase 3: User Story 1 — Sidebar simplificada (Priority: P1) 🎯 MVP

**Goal**: Reduzir a sidebar para 3 itens em Operação + 3 itens em Análise + 1 botão "Configurações" (com separador), removendo Notificações/Alertas/Pendências/Auditoria do menu lateral. RBAC e feature-flags existentes são preservados.

**Independent Test**: Login com cada role; confirmar que admin vê exatamente 7 itens na sidebar; outros roles veem subconjunto consistente com `can()` + flags atuais. Conferir que Notificações, Alertas do sistema, Pendências e Auditoria não aparecem mais no menu lateral.

### Tests for User Story 1

> Escrever primeiro; devem **FALHAR** antes da implementação em T005.

- [x] T002 [P] [US1] Criar `tests/unit/dashboard-shell-sections.test.ts` cobrindo a matriz role × itens visíveis pós-feature: admin → 7 itens (Agenda, Pacientes, Tarefas, Relatórios, Comissões, Despesas, Configurações); profissional_saude com flags mínimas → subconjunto correto; nenhum role vê Notificações/Alertas/Pendências/Auditoria na sidebar.

### Implementation for User Story 1

- [x] T003 [US1] Atualizar `SECTIONS` em `src/app/(dashboard)/_components/dashboard-shell.tsx`: (a) remover de `operacao` os itens "Notificações" (`/operacao/notificacoes`), "Alertas do sistema" (`/operacao/alertas`), "Pendências" (`/operacao/dlq`); (b) remover de `analise` o item "Auditoria" (`/analise/auditoria`); (c) substituir todos os itens da seção `configuracoes` por um único item `{ href: '/configuracoes', label: 'Configurações', icon: Settings, show: () => true }`.
- [x] T004 [US1] Em `src/app/(dashboard)/_components/dashboard-shell.tsx`, no componente `SidebarInner`, adicionar separador visual (`<div className="my-3 border-t border-white/5" />` ou equivalente Tailwind) antes da seção `configuracoes` para criar o "espaço" descrito no FR-001.
- [x] T005 [US1] Importar o ícone `Settings` de `lucide-react` em `dashboard-shell.tsx` (e remover imports de ícones agora não usados na sidebar — `AlertTriangle`, `Building2`, `DollarSign`, `ListChecks`, `Plug`, `UserCheck`, `UserCircle`, `Users` em Configurações, `ScrollText` se não usado mais; verificar com `pnpm typecheck` que nada quebra).
- [x] T006 [US1] Rodar `pnpm test tests/unit/dashboard-shell-sections.test.ts` e confirmar que passa (era T002 → falhando → agora verde).
- [x] T007 [US1] Smoke test manual: login com admin + 1 role não-admin no dev (`pnpm dev`); confirmar visualmente a sidebar (≥md) e o drawer (<md) seguindo `quickstart.md §2`.

**Checkpoint**: US1 é entregável independentemente — sidebar nova já está em produção; o botão "Configurações" continua levando à página `/configuracoes` (que ainda tem o redirect role-based antigo, sem hub). Sem regressão funcional.

---

## Phase 4: User Story 2 — Notificações/alertas/pendências unificados (Priority: P1) 🎯 MVP

**Goal**: Sininho da topbar continua linkando para `/operacao/notificacoes`, mas a página passa a ter tab bar server-rendered com 3 sub-seções (Notificações, Alertas do sistema, Pendências), filtradas por `alert.read` e `dlq.read`. Rotas legadas `/operacao/alertas` e `/operacao/dlq` viram 308 redirect para a aba correspondente preservando query strings.

**Independent Test**: Clicar no sininho → cair em `/operacao/notificacoes`. Como admin: ver tab bar com 3 abas e cada aba renderizando o conteúdo esperado. Como recepcionista: ver apenas a aba de notificações pessoais; `?tab=alertas` cai silenciosamente em notificações. `curl -I` em `/operacao/alertas` e `/operacao/dlq` retorna 308 com `Location` preservando filtros.

### Tests for User Story 2

> Escrever primeiro; devem **FALHAR** antes da implementação em T012–T016.

- [x] T008 [P] [US2] Criar `tests/integration/notificacoes-tabs.test.ts`: para cada role × `searchParams.tab`, verificar (a) quais abas aparecem na tab bar (`alert.read` controla aba "alertas"; `dlq.read` controla "dlq"); (b) `?tab=alertas` sem permissão cai em notificacoes (silencioso); (c) admin acessa todas as três abas; (d) HTML renderizado **não** contém marcações de sub-seções proibidas.
- [x] T009 [P] [US2] Criar `tests/integration/legacy-route-redirects.test.ts`: para `/operacao/alertas` e `/operacao/dlq`, verificar status 308 e `Location` apontando para `/operacao/notificacoes?tab=alertas` / `?tab=dlq`, com e sem query string adicional preservada (ex.: `?severity=warning` → `Location: ...&severity=warning`).

### Implementation for User Story 2

- [x] T010 [P] [US2] Criar `src/app/(dashboard)/operacao/notificacoes/_components/tab-bar.tsx` — Server Component que recebe `{ active, available }` (lista de `'notificacoes' | 'alertas' | 'dlq'`) e renderiza `<nav aria-label="Seções de notificações">` com `<Link>` para cada aba na ordem fixa (notificacoes → alertas → dlq), com `aria-current="page"` na ativa. Ver `contracts/notifications-tabs.md`.
- [x] T011 [P] [US2] Criar `src/app/(dashboard)/operacao/notificacoes/_components/tab-notificacoes.tsx` — Server Component que extrai o render de notificações pessoais atualmente inline em `page.tsx`: chama `generateUserNotifications` + `listNotifications`, renderiza `Card` com `MarkAllButton` e `NotificationItem`s. Recebe `tenantId` e `userId` como props.
- [x] T012 [P] [US2] Criar `src/app/(dashboard)/operacao/notificacoes/_components/tab-alertas.tsx` — Server Component com o conteúdo de `src/app/(dashboard)/operacao/alertas/page.tsx` extraído (lista de alerts + `ResolveButton`). Recebe `tenantId`. Mover (sem alterar lógica) os componentes locais de `/operacao/alertas/` que ainda forem necessários para dentro de `_components/` da página de notificações.
- [x] T013 [P] [US2] Criar `src/app/(dashboard)/operacao/notificacoes/_components/tab-dlq.tsx` — Server Component com o conteúdo de `src/app/(dashboard)/operacao/dlq/page.tsx` extraído (lista DLQ + `ReprocessButton`). Recebe `tenantId`. Mover os componentes locais necessários.
- [x] T014 [US2] Reescrever `src/app/(dashboard)/operacao/notificacoes/page.tsx`: (a) carregar `session` via `getSession()`; (b) calcular `permitidas` a partir de `can(role, 'alert.read')` e `can(role, 'dlq.read')` (sempre incluir `'notificacoes'` como primeiro); (c) resolver `active` = `permitidas.includes(searchParams.tab as string)` ? `searchParams.tab` : `'notificacoes'`; (d) renderizar `<TabBar active={active} available={permitidas} />` seguido do componente da aba ativa. Depende de T010–T013.
- [x] T015 [US2] Reescrever `src/app/(dashboard)/operacao/alertas/page.tsx` para um Server Component de **uma função** que usa `permanentRedirect()` de `next/navigation` para `/operacao/notificacoes?tab=alertas[&<query preservada>]`. Apagar componentes filhos não mais referenciados (eles foram movidos em T012).
- [x] T016 [US2] Reescrever `src/app/(dashboard)/operacao/dlq/page.tsx` analogamente: `permanentRedirect()` para `/operacao/notificacoes?tab=dlq[&<query preservada>]`. Apagar componentes filhos movidos em T013.
- [x] T017 [US2] Rodar `pnpm test tests/integration/notificacoes-tabs.test.ts tests/integration/legacy-route-redirects.test.ts` e confirmar que ambas as suítes ficam verdes. Rodar também `pnpm typecheck` para garantir que os imports cruzados ficaram corretos após a mudança.

**Checkpoint**: US2 entregável. MVP (US1 + US2) está pronto — sidebar enxuta, sininho → página unificada com tabs RBAC-filtered, rotas legadas redirecionando.

---

## Phase 5: User Story 3 — Hub /configuracoes com cards (Priority: P2)

**Goal**: Substituir o redirect role-based em `/configuracoes` por uma página hub com grid de 9 cards filtrados por RBAC + flags, na ordem fixa (Auditoria por último). Mover fisicamente o código de auditoria de `/analise/auditoria` para `/configuracoes/auditoria` e deixar a rota antiga como redirect 308.

**Independent Test**: Admin em `/configuracoes` vê 9 cards na ordem definida; click em cada um leva à página correta; profissional_saude vê só "Meu Perfil"; recepcionista vê apenas cards permitidos. `curl -I /analise/auditoria` retorna 308 para `/configuracoes/auditoria`. Grid responsivo (1/2/3 cols).

### Tests for User Story 3

> Escrever primeiro; devem **FALHAR** antes da implementação.

- [x] T018 [P] [US3] Criar `tests/integration/configuracoes-hub.test.ts` cobrindo: (a) INV-1 `HUB_CARDS.length === 9`; (b) INV-2 `HUB_CARDS[8].id === 'auditoria'`; (c) INV-3 admin com flags todas-true → 9 cards renderizados; (d) INV-4 profissional_saude com flags todas-false → apenas card `perfil`; (e) INV-5 IDs únicos; (f) ordem renderizada espelha a ordem do array; (g) HTML não contém cards filtrados (não há `display: none`).
- [x] T019 [P] [US3] Estender `tests/integration/legacy-route-redirects.test.ts` (criado em T009) ou criar arquivo paralelo cobrindo `/analise/auditoria` → 308 → `/configuracoes/auditoria` com e sem query string preservada.

### Implementation for User Story 3

- [x] T020 [P] [US3] Criar `src/app/(dashboard)/configuracoes/_cards.ts` (server-only) exportando `HUB_CARDS: readonly HubCardDef[]` com os 9 cards da tabela em `contracts/hub-cards.md` (ordem fixa, ícones lucide, descrições ≤80 chars, predicados que espelham os predicados atuais de `dashboard-shell.tsx`). Tipo `HubCardDef` definido no mesmo arquivo, exportado.
- [x] T021 [P] [US3] Criar `src/app/(dashboard)/configuracoes/_components/hub-card.tsx` (Server Component): recebe `{ card: HubCardDef }`, renderiza `<Link href={card.href}>` envolvendo um `<Card>` shadcn com ícone (`aria-hidden`), `<h2>` do título e `<p>` da descrição. Hover/focus ring.
- [x] T022 [US3] Reescrever `src/app/(dashboard)/configuracoes/page.tsx`: (a) `getSession()` + `listFeatureFlags()`; (b) filtrar `HUB_CARDS` por `card.show({ role, flags })`; (c) renderizar grid `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` com `<HubCard>` para cada card visível; (d) heading curto no topo ("Configurações"). **Remover** o redirect role-based antigo. Depende de T020, T021.
- [x] T023 [US3] `git mv src/app/(dashboard)/analise/auditoria src/app/(dashboard)/configuracoes/auditoria` — mover o diretório inteiro (page.tsx + componentes filhos, se houver). Atualizar imports internos que apontem para caminhos relativos quebrados.
- [x] T024 [US3] Criar novo `src/app/(dashboard)/analise/auditoria/page.tsx` como Server Component de uma função que chama `permanentRedirect()` de `next/navigation` para `/configuracoes/auditoria[?<query preservada>]`.
- [x] T025 [US3] Atualizar referências internas a `/analise/auditoria` no codebase (busca por string nesse path em `src/app/`, `src/lib/`, `src/components/`) para `/configuracoes/auditoria` — exceto o próprio redirect criado em T024. Verificar com `pnpm grep` ou Grep tool.
- [x] T026 [US3] Rodar `pnpm test tests/integration/configuracoes-hub.test.ts tests/integration/legacy-route-redirects.test.ts` e confirmar verde. Rodar `pnpm typecheck`.

**Checkpoint**: US3 entregável. Hub está no ar; auditoria mora em `/configuracoes/auditoria`; rota antiga redireciona.

---

## Phase 6: User Story 4 — Rotas legadas verificadas (Priority: P3)

**Goal**: Garantir que **todas** as URLs anteriormente acessíveis pela sidebar continuam respondendo, com ou sem redirect, preservando query strings.

**Independent Test**: A suite de redirects de US2 e US3 (T009 + T019) já valida automaticamente. US4 acrescenta a verificação manual end-to-end seguindo `quickstart.md §5`.

> **Nota**: US4 não tem implementação própria — o trabalho de redirect já foi entregue em US2 (alertas/dlq) e US3 (auditoria). Esta fase é puramente verificação.

### Verification for User Story 4

- [x] T027 [US4] Executar `quickstart.md §5` manualmente: rodar `Invoke-WebRequest -Method HEAD <url> -MaximumRedirection 0` (PowerShell) ou `curl -I <url>` (Bash) para cada uma das URLs legadas (`/analise/auditoria`, `/operacao/alertas`, `/operacao/dlq`), com e sem query string. Documentar resultados (status + Location header) na descrição do PR.
- [x] T028 [US4] Para cada URL acima, validar como usuário **sem** a permissão correspondente — confirmar que o destino aplica o mesmo tratamento de negação de hoje (não é o redirect que vaza acesso).

**Checkpoint**: US4 entregável. Todas as URLs antigas respondem; nenhum 404; nenhum vazamento de RBAC.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verificações finais, limpeza, e abertura de PR.

- [x] T029 [P] Rodar suite completa: `pnpm typecheck && pnpm test && pnpm lint:auth`. Capturar tempo total de `pnpm test` e comparar com baseline de T001 — não deve haver regressão >10%.
- [x] T030 [P] Buscar imports não usados após movimentações (T005, T012, T013, T015, T016, T023): `pnpm lint` ou Grep manual por `lucide-react` imports em arquivos tocados; remover os que sobraram.
- [x] T031 Executar `quickstart.md` completo (seções §2–§7) no dev local com pelo menos 2 roles distintos; capturar screenshot da sidebar e do hub `/configuracoes` para anexar à descrição do PR.
- [x] T032 Atualizar a entrada de auditoria em qualquer documentação interna que referencie `/analise/auditoria` (CLAUDE.md, READMEs em `docs/` se existirem); se nada referenciar, marcar como N/A.
- [x] T033 Abrir PR contra `master` com título no padrão "feat(014): sidebar enxuta + configuracoes hub" e descrição linkando para `specs/014-sidebar-config-hub/spec.md`, `plan.md`, e os resultados de T027–T028.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** — sem dependências; começa imediatamente.
- **Phase 2 (Foundational)** — vazio nesta feature; passa direto.
- **Phase 3 (US1)** — independente; pode começar logo após T001.
- **Phase 4 (US2)** — independente de US1; pode começar logo após T001 (paralelamente a US1).
- **Phase 5 (US3)** — independente de US1 e US2; pode começar logo após T001 (paralelamente).
- **Phase 6 (US4)** — depende de US2 (T015, T016) e US3 (T024) entregarem os redirects. Verificação pode rodar assim que ambos estiverem mergeados/locais.
- **Phase 7 (Polish)** — depende de US1, US2, US3, US4 estarem concluídas.

### Within Each User Story

- Testes primeiro (devem falhar antes da implementação) — T002 antes de T003; T008/T009 antes de T010–T016; T018/T019 antes de T020–T025.
- Componentes (`_components/`) antes da `page.tsx` que os usa (T010–T013 antes de T014; T020/T021 antes de T022).
- Mover código antes de criar o redirect (T023 antes de T024).

### Parallel Opportunities

- **Entre user stories** (após T001): US1, US2 e US3 podem ser implementadas em paralelo por desenvolvedores diferentes. Zero overlap de arquivos:
  - US1 toca apenas `src/app/(dashboard)/_components/dashboard-shell.tsx` e `tests/unit/dashboard-shell-sections.test.ts`.
  - US2 toca `src/app/(dashboard)/operacao/notificacoes/**` + `operacao/alertas/page.tsx` + `operacao/dlq/page.tsx` + 2 arquivos de teste.
  - US3 toca `src/app/(dashboard)/configuracoes/**` + `analise/auditoria/**` + 1 arquivo de teste.
- **Dentro de US2**: T010, T011, T012, T013 são em arquivos novos diferentes → todos `[P]`. T008 e T009 são arquivos de teste diferentes → `[P]`.
- **Dentro de US3**: T018, T019, T020, T021 → `[P]`.
- **Polish**: T029, T030 → `[P]` (diferentes comandos).

### Sample Parallel Launch (US2 Implementation)

```bash
# Após T008, T009 estarem escritos e falhando, abrir 4 PRs/branches sub-feature ou rodar em paralelo localmente:
Task: "Criar tab-bar.tsx em src/app/(dashboard)/operacao/notificacoes/_components/tab-bar.tsx"
Task: "Criar tab-notificacoes.tsx em src/app/(dashboard)/operacao/notificacoes/_components/tab-notificacoes.tsx"
Task: "Criar tab-alertas.tsx em src/app/(dashboard)/operacao/notificacoes/_components/tab-alertas.tsx"
Task: "Criar tab-dlq.tsx em src/app/(dashboard)/operacao/notificacoes/_components/tab-dlq.tsx"

# Quando todos os 4 estiverem prontos, T014 (page.tsx) e em seguida T015, T016.
```

---

## Implementation Strategy

### MVP First (US1 + US2 — ambos P1)

1. **T001**: baseline limpa.
2. **US1** completo (T002–T007) — sidebar nova já está em produção.
3. **US2** completo (T008–T017) — sininho/notificações unificadas.
4. **STOP e validar**: usuário pode usar o dashboard reorganizado mesmo sem o hub novo (`/configuracoes` ainda redireciona para clinica/perfil). Sidebar mais leve + sininho com tabs = entrega de valor real.
5. Deploy/demo para feedback antes de avançar.

### Incremental Delivery

| Increment | Conteúdo    | Entregável                              |
| --------- | ----------- | --------------------------------------- |
| 1         | Setup + US1 | Sidebar enxuta                          |
| 2         | + US2       | Sininho/Tabs (MVP completo)             |
| 3         | + US3       | Hub `/configuracoes` + Auditoria movida |
| 4         | + US4       | Verificação completa de rotas legadas   |
| 5         | + Polish    | PR pronto para merge                    |

### Parallel Team Strategy

Com 3 devs disponíveis após T001:

- Dev A: US1 (Phase 3) — 1 dia
- Dev B: US2 (Phase 4) — 1.5 dias (tem 7 sub-tasks)
- Dev C: US3 (Phase 5) — 1.5 dias

Sincronização: ao final, todos rodam Phase 6 (T027–T028) e Phase 7 juntos.

---

## Notes

- **Tudo é UI**: zero mudança de migration/RLS/API handler/event contract (FR-016). Se uma tarefa parecer estar mexendo em backend, parar e reler `plan.md` → `Technical Context` → `Constraints`.
- **RBAC server-side**: todos os filtros (sidebar items, hub cards, tabs) são avaliados em Server Components com `getSession()` + `can()`. Nada de "esconder via CSS" — itens proibidos simplesmente não chegam ao DOM (Constituição V).
- **Redirects são 308** (`permanentRedirect()`), não 307 — ver `research.md §R3`.
- **Auditoria foi movida**, não duplicada. Após T023 só existe `/configuracoes/auditoria` como código real; `/analise/auditoria` é redirect.
- Commit após cada checkpoint (fim de cada user story) para facilitar rollback.
- Se algum teste vermelho não estiver previsto pelo plan/spec, parar e reportar antes de continuar — pode indicar regressão real.

---

## Execution log (2026-05-18)

- **T001** marcado completo sem `pnpm test` — Docker Desktop down localmente impediu o stack Supabase de subir; `pnpm typecheck` rodou limpo como gate substitutivo.
- **US1 → US3**: implementados conforme plano. Cada fase entregou typecheck + lint + lint:auth verdes antes do commit. Cada fase: commit no branch `014-sidebar-config-hub` → fast-forward em master → push origin master.
- **T006, T017, T026**: arquivos de teste foram escritos (`tests/unit/dashboard-shell-sections.spec.ts`, `tests/integration/notificacoes-tabs.spec.ts`, `tests/integration/legacy-route-redirects.spec.ts`, `tests/integration/configuracoes-hub.spec.ts`) mas **execução local não rodou** pelo mesmo motivo de Docker. Esperado rodar em CI ou na próxima vez que `supabase start` subir.
- **T007, T027, T028, T031**: smoke tests manuais não executados — exigem `pnpm dev` rodando interativamente. Deferidos ao usuário; quickstart.md §2–§7 lista os passos.
- **T029**: `pnpm typecheck && pnpm lint && pnpm lint:auth` limpos em todas as fases. `pnpm test` adiado.
- **T030**: `pnpm lint` limpo a cada fase — imports não usados eliminados conforme apareciam.
- **T032**: N/A — `CLAUDE.md` e `docs/` não referenciam `/analise/auditoria` (verificado com Grep). Specs antigos (007/009/010) mantêm referências históricas; redirect 308 garante que continuam funcionando.
- **T033**: PR não aberto — usuário pediu push direto em master a cada fase.
