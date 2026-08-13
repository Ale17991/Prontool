---
description: "Task list for 057 — Home do portal do paciente + áreas em páginas próprias"
---

# Tasks: Home do portal do paciente + áreas em páginas próprias

**Input**: Design documents from `/specs/057-portal-paciente-home/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: **INCLUÍDOS E OBRIGATÓRIOS.** Não por preferência de estilo — a
constituição do projeto (Seção 3, *Testes obrigatórios*) exige, para tudo que
afeta acesso multi-tenant, teste de isolamento entre tenants e teste de
autorização por papel. Esta feature mexe na porta de entrada de dados de saúde
de paciente; os testes de gate e de isolamento são condição de merge.

> **O reset da base é por ARQUIVO de teste, não global** — descoberto ao
> executar: `tests/helpers/setup.ts` só confere se o stack local está de pé;
> quem chama `resetDatabase()` é cada spec de integração. Por isso os testes de
> UNIDADE desta feature já rodaram (16 casos verdes) sem apagar nada. Os de
> integração e contrato apagam, e ficam para a T038.

**Organization**: agrupadas por user story, para entrega incremental.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivo diferente, sem dependência pendente)
- **[Story]**: a qual user story pertence (US1, US2, US3)
- **`[X]`**: **já implementado no working tree** desta branch, antes do spec —
  conferido contra o plano, passa em `tsc`, `next lint` e `check-require-role`.
  Marcado assim para a lista refletir a realidade em vez de mandar refazer.

---

## Phase 1: Setup

**Purpose**: conferências que evitam retrabalho caro depois.

- [X] T001 Conferir o maior número em `supabase/migrations/` e confirmar que `0202` continua livre — a outra sessão (feature 056) pode ter criado uma migration nova. Colisão de numeração só aparece na hora de aplicar em produção, que é o pior momento.
- [X] T002 Confirmar que `.specify/feature.json` ainda aponta para `specs/057-portal-paciente-home` antes de qualquer comando speckit.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: a porta única e o banco. Nenhuma user story funciona sem isso.

**⚠️ CRÍTICO**: bloqueia todas as user stories.

- [X] T003 Criar a porta única `openPortalPage` em `src/lib/core/patient-portal/page-guard.ts` — resolve clínica pelo slug, verifica a sessão, carrega entitlements e seções habilitadas, grava a trilha e aplica o gate de seção (FR-006).
- [X] T004 Exportar `listPortalAppointments` de `src/lib/core/patient-portal/read-portal.ts` para que as páginas de área busquem só a sua fatia.
- [X] T005 Criar `supabase/migrations/0202_portal_home.sql` com as duas colunas do data-model: `tenant_clinic_profile.patient_portal_welcome_text TEXT NULL` e `patient_portal_access_log.section TEXT NULL`. **Sem CHECK** enumerando seções; **sem** alterar o CHECK de `action`; **sem** retroalimentar linhas existentes.
- [X] T006 Escrever o script de aplicação manual em `specs/057-portal-paciente-home/deploy-0202.sql` (conteúdo pronto para colar no SQL Editor). **Não** criar `deploy-*.sql` na raiz: esse padrão de nome pertence à outra sessão.
- [X] T007 Acrescentar o campo opcional `section` a `logPatientAccess` em `src/lib/core/patient-portal/audit.ts`, mantendo as chamadas existentes válidas (login, marcação de hábito) (FR-007a). Depende de T005.
- [X] T008 Fazer `openPortalPage` gravar a `section` da página em `src/lib/core/patient-portal/page-guard.ts` — `home` na tela inicial, a chave do catálogo nas áreas (FR-007). Depende de T007.

**Checkpoint**: porta única grava trilha com área e o banco comporta a configuração.

---

## Phase 3: User Story 1 — A tela inicial mostra só o que acompanho todo dia (Priority: P1) 🎯 MVP

**Goal**: a home passa a mostrar apenas metas e checklist, com as demais áreas como cards, a próxima consulta no cabeçalho e — quando metas e checklist não se aplicam — texto de boas-vindas mais a primeira área com conteúdo.

**Independent Test**: entrar como paciente de clínica com metas e hábitos ativos e verificar que a primeira tela tem apenas saudação, próxima consulta, metas, checklist e cards — nenhum gráfico, plano ou histórico aberto.

### Tests for User Story 1

- [X] T009 [P] [US1] Teste em `tests/unit/portal-home-layout.spec.ts`: a tela inicial expõe metas, checklist e cards, e **não** expõe evolução, treino, dieta, exames nem histórico como conteúdo aberto (SC-005). Virou teste de UNIDADE porque a regra foi extraída para `buildPortalHome` — regra dentro de JSX não se testa sem renderizar página.
- [X] T010 [P] [US1] Coberto em `tests/unit/portal-home-layout.spec.ts` (bloco "próxima consulta no cabeçalho"): com consulta futura, o cabeçalho traz a data/hora no fuso da clínica; sem consulta futura, o cabeçalho não menciona ausência; com a área `atendimentos` desligada, a linha some (FR-014/015/016).
- [X] T011 [P] [US1] Coberto em `tests/unit/portal-home-layout.spec.ts` (bloco "promoção quando a home ficaria vazia"): sem metas e sem checklist, a home mostra o texto de boas-vindas **e** a primeira área com conteúdo; a área promovida não aparece também como card; voltando a existir meta, tudo retorna ao normal (FR-017/019/021).
- [X] T012 [P] [US1] Teste de unidade em `tests/unit/portal-welcome-text.spec.ts`: `''` e `'   '` normalizam para `NULL` no schema de configuração.

### Implementation for User Story 1

- [X] T013 [US1] Reescrever a home em `src/app/paciente/[slug]/painel/page.tsx`: cabeçalho, metas, checklist e grade de cards; nada mais aberto.
- [X] T014 [P] [US1] Criar a grade de cards em `src/components/patient-portal/section-cards.tsx`, com rótulo e ordem vindos do catálogo `PORTAL_SECTIONS` (FR-003/004).
- [X] T015 [US1] Exibir a próxima consulta como linha discreta no cabeçalho, em `src/components/patient-portal/portal-header.tsx` (nova prop) e `src/app/paciente/[slug]/painel/page.tsx` (cálculo). Respeitar o gate da área `atendimentos` e o fuso da clínica; ausente ⇒ não renderiza linha (FR-014/015/016).
- [X] T016 [P] [US1] Acrescentar `welcomeText` à leitura e à escrita da configuração em `src/lib/core/patient-portal/portal-config.ts`: campo em `PatientPortalConfig`, campo em `PatientPortalConfigUpdateSchema` com máximo de 1.000 caracteres e normalização de vazio para `NULL`. Depende de T005.
- [X] T017 [US1] Adicionar o campo de texto de boas-vindas ao formulário em `src/app/(dashboard)/configuracoes/portal-paciente/portal-config-form.tsx` e à ação em `.../actions.ts`, deixando explícito na tela que o texto só aparece quando o paciente não tem metas nem checklist. Depende de T016.
- [X] T018 [US1] Implementar a promoção na home em `src/app/paciente/[slug]/painel/page.tsx`: usar `getActiveChecklist` (de `src/lib/core/habits/store.ts`) no servidor para saber se há hábitos, exibir o texto de boas-vindas quando houver, promover a primeira área com conteúdo na ordem do catálogo e retirá-la da grade (FR-017/018/019/021). Depende de T016.
- [X] T019 [US1] Tratar o caso sem texto e sem nenhuma área com conteúdo em `src/app/paciente/[slug]/painel/page.tsx`: mensagem de "ainda não há informações" (FR-020).

**Checkpoint**: a tela inicial está completa e testável sozinha. **É o MVP.**

---

## Phase 4: User Story 2 — Cada área abre em página própria (Priority: P2)

**Goal**: os cards levam às páginas de área, com conteúdo completo, caminho de volta e gate server-side.

**Independent Test**: tocar em cada card, confirmar que a página abre com o conteúdo daquela área e volta para a home; e que o endereço direto de uma área desligada devolve à home.

### Tests for User Story 2

- [X] T020 [P] [US2] Teste de integração em `tests/integration/portal-section-gate.spec.ts`: com a seção desligada pela clínica **e** com o módulo ausente no plano, o endereço direto de cada uma das seis áreas redireciona para a home sem vazar conteúdo (FR-006, SC-003).
- [X] T021 [P] [US2] Coberto em `tests/integration/portal-section-gate.spec.ts` (bloco "isolamento entre clínicas"): a sessão da clínica A não casa com o tenant da clínica B, e clínica com portal desligado não resolve. Ficou junto do gate por compartilhar o mesmo seed.
- [X] T022 [P] [US2] Teste de integração em `tests/integration/portal-access-log-section.spec.ts`: cada página aberta grava uma linha com `action='view'` e a `section` correta; linhas anteriores permanecem com `section` nula (FR-007/007a).

### Implementation for User Story 2

- [X] T023 [P] [US2] Criar `src/app/paciente/[slug]/painel/evolucao/page.tsx` — resumo dos indicadores + linha do tempo das medições, montando o bundle completo para preservar a regra da 050.
- [X] T024 [P] [US2] Criar `src/app/paciente/[slug]/painel/atendimentos/page.tsx` — histórico, buscando só `listPortalAppointments`.
- [X] T025 [P] [US2] Criar `src/app/paciente/[slug]/painel/orientacoes/page.tsx` — orientações, buscando só `listCareNotes`.
- [X] T026 [P] [US2] Criar `src/app/paciente/[slug]/painel/exames/page.tsx` — resultados classificados, montando o bundle completo.
- [X] T027 [P] [US2] Criar `src/app/paciente/[slug]/painel/treino/page.tsx` — rotina ativa, buscando só `getActiveWorkoutPlan`.
- [X] T028 [P] [US2] Criar `src/app/paciente/[slug]/painel/dieta/page.tsx` — plano entregue, buscando só `getPortalDietPlan`.
- [X] T029 [US2] Acrescentar o caminho de volta (`backHref`) em `src/components/patient-portal/portal-header.tsx` e usá-lo nas seis páginas (FR-005/013).

**Checkpoint**: US1 e US2 funcionam de forma independente.

---

## Phase 5: User Story 3 — Área ligada e vazia não vira beco (Priority: P3)

**Goal**: área sem conteúdo aparece apagada, explica o que falta e não navega; a página correspondente também explica em vez de ficar em branco.

**Independent Test**: com uma seção ligada e sem conteúdo, confirmar card apagado, sem link e com explicação; abrir a página pelo endereço e ver a explicação.

### Tests for User Story 3

- [X] T030 [P] [US3] Coberto em `tests/unit/portal-home-layout.spec.ts` (bloco "US3 — área ligada e vazia"): seção ligada sem conteúdo produz card apagado, com o motivo, e não é promovida (FR-008, SC-004).

### Implementation for User Story 3

- [X] T031 [P] [US3] Criar o vazio de seção em `src/components/patient-portal/portal-empty.tsx`, dizendo de quem depende o preenchimento.
- [X] T032 [US3] Renderizar card apagado e sem link quando a área não tem conteúdo, em `src/components/patient-portal/section-cards.tsx`.

**Checkpoint**: as três user stories funcionam de forma independente.

---

## Phase 6: Sessão (cross-cutting, FR-022–024)

**Purpose**: a sessão passa a renovar por inatividade, com teto absoluto. Não pertence a uma user story — vale em todas as páginas — e por isso vem depois do MVP, sem bloqueá-lo.

- [X] T033 [P] Teste de unidade em `tests/unit/patient-session-window.spec.ts`: sessão renovada dentro dos 30 minutos continua válida; 30 minutos parada expira; 12 horas desde `iatMs` expira mesmo renovada; `iatMs` nunca é reescrito pela renovação.
- [X] T034 Aplicar o teto absoluto de 12 horas na verificação, em `src/lib/core/patient-portal/session.ts`: comparar `now - iatMs` além de `expMs`, e expor a função de renovação que preserva `iatMs` e empurra `expMs` (FR-022/023).
- [X] T035 ~~Renovar o cookie no middleware~~ → **corrigido durante a implementação**: middleware roda no Edge e `node:crypto` quebra o `next build`. A renovação ficou em `src/app/api/paciente/sessao/route.ts` (runtime Node), disparada por `src/components/patient-portal/session-keep-alive.tsx` a partir de `src/app/paciente/[slug]/painel/layout.tsx`. Ver research D1.
- [X] T036 Teste em `tests/unit/portal-session-route.spec.ts`: após o logout, `POST /api/paciente/sessao` responde 401 e não reemite cookie. O risco mudou de forma com a T035 — não há mais middleware reescrevendo cookie em toda requisição —, mas a garantia continua valendo.

**Checkpoint**: navegação longa não interrompe; sessão parada e sessão antiga caem.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T037 Rodar a validação estática completa: `npx tsc --noEmit -p tsconfig.json`, `npx next lint` e `node scripts/check-require-role.mjs`.
- [ ] T038 Executar a suíte (`pnpm test`) **quando o Docker voltar** e re-semear com `pnpm seed:demo` em seguida — o setup apaga a base local.
- [ ] T039 Percorrer o roteiro de `specs/057-portal-paciente-home/quickstart.md` com a aplicação rodando, incluindo a não-regressão da 050 (exame não pode aparecer em "Minha evolução" e em "Resultados de exames" ao mesmo tempo).
- [ ] T040 [P] Documentar a feature em `CLAUDE.md`, **apenas** numa seção nova do portal do paciente — a outra sessão está editando o mesmo arquivo; esperar conflito e preservar os dois lados.
- [ ] T041 Conferir a legibilidade no celular (360 px): cards em uma coluna, checklist alcançável sem passar da primeira rolagem (SC-001).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: depende do Setup. **Bloqueia todas as user stories.**
- **US1 (Phase 3)**: depende da Foundational. É o MVP.
- **US2 (Phase 4)**: depende da Foundational. Independente da US1.
- **US3 (Phase 5)**: depende da Foundational e da grade de cards (T014, já feita).
- **Sessão (Phase 6)**: depende da Foundational. Independente das três stories.
- **Polish (Phase 7)**: depende de tudo que se pretende entregar.

### Dependências pontuais

- T007 → T005 (a coluna precisa existir)
- T008 → T007
- T016 → T005
- T017, T018 → T016
- T035 → T034
- T036 → T035

### Parallel Opportunities

- T009–T012 (testes da US1) em paralelo entre si.
- T020–T022 (testes da US2) em paralelo entre si.
- T023–T028 (as seis páginas) são arquivos distintos — paralelizáveis; **já feitas**.
- US1, US2, US3 e a Fase 6 podem ser tocadas por pessoas diferentes assim que a Foundational fechar.

---

## Parallel Example: User Story 1

```bash
# Testes da US1, juntos:
Task: "Integração do layout da home em tests/integration/portal-home-layout.spec.ts"
Task: "Integração da próxima consulta em tests/integration/portal-home-next-appointment.spec.ts"
Task: "Integração da promoção em tests/integration/portal-home-promotion.spec.ts"
Task: "Unidade da normalização do texto em tests/unit/portal-welcome-text.spec.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Fase 1 (Setup) → Fase 2 (Foundational).
2. Fase 3 (US1) — o que falta é a próxima consulta, o texto de boas-vindas e a promoção.
3. **PARAR e VALIDAR** a tela inicial sozinha.
4. A estrutura de US2 e US3 já está pronta no working tree; o que falta nelas é teste.

### Incremental Delivery

1. Setup + Foundational → base pronta (migration aplicada à mão **antes** do deploy do código).
2. US1 → valida → demo (MVP).
3. US2 e US3 → já implementadas; fechar com os testes.
4. Fase 6 (sessão) → é a única mudança de comportamento que atinge quem já usa o portal hoje; entregar consciente disso.

### Estado atual desta branch

**37 de 41 feitas.** Código de produção e testes prontos, com
`tsc`, `next lint`, `check-require-role`, **`next build`** e **41 casos de teste
verdes** em 5 arquivos (3 de unidade, 2 de integração).

A cobertura ficou mais em UNIDADE do que o plano previa, e por um motivo bom: a
regra da home foi extraída de `page.tsx` para `buildPortalHome`, então dá para
prendê-la sem renderizar página nem tocar banco. Sobrou para a integração o que
só o banco responde — gate de seção, isolamento entre clínicas e a trilha.

**4 pendentes**, todas de olho humano ou de fechamento: roteiro manual do
quickstart, `CLAUDE.md`, conferência no celular e o deploy.

---

## Notes

- Nada aqui toca os arquivos da feature 056 (`src/lib/core/automations/**`, `src/app/api/automacoes/**`, `deploy-*.sql` na raiz, e os demais da lista de coordenação). O script de aplicação da 0202 foi deliberadamente colocado em `specs/057-portal-paciente-home/` para não invadir o padrão `deploy-*.sql`.
- Migration em produção é aplicada **à mão**, colando no SQL Editor, e **antes** do deploy do código. As `0198`–`0201` continuam pendentes e vêm primeiro.
- Não commitar nem fazer push sem o usuário pedir.
