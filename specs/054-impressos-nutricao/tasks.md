---
description: "Task list — 054 Impressos da consulta de nutrição"
---

# Tasks: Impressos da consulta de nutrição

**Input**: Design documents from `/specs/054-impressos-nutricao/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: incluídos e **obrigatórios**. A constituição (§ Fluxo de Desenvolvimento) exige teste de isolamento entre tenants e de autorização por papel em tudo que toca acesso multi-tenant — e toda rota aqui devolve dado clínico de paciente. Somam-se testes que comparam o número impresso com o da tela: é o risco número um da feature, e o único jeito de travá-lo é automatizado.

**Organização**: agrupadas por user story, cada uma entregável e testável isoladamente.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: paralelizável (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1 / US2 / US3 / US4 / US5

## Path Conventions

Projeto único Next.js: `src/` e `tests/` na raiz. **Sem migrations** — esta feature só lê.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: nada a instalar. Esta fase só confirma o terreno.

- [X] T001 Confirmar que `@react-pdf/renderer` ^3.4.4 responde no ambiente e que `Svg`, `Polyline` e `Circle` estão exportados (research D3 depende disso). Um teste unitário em `tests/unit/printouts-renderer-primitives.spec.ts` que importa as primitivas serve de guarda: se uma atualização de dependência removê-las, a curva de crescimento quebra silenciosamente.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: os blocos que todo impresso usa. **Nenhuma user story começa antes desta fase fechar.**

- [X] T002 Criar `src/lib/core/nutrition/printouts/shared.tsx` com os estilos comuns (página A4, Helvetica, corpo 9–11) e os blocos: `PatientBlock` (nome, nascimento, idade), `PrintFooter` (paginação `página X de Y`, profissional emissor, data de emissão) e `DraftStamp`. **O rodapé e a identificação do paciente MUST repetir em toda página** (FR-015) — folhas soltas se separam.
- [X] T003 [P] No mesmo `shared.tsx`, `fmt(value, unit)` e `dash(value)`: número ausente vira travessão, **nunca zero** (FR-008, research D4). É a mesma distinção que o rótulo nutricional já faz entre "é zero" e "não sei"; aqui ela vale para todos os nove documentos.
- [X] T004 [P] Criar `src/lib/pdf/evolution-columns.tsx` — layout de **até três** colunas de avaliação em A4 retrato, cada coluna com data e **protocolo** no cabeçalho. Com menos de três, renderiza só as existentes (FR-005), sem coluna vazia.
- [X] T005 [P] Teste unitário em `tests/unit/printouts-shared.spec.ts`: `dash` devolve travessão para `null`/`undefined`/`NaN` e devolve `"0"` para o zero de verdade; `evolution-columns` com 1, 2 e 3 colunas produz respectivamente 1, 2 e 3 colunas, e com 5 entradas usa as 3 mais recentes.
- [X] T006 Criar `src/lib/core/nutrition/printouts/guard.ts` — helper único de rota: resolve sessão, aplica `requireRole(['admin','profissional_saude'])`, checa o módulo exigido, recusa **paciente anonimizado com 409** e devolve 404 (não 403) para paciente de outra clínica. Centralizar evita que a sétima rota esqueça uma das quatro regras.
- [X] T007 [P] Teste de contrato em `tests/contract/printouts-rbac.spec.ts` cobrindo o guard: `recepcionista` e `financeiro` → 403; módulo desligado → 404 `MODULE_DISABLED`; paciente de outra clínica → **404** (nunca 403, que confirmaria a existência); paciente anonimizado → 409.

**Checkpoint**: blocos comuns prontos e o guard testado. As histórias podem começar.

---

## Phase 3: User Story 1 - Plano alimentar impresso (Priority: P1) 🎯 MVP

**Goal**: a nutricionista termina o cardápio e entrega o PDF ao paciente.

**Independent Test**: montar plano com quatro refeições, uma com grupo de substituição, e conferir que o PDF traz quantidades, medidas caseiras, o "ou" do grupo e os totais iguais aos da tela.

### Tests for User Story 1

- [X] T008 [P] [US1] Teste unitário em `tests/unit/printouts-plan.spec.ts`: montar o mesmo plano pela função da tela (`diet/totals`) e pelo modelo do PDF; **os totais MUST ser idênticos**. É o teste que trava o risco nº 1 do plano — divergência entre papel e tela.
- [X] T009 [P] [US1] No mesmo arquivo: refeição com grupo de substituição conta a energia do grupo **uma vez**, e não uma por opção (FR-009). Plano em rascunho produz `isDraft: true`.

### Implementation for User Story 1

- [X] T010 [US1] Criar `src/lib/core/nutrition/printouts/plan-pdf.tsx` — refeições com horário e `%` da meta quando houver, itens com gramas e medida caseira, grupos como alternativas marcadas "ou", totais de energia e macros, textos de observação. **Recebe o resultado pronto de `getDietPlanForPatient`; não recalcula nada** (research D2).
- [X] T011 [US1] Tarja de rascunho quando `status = 'rascunho'` (FR-010): plano não enviado não pode circular como prescrição.
- [X] T012 [US1] Criar `src/app/api/pacientes/[id]/plano-alimentar/pdf/route.ts` usando o guard (T006), gate `dieta`, `runtime = 'nodejs'`, `content-disposition` com nome legível e `cache-control: no-store` (o conteúdo tem PII).
- [X] T013 [US1] Botão "Imprimir plano" em `src/app/(dashboard)/operacao/plano-alimentar/plan-builder-client.tsx`, ao lado de Salvar e Enviar (research D5 — o botão fica onde o dado nasce).
- [X] T014 [US1] Registrar a emissão em `log_audit_event` (Princípio II), no padrão do prontuário.

**Checkpoint**: US1 sozinha já resolve o que acontece em toda consulta. É o MVP.

---

## Phase 4: User Story 2 - Evolução da avaliação (Priority: P1)

**Goal**: o paciente vê a trajetória, não um número solto.

**Independent Test**: com três avaliações salvas, conferir três colunas em ordem cronológica; com uma só, conferir que sai uma coluna.

### Tests for User Story 2

- [X] T015 [P] [US2] Teste unitário em `tests/unit/printouts-assessment.spec.ts`: com cinco avaliações, saem **as três mais recentes**, da mais antiga para a mais nova. Com uma, sai uma. Nenhuma coluna vazia é criada.
- [X] T016 [P] [US2] No mesmo arquivo: **coluna sem protocolo não é renderizada** (invariante 4 do data-model). Comparar dobras com bioimpedância lado a lado sem dizer o método induz a leitura errada, porque os dois não são comparáveis.

### Implementation for User Story 2

- [X] T017 [US2] Criar `src/lib/core/nutrition/printouts/assessment-pdf.tsx` sobre o `evolution-columns`: peso, IMC e classificação, dobras informadas, %gordura **com a classificação de Pollock & Wilmore**, massa magra e gorda, circunferências, RCQ e classificação, TMB, GET e VET.
- [X] T018 [US2] Linha de variação entre a primeira e a última coluna (peso, %gordura, massa magra) — é o número que responde "melhorei?".
- [X] T019 [US2] Criar `src/app/api/pacientes/[id]/avaliacao-nutricional/pdf/route.ts`, com `?limite=3` (padrão e máximo 3, research D7).
- [X] T020 [US2] Botão na tela de avaliação nutricional (`assessment-client.tsx`).

**Checkpoint**: US1 e US2 cobrem as duas entregas de maior valor.

---

## Phase 5: User Story 3 - Orientações e anamnese (Priority: P2)

**Goal**: entregar o texto que já existe no sistema.

**Independent Test**: registrar duas orientações e imprimir; aplicar uma anamnese com perguntas em branco e imprimir.

### Tests for User Story 3

- [X] T021 [P] [US3] Teste unitário em `tests/unit/printouts-notes.spec.ts`: **pergunta sem resposta aparece em branco, não some** (cenário de aceite da US3). Uma anamnese impressa com perguntas ausentes esconderia que o dado não foi coletado.

### Implementation for User Story 3

- [X] T022 [US3] Criar `src/lib/core/care-notes/notes-pdf.tsx` — cada orientação com sua data e o texto íntegro, com quebra de página limpa (o guia FODMAP tem ~2.900 caracteres e atravessa página).
- [X] T023 [US3] Criar `src/app/api/pacientes/[id]/orientacoes/pdf/route.ts`.
- [X] T024 [US3] **Aproveitar `src/lib/core/anamnesis/export-pdf.tsx`**, que já existe e é código morto (research D1): ligar a `src/app/api/pacientes/[id]/anamnese/[recordId]/pdf/route.ts` em vez de escrever outro componente. Ajustar o que faltar (rodapé, paginação, perguntas em branco).
- [X] T025 [US3] Botões nas seções de Orientações e de Anamnese do prontuário.

---

## Phase 6: User Story 4 - Recordatório e exames (Priority: P2)

**Goal**: fechar o conjunto de documentos da consulta.

**Independent Test**: imprimir um recordatório e um quadro de exames, conferindo valores contra a tela.

### Tests for User Story 4

- [ ] T026 [P] [US4] Teste unitário em `tests/unit/printouts-labs.spec.ts`: **exame sem faixa cadastrada sai SEM classificação** (FR-011). Classificá-lo como normal seria afirmar o que não se sabe — é o mesmo erro que a 050 já evitou na tela.
- [ ] T027 [P] [US4] Teste unitário em `tests/unit/printouts-recall.spec.ts`: totais do recordatório iguais aos da tela.

### Implementation for User Story 4

- [ ] T028 [P] [US4] Criar `src/lib/core/nutrition/printouts/recall-pdf.tsx` — refeições, itens, totais e adequação quando houver.
- [ ] T029 [P] [US4] Criar `src/lib/core/nutrition/printouts/labs-pdf.tsx` — por painel: exame, valor, unidade, faixa e classificação.
- [ ] T030 [US4] Criar as rotas `recordatorio/pdf` (com `?data=`) e `exames/pdf`.
- [ ] T031 [US4] Botões nas telas de Recordatório e na seção de Exames.

---

## Phase 7: User Story 5 - Infantil e gestacional (Priority: P3)

**Goal**: atender os dois públicos que têm documento próprio na planilha.

**Independent Test**: paciente pediátrico com aferições gera curvas com o ponto do paciente; gestante gera ganho de peso frente à recomendação.

### Tests for User Story 5

- [ ] T032 [P] [US5] Teste unitário em `tests/unit/printouts-growth.spec.ts`: o documento usa as primitivas SVG (a curva é **desenhada**, não é tabela — research D3) e o ponto do paciente cai no lugar certo do eixo. Fora de 0–19 anos, o impresso não é gerado.

### Implementation for User Story 5

- [ ] T033 [US5] Criar `src/lib/core/nutrition/printouts/growth-pdf.tsx` — peso/idade, estatura/idade e IMC/idade com `Svg`/`Polyline`/`Circle`, mais a classificação da última aferição.
- [ ] T034 [US5] Criar `src/app/api/pacientes/[id]/crescimento/pdf/route.ts`, devolvendo 404 `GROWTH_DISABLED` quando o acompanhamento não está ligado para o paciente.
- [ ] T035 [P] [US5] Criar `src/lib/core/nutrition/printouts/pregnancy-pdf.tsx` e a rota `gestacional/pdf` — IMC pré-gestacional, ganho acumulado por semana e faixa recomendada.
- [ ] T036 [US5] Botões nas seções de curvas de crescimento e de avaliação gestacional.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T037 Conferir quebra de página em documento longo: anamnese de 60 perguntas e plano de 8 refeições. Linha não pode partir ao meio, e a identificação do paciente repete em todas (FR-015).
- [ ] T038 Rodar `pnpm typecheck`, `pnpm lint:auth` e `pnpm lint` — zero erros. `lint:auth` confirma `requireRole` nas sete rotas novas.
- [ ] T039 Rodar a suíte completa **em lotes** (`tests/unit`, depois `tests/contract`, depois `tests/integration`) — a suíte inteira de uma vez é morta pelo runner. ⚠️ `vitest` apaga o banco local: re-semear com `pnpm seed:demo` depois.
- [ ] T040 [P] Atualizar o `CLAUDE.md` com a arquitetura da 054.
- [ ] T041 **Abrir os nove PDFs com olho humano**, seguindo `quickstart.md`. É a dívida recorrente da vertical (046, 047, 049, 050 e 052 foram a produção sem isso) e aqui pesa mais: o artefato É visual.
- [ ] T042 **Conferência com a nutricionista (SC-003)** — comparar cada impresso com o equivalente da planilha, campo a campo, no mesmo paciente. Divergência de número é defeito; divergência de layout é ajuste opcional. **Agendar no início da implementação**, não no fim.
- [ ] T043 Deploy: mergear em `master` + push. **Sem migration**, então a integração Supabase não tem nada a aplicar — é deploy só de código. Se der `MIDDLEWARE_INVOCATION_FAILED`, redeploy na Vercel **sem** cache de build.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sem dependências.
- **Foundational (Phase 2)**: **BLOQUEIA todas as user stories**. T002 e T004 são o alicerce; T006 (guard) é pré-requisito de toda rota.
- **US1 (Phase 3)**: depende da Phase 2. Independente das demais.
- **US2 (Phase 4)**: depende da Phase 2, em especial de T004 (colunas). Independente da US1.
- **US3, US4, US5**: dependem só da Phase 2. Independentes entre si.
- **Polish (Phase 8)**: depois das histórias desejadas.

### User Story Dependencies

Nenhuma história depende de outra. Todas consomem a fundação e leem features já prontas. Isso é consequência de a feature ser camada de apresentação: não há estado compartilhado entre documentos.

### Parallel Opportunities

- T003, T004 e T005 em paralelo, depois de T002.
- Os testes de cada história ([P]) sempre em paralelo entre si.
- **US3, US4 e US5 podem correr em paralelo** entre pessoas diferentes, uma vez fechada a Phase 2 — são arquivos e rotas disjuntos.
- T028 e T029 (recordatório e exames) em paralelo.

---

## Implementation Strategy

### MVP = US1

O plano alimentar impresso sozinho resolve o que acontece em **toda** consulta. Entregar só ele já tira a profissional da planilha no caso mais comum.

1. Phase 1 + Phase 2 → fundação. **Bloqueia tudo.**
2. Phase 3 (US1) → **PARAR E VALIDAR** com a nutricionista antes de seguir. Se o formato do plano estiver errado, os outros oito herdariam o mesmo erro.
3. Phase 4 (US2) → a evolução, que é o segundo documento mais entregue.
4. Phases 5 a 7 conforme a prioridade do momento.

---

## Notes

- **O risco que mata esta feature é o papel discordar da tela.** Por isso nenhum componente recalcula, e por isso T008, T027 e os testes de comparação existem. A revisão de fórmulas de agosto acabou de resolver divergências desse tipo; reintroduzi-las pela impressão seria autodestrutivo.
- **Dado ausente nunca vira zero** — vale para os nove documentos, não só para o rótulo.
- **Sem migration e sem tabela.** Se durante a implementação surgir a tentação de gravar o PDF, parar: está decidido em data-model e research D6 que não se arquiva no v1.
- **Solicitação de exames não é escopo** — já existe desde a 0149.
- Commitar por task ou grupo lógico; parar em qualquer checkpoint para validar a história isoladamente.
