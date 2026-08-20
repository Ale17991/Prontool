---
description: 'Task list — Construtor de automações de mensagem (056)'
---

# Tasks: Construtor de automações de mensagem

**Input**: Design documents from `/specs/056-automacoes-mensagem/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: incluídos e **obrigatórios**. Não é preferência de estilo — a constituição do projeto exige teste de isolamento entre tenants, de autorização por papel e de imutabilidade para qualquer feature que toque essas três coisas, e esta toca as três.

**Organization**: agrupadas por história de usuário, para cada uma ser implementável, testável e entregável sozinha.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: a qual história pertence (US1–US4)

---

## Phase 1: Setup

**Purpose**: registrar a feature no que já existe. Sem dependências novas — o plano é explícito quanto a isso.

- [x] T001 Acrescentar o módulo `automacoes` a `ModuleId` e `ALL_MODULES` em `src/lib/core/entitlements/plans.ts`, com entrada em `MODULE_LABEL` e `MODULE_HINT`
- [x] T002 Encaixar `automacoes` no bloco de plano correspondente em `src/lib/core/entitlements/plans.ts` (o teste de invariante exige que todo `ModuleId` apareça em exatamente um bloco)
- [x] T003 [P] Acrescentar o rótulo do módulo à tela de detalhe da clínica em `src/app/admin/clinicas/[id]/clinic-detail.tsx`

---

## Phase 2: Foundational (Blocking)

**Purpose**: schema, tipos e armazenamento. Nenhuma história começa antes disto.

**⚠️ CRÍTICO**: bloqueia todas as histórias.

- [x] T004 Criar `supabase/migrations/0196_message_automations.sql` com as 4 tabelas de `data-model.md` (`message_templates`, `automation_triggers`, `automations`, `automation_occurrences`), RLS por tenant e índices
- [x] T005 Na mesma migration, acrescentar `patients.automations_opt_in BOOLEAN NOT NULL DEFAULT FALSE` — **default FALSE é deliberado**, ver research D4
- [x] T006 Na mesma migration, acrescentar `tenant_clinic_profile.automation_max_per_patient_day` (default 1) e `automation_max_per_cycle` (default 50)
- [x] T007 Na mesma migration, criar o `UNIQUE (automation_id, patient_id, occurrence_key)` de `automation_occurrences` — é ele que torna "uma vez só" propriedade do banco
- [x] T008 Na mesma migration, criar o trigger append-only de `automation_occurrences` no padrão de `whatsapp_delivery_events`, com as duas exceções declaradas: transição do desfecho provisório para o final, e DELETE permitido **apenas** para linhas com desfecho de supressão
- [x] T009 Na mesma migration, criar o CHECK de consistência de tenant em `automations` (gatilho e mensagem precisam ser do mesmo tenant da automação) — FK sozinha não impede cruzar tenants
- [x] T010 Rodar `pnpm supabase:reset` e `pnpm supabase:gen-types` para regenerar `src/lib/db/types.ts`
- [x] T011 [P] Criar `src/lib/core/automations/types.ts` com `AutomationSource`, desfechos de ocorrência, e as interfaces de fonte descritas em research D3
- [x] T012 [P] Criar `src/lib/core/automations/store.ts` com CRUD de mensagens, gatilhos e automações, sempre filtrando `tenant_id` explicitamente
- [x] T013 Criar `src/lib/core/automations/sources/registry.ts` — o catálogo de fontes, ponto único de extensão. **Não pode conhecer as 5 fontes do v1 nominalmente**: se nascer acoplado, a absorção futura do lembrete (FR-025) vira reescrita
- [x] T014 [P] Criar `src/lib/core/automations/occurrences.ts` com gravação idempotente (`ON CONFLICT DO NOTHING`) e atualização de desfecho

---

## Phase 3: User Story 1 — Montar a primeira automação e vê-la disparar (P1) 🎯 MVP

**Goal**: o laço completo com a fonte mais simples — aniversário. Gatilho, mensagem, consentimento, envio, registro.

**Independent Test**: criar mensagem + gatilho de aniversário, marcar um paciente com aniversário hoje e consentimento ativo, rodar o ciclo e conferir que a mensagem saiu uma vez, com o nome substituído.

- [x] T015 [US1] Implementar a fonte `aniversario` em `src/lib/core/automations/sources/aniversario.ts`: enumeração por dia civil da clínica, `occurrenceKey` = data, variáveis `paciente` e `clinica`
- [x] T016 [P] [US1] Implementar `src/lib/core/automations/render.ts` — substituição `{{variavel}}` no formato já usado por `render-whatsapp.ts`, recusando variável desconhecida
- [x] T017 [US1] Implementar `src/lib/core/automations/evaluate.ts`: varrer automações ativas, chamar a fonte, aplicar consentimento, gravar ocorrência **antes** da tentativa de envio e atualizar o desfecho depois
- [x] T018 [US1] Aplicar em `evaluate.ts` os dois tetos (por paciente/dia e por clínica/ciclo) com ordenação determinística, e gravar supressão com desfecho próprio
- [x] T019 [US1] Ligar o envio à cápsula da 051 em `evaluate.ts`, reusando `sendText` e o registro de entrega — sem abrir segundo caminho de saída
- [x] T020 [US1] Verificar o módulo `automacoes` **dentro** de `evaluate.ts`, não só na tela, e não gerar alerta quando o módulo estiver desligado (não é falha operacional)
- [x] T021 [US1] Chamar a avaliação em `src/app/api/cron/send-reminders/route.ts`, depois do ciclo de lembretes, em `try/catch` próprio — os dois motores não podem se derrubar (research D1)
- [x] T022 [US1] Acrescentar os contadores de automação à resposta da rota de cron, conforme `contracts/api.md`
- [x] T023 [P] [US1] Criar as rotas de mensagem `src/app/api/automacoes/mensagens/route.ts` e `[id]/route.ts` (GET/POST/PATCH/DELETE) com `requireRole('admin')`
- [x] T024 [P] [US1] Criar as rotas de gatilho `src/app/api/automacoes/gatilhos/route.ts` e `[id]/route.ts`, validando `params` pelo schema Zod da fonte
- [x] T025 [US1] Criar as rotas de automação `src/app/api/automacoes/route.ts` e `[id]/route.ts` (listar, criar, ativar/desativar)
- [x] T026 [US1] Implementar `src/lib/core/automations/preview.ts` e a rota `gatilhos/[id]/previa/route.ts`, chamando **a mesma** enumeração do motor (research D6)
- [x] T027 [US1] Criar a tela `src/app/(dashboard)/configuracoes/automacoes/page.tsx` + `automacoes-client.tsx`: lista, criar, ativar com prévia antes de confirmar
- [x] T028 [P] [US1] Criar `mensagens-client.tsx` e `gatilho-form.tsx` na mesma pasta
- [x] T029 [P] [US1] Acrescentar o card de Automações ao hub em `src/app/(dashboard)/configuracoes/_cards.ts`, gated pelo módulo — **atualizar as asserções de contagem e ordem** do teste do hub, que já quebrou duas vezes por card novo
- [x] T030 [P] [US1] Expor `automations_opt_in` na tela do paciente, junto dos outros consentimentos
- [x] T031 [US1] Auditar criação, edição, ativação e desativação via `log_audit_event`
- [x] T032 [P] [US1] Teste de integração `tests/integration/automations-ciclo.spec.ts`: aniversário ponta a ponta, incluindo que rodar o ciclo duas vezes não gera segundo envio
- [x] T033 [P] [US1] Teste de contrato `tests/contract/automations-rbac.spec.ts`: cada papel contra cada rota
- [x] T034 [P] [US1] Teste de contrato `tests/contract/automations-tenant-isolation.spec.ts`: acesso cruzado entre tenants falha, inclusive tentando associar gatilho de um tenant a mensagem de outro
- [x] T035 [P] [US1] Teste de contrato `tests/contract/automations-append-only.spec.ts`: UPDATE e DELETE bloqueados em `automation_occurrences`, exceto as duas transições declaradas
- [x] T036 [P] [US1] Teste unitário `tests/unit/automations-ocorrencia.spec.ts`: chave de ocorrência por fonte e idempotência

**Checkpoint**: MVP entregável. A clínica já cria e ativa uma automação de aniversário que funciona.

---

## Phase 4: User Story 2 — Catálogo de mensagens reutilizáveis (P2)

**Goal**: a mesma mensagem serve vários gatilhos, editar propaga, excluir em uso é recusado.

**Independent Test**: associar uma mensagem a dois gatilhos, editar o texto uma vez, conferir que os dois disparos seguintes usam o texto novo.

- [x] T037 [US2] Implementar a recusa de exclusão de mensagem em uso, **nomeando os gatilhos dependentes** na resposta — "não é possível excluir" sem dizer o quê obriga a clínica a caçar
- [x] T038 [US2] Expor `usadaPor` na listagem de mensagens, para a tela avisar antes da tentativa
- [x] T039 [US2] Validar, **no momento de associar** gatilho a mensagem, que toda variável usada é fornecida pela fonte — erro na tela de quem monta, não mensagem torta no celular do paciente (research D7)
- [x] T040 [US2] Tratar variável sem dado em tempo de envio como `impedido_variavel_ausente`, pulando o envio em vez de mandar texto com lacuna (FR-006)
- [x] T041 [P] [US2] Teste unitário `tests/unit/automations-render.spec.ts`: variável desconhecida recusada, variável ausente pula o envio, edição propaga
- [x] T042 [P] [US2] Teste de integração da recusa de exclusão e da propagação da edição para dois gatilhos

**Checkpoint**: o catálogo é catálogo de verdade, não texto colado em cada gatilho.

---

## Phase 5: User Story 3 — Gatilhos sobre o checklist de hábitos (P3)

**Goal**: as duas fontes de checklist, com o guarda-corpo de linguagem.

**Independent Test**: montar os dois gatilhos, produzir marcações que satisfaçam cada condição, conferir um disparo por período.

- [x] T043 [P] [US3] Implementar `sources/checklist-marcado.ts`: item marcado N vezes no período corrente, `occurrenceKey` = índice do período
- [x] T044 [P] [US3] Implementar `sources/checklist-sem-marcacao.ts`: item sem marcação há N dias
- [x] T045 [US3] Reusar `src/lib/core/habits/period.ts` para o cálculo de período — não reimplementar aritmética de data; mensal segue calendário, não 30 dias
- [x] T046 [US3] Excluir da avaliação paciente sem checklist ativo, e item que não está mais na grade daquele paciente (a grade é ajustável por paciente, via JSONB)
- [x] T047 [US3] Implementar em `gatilho-form.tsx` o aviso do **FR-009**: em fonte de ausência, a tela declara que o dado é "não marcou", nunca "não cumpriu". Texto vem do registro da fonte, não hardcoded na tela
- [x] T048 [P] [US3] Teste unitário `tests/unit/automations-fontes-checklist.spec.ts`: contagem no período, borda de virada de período, item removido da grade
- [x] T049 [P] [US3] Teste garantindo que o texto de aviso da fonte de ausência existe e não afirma descumprimento

**Checkpoint**: o pedido que originou a feature está entregue, e sem afirmar o que o dado não sustenta.

---

## Phase 6: User Story 4 — Gatilhos sobre a agenda (P4)

**Goal**: confirmação de agendamento e paciente sem retorno.

**Independent Test**: marcar um atendimento e conferir a confirmação; marcar um paciente com última consulta há mais de N meses e conferir o disparo, uma vez só.

- [x] T050 [P] [US4] Implementar `sources/confirmacao-agendamento.ts`, `occurrenceKey` = id do atendimento
- [x] T051 [P] [US4] Implementar `sources/sem-retorno.ts`, `occurrenceKey` = mês corrente, com intervalo mínimo de repetição para não virar cobrança mensal eterna
- [x] T052 [US4] Conferir que o teto por clínica segura a primeira execução numa base grande e que o excedente sai nos ciclos seguintes — é o cenário que o SC-004 mede
- [x] T053 [US4] Fazer a prévia avisar quando os candidatos excedem o teto por ciclo (`avisoVolume`), para a clínica saber que a fila vai levar dias
- [x] T054 [P] [US4] Teste de integração `tests/integration/automations-agenda.spec.ts`: confirmação por atendimento, sem-retorno com repetição respeitando o intervalo, e teto segurando volume

**Checkpoint**: as cinco fontes do v1 estão de pé.

---

## Phase 7: Polish

- [x] T055 [P] Excluir da avaliação paciente anonimizado ou inativo (FR-017), com teste — regra ÚNICA em `sources/shared.ts` (`eligiblePatients`), travada por teste que roda contra TODAS as fontes registradas em `tests/integration/automations-fontes-novas.spec.ts`
- [x] T056 [P] Gerar **uma** ocorrência agregada por ciclo quando a clínica não tem canal conectado (FR-021), nunca uma por paciente — mesmo tratamento da 051. É um `dispatchAlert` (dedup por hora), e não linha em `automation_occurrences`: `patient_id` é NOT NULL e o fato não é sobre paciente nenhum; além disso a linha consumiria a chave de quem ainda vai receber quando o número voltar
- [x] T057 [P] Derivar `enviados30d`/`lidos30d` das ocorrências e dos eventos de entrega a cada leitura, nunca como contador gravado (FR-020) — exigiu a migration `0197`: `whatsapp_delivery_events.reminder_id` era NOT NULL com FK para `appointment_reminders`, então TODA confirmação de automação morria no callback como `unknown-reminder`
- [x] T058 Rodar a suíte completa em lotes (`--shard=N/8` na integração — a suíte inteira de uma vez é morta pelo runner) e gravar cada shard em log próprio
- [x] T059 `pnpm typecheck`, `pnpm lint`, `pnpm lint:auth` limpos. **Rodar o typecheck DEPOIS de escrever teste novo** — `vitest` não faz typecheck e o pre-commit só roda `lint`
- [x] T060 Atualizar o `CLAUDE.md` com a seção da feature, no padrão das anteriores
- [ ] T061 Percorrer o `quickstart.md` de ponta a ponta com número real, incluindo os 11 casos da tabela §6
- [ ] T062 **Configurar `QSTASH_TOKEN` e as duas signing keys na Vercel antes de ativar em clínica com base grande** — não é polimento: hoje o envio cai no caminho inline com teto de 10 por ciclo, e o espaçamento é a única mitigação contra bloqueio do número

---

## Dependencies

```
Setup (T001-T003)
   └─→ Foundational (T004-T014)  ⚠️ bloqueia tudo
          ├─→ US1 (T015-T036)  🎯 MVP
          │      ├─→ US2 (T037-T042)   depende do laço de envio existir
          │      ├─→ US3 (T043-T049)   independente de US2
          │      └─→ US4 (T050-T054)   independente de US2 e US3
          └─→ Polish (T055-T062)
```

**US2, US3 e US4 são independentes entre si** — depois do MVP, podem ser feitas em qualquer ordem, ou em paralelo por pessoas diferentes.

## Parallel Opportunities

- **Foundational**: T011, T012 e T014 são arquivos distintos → paralelos. T013 depois de T011.
- **US1**: T023, T024 são rotas distintas → paralelas. Os testes T032–T036 são arquivos distintos → paralelos entre si.
- **US3**: T043 e T044 são fontes distintas → paralelas.
- **US4**: T050 e T051 são fontes distintas → paralelas.
- **Polish**: T055, T056 e T057 tocam pontos distintos → paralelos.

## Implementation Strategy

**MVP = Phase 1 + 2 + 3.** Entrega uma automação de aniversário funcionando ponta a ponta, com consentimento, tetos e registro. É demonstrável para clínica e já resolve um pedido real.

Depois, por valor decrescente: **US3** (o pedido que originou a feature), **US2** (o que torna o catálogo útil quando há muitos gatilhos), **US4** (maior valor percebido, maior risco de volume).

**O que não pode ser adiado para depois do MVP**: os tetos (T018) e o gate de módulo no motor (T020). Ambos parecem polimento e não são — sem os tetos, a primeira automação numa base grande vira rajada; sem o gate no motor, módulo revogado continua enviando para sempre.

---

## Phase 8: Ampliação do catálogo de fontes (pós-MVP)

**Purpose**: o construtor nasceu com cinco fontes porque cinco bastavam para
provar o desenho. O valor para a clínica, porém, é proporcional ao número de
momentos que ela consegue automatizar — e o registro foi feito exatamente para
que acrescentar fonte fosse barato. Estas onze usam dado que já existe no
sistema; nenhuma exigiu migration.

- [x] T063 Estender `AutomationSourceDef` com `group`, `fields` (descritor declarativo de parâmetros) e `requiresModule` — sem isso a tela não tem como montar formulário para fonte nova sem conhecê-la nominalmente
- [x] T064 Criar `sources/shared.ts`: `eligiblePatients` (regra única de FR-017), `pageAll` (o PostgREST corta em 1.000 linhas **sem avisar**) e os helpers de dia civil/fuso
- [x] T065 [P] Agenda: `pre_consulta` (orientação de preparo, com aviso de FR-026 para não colidir com o lembrete), `pos_atendimento` (conta da CONCLUSÃO, não do horário marcado), `falta_consulta` (régua da recepção, 0153), `agendamento_cancelado`
- [x] T066 [P] Relacionamento: `boas_vindas` (chave FIXA — uma vez na vida) e `aniversario_cadastro` (uma consulta com 20 janelas, não 20 consultas)
- [x] T067 [P] Acompanhamento: `meta_atingida` (a ÚLTIMA medição decide, não a melhor), `sem_medicao` (quem nunca mediu não entra), `plano_alimentar_revisao` (módulo `dieta`)
- [x] T068 [P] Financeiro: `parcela_a_vencer` e `parcela_vencida` — variáveis limitadas a valor e data **de propósito** (art. 42 do CDC + tela de bloqueio compartilhada)
- [x] T069 [P] Tratamento e exames: `orcamento_sem_resposta`, `etapa_sem_agendamento` (agrega por paciente, não por etapa), `exame_sem_retorno`
- [x] T070 Formulário `gatilho-form.tsx` desenhando os campos declarados pela fonte — antes disto a tela mandava `params: {}` fixo e fonte com parâmetro era impossível de criar pela interface
- [x] T071 Edição de mensagem (FR-001/FR-003), exclusão de automação e painel de histórico de ocorrências (FR-019)
- [x] T072 Testes das onze fontes + o de FR-017 contra TODAS as fontes registradas, e o de entrega/leitura da automação ponta a ponta

**Checkpoint**: dezesseis fontes, todas criáveis pela tela e cobertas por teste.
