---
description: "Task list for 053 — Notificações por comportamento do paciente"
---

# Tasks: Notificações por comportamento do paciente

**Input**: Design documents from `/specs/053-notificacoes-comportamento/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: incluídos e **obrigatórios**. Não por preferência de estilo — a
constituição do projeto exige, para funcionalidade que afeta acesso
multi-tenant, teste de (a) imutabilidade, (b) isolamento entre tenants e (c)
autorização por papel em cada endpoint.

**Organization**: agrupadas por user story, para que cada uma seja
implementável e demonstrável sozinha.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivo diferente, sem dependência pendente)
- **[Story]**: a que user story a tarefa pertence (US1..US6)

> ⚠️ **Banco local compartilhado.** `pnpm test` e `pnpm supabase:reset` chamam
> `resetDatabase()` e apagam **tudo**. São as tarefas marcadas 🔒 — combinar
> antes e `pnpm seed:demo` depois. `npx vitest run tests/unit/<arquivo>` é
> seguro.

---

## Phase 1: Setup

- [ ] T001 Criar a cápsula `src/lib/core/signals/` com `types.ts` (família, candidato, desfecho, contexto de avaliação) e `index.ts` como barrel
- [ ] T002 [P] Criar `src/lib/core/messaging/` com `types.ts` (resultado de envio classificado, finalidade) — separada de `signals/` de propósito, ver plan.md
- [ ] T003 [P] Acrescentar o módulo `acompanhamento` em `ModuleId` e `ALL_MODULES` em `src/lib/core/entitlements/plans.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: esquema, contrato de família e a peça de envio. Nenhuma user story
começa antes disto.

**⚠️ O contrato de família nasce já com as DUAS naturezas** (celebração e
ausência). Retrofitar celebração depois obrigaria a rever cada filtro escrito
assumindo ausência — e é o tipo de retrofit que deixa um filtro para trás.

### Esquema

- [ ] T004 Escrever `supabase/migrations/0192_patient_signal_rules.sql`: tabelas `signal_rules`, `signal_occurrences`, `patient_messages` conforme `data-model.md`, com RLS por `jwt_tenant_id()`, GRANTs e índices
- [ ] T005 Na mesma migration: trigger anti-UPDATE/DELETE em `signal_occurrences` e `patient_messages` (padrão `whatsapp_delivery_events` da 0185)
- [ ] T006 Na mesma migration: `UNIQUE (rule_id, patient_id, cycle_date)` em `signal_occurrences` — é a idempotência do ciclo (FR-024), não um índice de performance
- [ ] T007 Na mesma migration: `patients.outreach_opt_in BOOLEAN NOT NULL DEFAULT FALSE` + `COMMENT` explicando por que o default é FALSE (finalidade distinta, research D5)
- [ ] T008 Na mesma migration: `tenant_clinic_profile.outreach_weekly_cap SMALLINT NOT NULL DEFAULT 2 CHECK (BETWEEN 1 AND 7)`
- [ ] T009 Na mesma migration: trigger de auditoria em `signal_rules` (INSERT/UPDATE/DELETE) via `log_audit_event` (FR-007)
- [ ] T010 🔒 Aplicar a migration localmente (`pnpm supabase:reset`), regenerar tipos (`pnpm supabase:gen-types`) e re-semear (`pnpm seed:demo`)

### Contrato de família e catálogo

- [ ] T011 Definir a interface `SignalFamily` em `src/lib/core/signals/types.ts` conforme `contracts/rule-catalog.md`, com `nature: 'celebracao' | 'ausencia'`, `paramsSchema`, `placeholders`, `defaultTemplate`, `requiresPortalActivity`, `priority`, `earliestObservable`, `evaluate`
- [ ] T012 Criar `src/lib/core/signals/catalog.ts` com o registro das famílias e os lookups por id
- [ ] T013 [P] Criar `src/lib/core/signals/forbidden-phrases.ts` com a lista de expressões acusatórias e a função de verificação, aplicável **só a famílias de ausência**
- [ ] T014 [P] Criar `src/lib/core/signals/template.ts`: valida placeholders contra os declarados pela família e renderiza `{{campo}}`
- [ ] T015 [P] Teste unitário das invariantes do catálogo em `tests/unit/signals-catalog.spec.ts` — as 7 do `contracts/rule-catalog.md`, com destaque para: `priority` única; celebração `< 10` e ausência `>= 10`; nenhuma celebração com `requiresPortalActivity`; nenhuma família de meta com placeholder numérico
- [ ] T016 [P] Teste unitário em `tests/unit/signals-forbidden-phrases.spec.ts`: cada `defaultTemplate` de ausência passa; frases acusatórias conhecidas são recusadas; templates de celebração não são submetidos à lista

### Envio a um paciente

- [ ] T017 Implementar `src/lib/core/messaging/send-to-patient.ts`: resolve contato via RPC `get_patient_for_tenant`, aplica consentimento (finalidade `outreach_opt_in` + canal `reminders_whatsapp_opt_in`), escolhe canal, despacha por `sendText`/`sendBookingEmail`, grava `patient_messages`
- [ ] T018 Resolver o canal `preferencial` em `send-to-patient.ts`: WhatsApp quando a clínica está conectada (`isWhatsAppConnected`) e o paciente aceita o canal; senão e-mail
- [ ] T019 [P] Teste unitário da precedência de consentimento em `tests/unit/outreach-consent.spec.ts`: `outreach_opt_in=FALSE` cala tudo; canal recusado cala só o WhatsApp; `reminders_opt_in` **não** participa

### Portões do ciclo

- [ ] T020 Implementar `src/lib/core/signals/gates.ts`: consentimento, contato, atividade no portal (D4), silêncio por regra, teto global — cada um devolvendo o desfecho correspondente, nunca um booleano
- [ ] T021 Implementar `src/lib/core/signals/occurrences.ts`: grava ocorrência (sempre, com desfecho) e consulta silêncio e teto sobre a própria tabela (D6, sem contador materializado)
- [ ] T022 Implementar a resolução de público em `src/lib/core/signals/audience.ts`: `todos_ativos` e `por_profissional` via `DISTINCT ON (patient_id) ... ORDER BY appointment_at DESC`, uma query por ciclo e não por paciente

**Checkpoint**: fundação pronta — as user stories podem começar.

---

## Phase 3: US1 + US2 — o primeiro disparo, sem cobrar quem sumiu (Priority: P1) 🎯 MVP

**Goal**: a clínica liga a regra de hábito, ela dispara para quem estava no
portal e não marcou, e **não** dispara para quem sumiu do portal — que recebe a
mensagem de reengajamento no lugar.

**Independent Test**: dois pacientes idênticos em ausência de marcação, um com
acesso recente ao portal e outro sem; o primeiro recebe a mensagem de hábito, o
segundo a de reengajamento.

> **Por que as duas juntas**: entregar a US1 sozinha cobra hábito de quem talvez
> o esteja cumprindo — o dano exato que a feature foi desenhada para evitar. Não
> são duas fatias, são uma.

### Famílias

- [ ] T023 [P] [US1] Implementar `src/lib/core/signals/families/ausencia/habito-sem-registro.ts`, reusando `itemStats`/`period.ts` de `src/lib/core/habits/`, com piso da janela em `patient_habit_checklists.start_date` (D10) e agregação de múltiplos itens num único candidato (FR-013)
- [ ] T024 [P] [US2] Implementar `src/lib/core/signals/families/ausencia/sem-acesso-portal.ts` sobre `patient_portal_access_log`, com elegibilidade "já entrou alguma vez"

### Ciclo

- [ ] T025 [US1] Implementar `src/lib/core/signals/evaluate-cycle.ts`: itera clínicas com o módulo ligado e regras ativas, aplica a janela horária dos lembretes, avalia por prioridade, grava ocorrência com desfecho e enfileira as `enviada`
- [ ] T026 [US1] Gate do módulo `acompanhamento` **no motor** dentro de `evaluate-cycle.ts` — não só na tela (research D12, lição da 051)
- [ ] T027 [US1] Criar `src/app/api/cron/patient-signals/route.ts` (POST, `Bearer CRON_SECRET`, `maxDuration=60`) devolvendo contadores **por desfecho**
- [ ] T028 [US1] Acrescentar o cron diário em `vercel.json` — **diário, nunca mais frequente**; frequência maior trava todos os deploys no plano Hobby
- [ ] T029 [US1] Criar `src/app/api/workers/send-patient-message/route.ts` autenticada por assinatura QStash, com revalidação na hora do envio (consentimento, status, regra ativa, módulo) — a decisão de ontem não autoriza o envio de hoje
- [ ] T030 [US1] Enfileiramento com atraso crescente por clínica em `evaluate-cycle.ts`, reusando o padrão de `enqueueWhatsAppReminder`, com degradação inline sem `QSTASH_TOKEN`

### Tela mínima e CRUD

- [ ] T031 [P] [US1] Implementar `src/lib/core/signals/rules.ts` (CRUD com validação por família)
- [ ] T032 [US1] Criar `src/app/api/notificacoes-automaticas/route.ts` (GET lista + catálogo + contagem de aceite; POST cria) conforme `contracts/api.md`
- [ ] T033 [US1] Criar `src/app/api/notificacoes-automaticas/[id]/route.ts` (PATCH; DELETE **desativa**, não apaga)
- [ ] T034 [US1] Criar a tela `src/app/(dashboard)/configuracoes/notificacoes-automaticas/page.tsx` com gate de `reminders.config` + módulo
- [ ] T035 [P] [US1] Criar `rule-list.tsx` e `rule-form.tsx` na mesma pasta
- [ ] T036 [US1] Criar `consent-banner.tsx`: diz, **antes** de a clínica ligar a primeira regra, quantos pacientes têm aceite e por que a base nasce sem ele (research D5) — sem isso a clínica liga a regra, nada sai, e conclui que está quebrado
- [ ] T037 [P] [US1] Acrescentar o card do hub em `src/app/(dashboard)/configuracoes/_cards.ts` e atualizar a contagem em `tests/integration/configuracoes-hub.spec.ts`
- [ ] T038 [P] [US1] Consentimento na ficha do paciente: exibir e alternar `outreach_opt_in` **em um clique** (FR-017a), com auditoria da alteração (FR-016)

### Testes

- [ ] T039 [P] [US1] Teste unitário do predicado de hábito em `tests/unit/signals-habito.spec.ts`: dias corridos, piso da grade, dia em curso não conta, agregação de itens
- [ ] T040 [P] [US2] Teste unitário da supressão em `tests/unit/signals-portal-gate.spec.ts`: sem acesso na janela suprime; sem acesso nenhum na história torna inelegível; acesso recente libera
- [ ] T041 [US1] Teste de integração do ciclo em `tests/integration/signals-cycle.spec.ts`: disparo, idempotência de dois ciclos no mesmo dia, ocorrência gravada em cada desfecho
- [ ] T042 [P] [US1] Teste de isolamento multi-tenant em `tests/integration/signals-tenant-isolation.spec.ts` — Princípio III
- [ ] T043 [P] [US1] Teste de RBAC das rotas novas em `tests/unit/signals-rbac.spec.ts` — Princípio V, cada papel contra cada ação
- [ ] T044 [P] [US1] Teste de imutabilidade em `tests/contract/signals-append-only.spec.ts`: UPDATE e DELETE em `signal_occurrences` e `patient_messages` falham

**Checkpoint**: MVP. A clínica liga uma regra, ela dispara para quem deve e cala para quem sumiu.

---

## Phase 4: US4 — ninguém recebe demais (Priority: P2)

**Goal**: teto de mensagens por paciente por semana, somando todas as regras.

**Independent Test**: três regras aplicáveis ao mesmo paciente com teto 1 — sai
uma, e a escolha é a mesma entre execuções.

- [ ] T045 [US4] Implementar o teto semanal em `gates.ts`, lendo `outreach_weekly_cap` do perfil da clínica
- [ ] T046 [US4] Implementar o desempate determinístico em `evaluate-cycle.ts`: prioridade da família → `created_at` da regra → id. Nunca a ordem em que o loop encontrou
- [ ] T047 [US4] Registrar a regra preterida como `adiada`, não silenciosamente descartada (FR-021)
- [ ] T048 [US4] Campo do teto na tela, em `src/app/(dashboard)/configuracoes/notificacoes-automaticas/`
- [ ] T049 [P] [US4] Teste unitário do desempate em `tests/unit/signals-tiebreak.spec.ts`: mesma entrada devolve a mesma escolha, sempre
- [ ] T050 [US4] Teste de integração do teto em `tests/integration/signals-weekly-cap.spec.ts`: teto respeitado, virada de semana libera, preteridas ficam `adiada`

**Checkpoint**: o volume está sob controle antes de o catálogo crescer.

---

## Phase 5: US5 — a clínica reconhece, não só cobra (Priority: P2)

**Goal**: as cinco famílias de celebração.

**Independent Test**: um paciente que atinge a meta recebe o reconhecimento sem
que nenhuma regra de ausência exista.

> **Vêm antes do resto das ausências** por duas razões: são as mais baratas
> (nenhum filtro se aplica a evento presente) e são o que impede a feature de ir
> a público sabendo só cobrar.

- [ ] T051 [P] [US5] `families/celebracao/meta-atingida.ts` — dispara na **virada** (a anterior não tinha alcançado), não todo dia depois
- [ ] T052 [P] [US5] `families/celebracao/sequencia-habito.ts` — reusa `currentStreak` de `habits/period.ts`
- [ ] T053 [P] [US5] `families/celebracao/aniversario.ts`
- [ ] T054 [P] [US5] `families/celebracao/aniversario-acompanhamento.ts`
- [ ] T055 [P] [US5] `families/celebracao/pos-consulta.ts`
- [ ] T056 [US5] Fazer `evaluate-cycle.ts` e `gates.ts` pularem o filtro de portal e a lista de expressões para `nature: 'celebracao'` (FR-002a)
- [ ] T057 [US5] Agrupar o catálogo por natureza na tela, com a celebração visível primeiro — se as regras de reconhecimento ficam no fim da lista, ninguém liga (SC-009)
- [ ] T058 [US5] Teste de integração da precedência em `tests/integration/signals-celebration-precedence.spec.ts`: com teto 1 e uma celebração concorrendo com duas ausências, a celebração é a que sai (FR-002b)
- [ ] T059 [P] [US5] Teste unitário das cinco famílias em `tests/unit/signals-celebracao.spec.ts`, com atenção ao disparo na virada da meta

**Checkpoint**: a feature já sabe reconhecer, não só cobrar.

---

## Phase 6: US3 — a clínica escreve com a própria voz (Priority: P2)

**Goal**: texto editável, com prévia e validação.

**Independent Test**: editar o texto de uma regra, ver a prévia preenchida e
receber a mensagem com o texto novo.

- [ ] T060 [US3] Validação de placeholder desconhecido na criação e edição, devolvendo `400 UNKNOWN_PLACEHOLDER` com o nome do campo
- [ ] T061 [US3] Validação de expressão proibida (só ausência), devolvendo `400 FORBIDDEN_PHRASE` com a frase encontrada e uma sugestão de reescrita
- [ ] T062 [US3] Criar `src/app/api/notificacoes-automaticas/previa/route.ts` com dados de exemplo **fixos e fictícios** — prévia com paciente real vazaria dado de quem só queria ver o texto
- [ ] T063 [US3] Prévia na tela, dentro de `rule-form.tsx`
- [ ] T064 [P] [US3] Teste de contrato das validações em `tests/contract/signals-template-validation.spec.ts`

---

## Phase 7: US6 — o resto do catálogo de ausência (Priority: P3)

**Goal**: as oito famílias de ausência restantes.

**Independent Test**: ligar cada regra isoladamente e verificar disparo com um
paciente construído para a condição.

- [ ] T065 [P] [US6] `families/ausencia/sem-registrar-medicao.ts`
- [ ] T066 [P] [US6] `families/ausencia/afastando-da-meta.ts` — **sem placeholder de valor** (invariante 5 do contrato)
- [ ] T067 [P] [US6] `families/ausencia/sem-retorno.ts` — exige ausência de consulta futura
- [ ] T068 [P] [US6] `families/ausencia/recordatorio-em-branco.ts`
- [ ] T069 [P] [US6] `families/ausencia/exame-nao-realizado.ts` sobre `exam_requests` × resultados em `patient_measurements`
- [ ] T070 [P] [US6] `families/ausencia/avaliacao-vencida.ts`
- [ ] T071 [P] [US6] `families/ausencia/plano-sem-revisao.ts`
- [ ] T072 [US6] Teste de integração por família em `tests/integration/signals-families.spec.ts`, uma condição construída por família
- [ ] T073 [P] [US6] Teste unitário dos predicados em `tests/unit/signals-predicados.spec.ts`

---

## Phase 8: Histórico, polish e validação

- [ ] T074 Criar `src/app/api/notificacoes-automaticas/ocorrencias/route.ts` (filtros por regra, paciente, desfecho e período; paginado)
- [ ] T075 Criar `occurrences-table.tsx` com **explicação em texto de cada desfecho** — `suprimida_sem_portal` sem explicação vira chamado de suporte; com explicação, vira entendimento de que o sistema evitou uma cobrança injusta
- [ ] T076 [P] Consulta do SC-009 (proporção de celebração no total enviado) em `src/lib/core/signals/metrics.ts`
- [ ] T077 [P] Evento estruturado por clínica no ciclo (contadores por desfecho, `tenant_id`, `trace_id`, sem PII)
- [ ] T078 [P] Aviso na tela quando a clínica não tem telefone nem e-mail publicados no perfil (FR-017b) — regra ligada sem contato de saída promete um caminho que não existe
- [ ] T079 Atualizar `CLAUDE.md` com a seção da feature: catálogo é código, as duas naturezas, a ambiguidade da ausência, o gate no motor
- [ ] T080 Rodar `pnpm typecheck` e `pnpm lint:auth` e corrigir o que aparecer
- [ ] T081 🔒 Rodar `pnpm test` e re-semear com `pnpm seed:demo`
- [ ] T082 Percorrer o `quickstart.md` de ponta a ponta, incluindo os 12 cenários da seção 6
- [ ] T083 **Ler as catorze mensagens padrão em voz alta** e perguntar, de cada uma, se você a receberia sem se incomodar. Se alguma soar como cobrança, o problema está no texto, não no motor — e nenhum teste automatizado pega isso

---

## Dependencies & Execution Order

### Fases

- **Setup (1)**: sem dependências.
- **Foundational (2)**: depende do Setup. **Bloqueia todas as user stories.**
- **US1+US2 (3)**: depende da 2. É o MVP.
- **US4 (4)**: depende da 3.
- **US5 (5)**: depende da 2 (usa o contrato de família) e da 4 (para demonstrar a precedência no teto).
- **US3 (6)**: depende da 3.
- **US6 (7)**: depende da 2. Pode correr em paralelo com a 6.
- **Polish (8)**: depende das stories desejadas.

### Dentro de cada story

Famílias → ciclo → rotas → tela. Testes de unidade em paralelo com a
implementação; testes de integração depois do ciclo.

### Paralelismo

- T002, T003 no Setup.
- T013, T014, T015, T016 na fundação (arquivos distintos).
- T023 e T024 são de stories diferentes e arquivos diferentes.
- As cinco famílias de celebração (T051–T055) e as sete de ausência (T065–T071)
  são todas independentes entre si.

---

## Implementation Strategy

### MVP (Phase 1 → 2 → 3)

Fundação mais US1+US2. Ao fim, a clínica liga uma regra de hábito, ela dispara
para quem estava no portal e não marcou, e cala para quem sumiu — que recebe
reengajamento. **Pare e valide aqui**, com um paciente de teste real, antes de
seguir.

### Incremental

1. MVP → validar → demonstrar
2. +US4 (teto) → o volume fica sob controle **antes** de o catálogo crescer
3. +US5 (celebração) → a feature deixa de saber só cobrar
4. +US3 (texto próprio)
5. +US6 (resto das ausências)

### Notas

- Tarefas 🔒 (T010, T081) resetam o banco local compartilhado.
- Commitar por grupo lógico, não por tarefa solta.
- O `vercel.json` (T028) é o único ponto onde um erro trava **todos** os deploys
  do projeto: diário, e só diário.
