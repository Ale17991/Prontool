---
description: "Task list for 051 — Lembretes de consulta por WhatsApp"
---

# Tasks: Lembretes de consulta por WhatsApp

**Input**: Design documents from `/specs/051-whatsapp-evolution/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: incluídos e **obrigatórios**. Não por preferência de estilo — a constituição do
projeto exige, para funcionalidade que afeta acesso multi-tenant, teste de (a) imutabilidade,
(b) isolamento entre tenants e (c) autorização por papel em cada endpoint.

**Organization**: agrupadas por user story, para que cada uma seja implementável e demonstrável
sozinha.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivo diferente, sem dependência pendente)
- **[Story]**: a que user story a tarefa pertence (US1..US5)

## Convenções de caminho

- **Clinni** (este worktree, `C:\clinni-wt-051`): `src/`, `tests/`, `supabase/migrations/`
- **Braço** (repo separado `Homio-CRM/clinni-whatsapp`, em
  `C:\Users\alefe\OneDrive\Documentos\GitHub\clinni-whatsapp`): prefixado com `[braço]`

> ⚠️ **Banco local compartilhado**. Verificado em 2026-07-28: `tests/helpers/setup.ts` **não**
> reseta o banco — quem chama `resetDatabase()` são os 206 arquivos de `tests/integration/` e
> `tests/contract/`, e **nenhum** de `tests/unit/`. Ou seja:
>
> - `npx vitest run tests/unit/<arquivo>.spec.ts` é **seguro**, não encosta no banco.
> - `pnpm test` (suíte inteira) e `pnpm supabase:reset` **apagam tudo** — são as tarefas
>   marcadas 🔒, que exigem combinar antes e `pnpm seed:demo` depois.

---

## Phase 1: Setup

**Purpose**: preparar o terreno; nada funcional ainda.

- [X] T001 Acrescentar `WHATSAPP_SERVICE_URL` e `WHATSAPP_SERVICE_MASTER_KEY` em `.env.example` com comentário explicando que a master key é segredo de plataforma, não credencial de tenant
- [X] T002 [P] Criar a cápsula `src/lib/core/whatsapp/` com `types.ts` (tipos de conexão, status de entrega e resultado de envio) e `index.ts` como barrel

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: endurecer o serviço de envio e criar o esquema. Nenhuma user story pode começar
antes disto.

**⚠️ CRÍTICO**: as tarefas T003–T008 são no **repo do braço** e são pré-condição de mandar
mensagem para paciente real. Sem elas, um terceiro que descubra a URL do webhook derruba o
envio da clínica.

### Endurecimento do serviço (repo separado)

- [X] T003 [P] [braço] Criar `supabase/migrations/0002_hardening.sql` habilitando RLS nas 4 tabelas (`tenants`, `instances`, `outbound_messages`, `webhook_events`) com `REVOKE ALL` de `anon` e `authenticated` — hoje `tenants.api_key` está legível por qualquer um que use a anon key
- [X] T004 [P] [braço] Acrescentar `UNIQUE (tenant_id, external_id)` em `outbound_messages` na mesma migration e fazer `supabase/functions/send-message/index.ts` responder `200` com a mensagem existente em caso de conflito, em vez de enviar de novo
- [X] T005 [braço] Autenticar `supabase/functions/status-webhook/index.ts` por token secreto no path da URL registrada na Evolution, validado com comparação em tempo constante; gerar e persistir o token em `instances.webhook_token` e passá-lo em `setWebhook` (`_shared/evolution.ts`)
- [X] T005a [braço] Capturar o **motivo** da queda de conexão em `supabase/functions/status-webhook/index.ts` — hoje `status_reason` grava só `connection.update: ${state}`; persistir o código de motivo do payload da Evolution e expô-lo em `get-instances`, para o Clinni distinguir "bloqueado" de "apenas desconectado" (FR-012a)
- [X] T006 [braço] Corrigir o lookup do ACK em `supabase/functions/status-webhook/index.ts:71`: filtrar por instância junto de `evolution_message_id` (o índice unique é `(instance_id, evolution_message_id)`; hoje o `.maybeSingle()` erra e descarta o ACK em silêncio quando há colisão de `keyId`)
- [X] T007 [braço] Criar `supabase/functions/provision-tenant/index.ts` conforme `contracts/whatsapp-service.md` §1 — autenticado por `x-master-key`, idempotente por `slug`, sem rotacionar a chave em rechamada
- [ ] T008 [braço] Aplicar a migration e deployar as funções alteradas (`send-message`, `status-webhook`, `provision-tenant`) com `--no-verify-jwt`, confirmando que `verify_jwt` continuou `false` em `supabase/config.toml`

### Esquema e cápsula (Clinni)

- [X] T009 Criar `supabase/migrations/0185_whatsapp_reminders.sql` conforme `data-model.md`: tabelas `tenant_whatsapp_config` e `whatsapp_delivery_events` (ambas com `tenant_id` + RLS + trigger de auditoria), expansão do CHECK de `status` em `appointment_reminders` com os 3 novos valores, ajuste do trigger `enforce_reminders_status_transition` para aceitá-los como destino de `queued →`, `patients.reminders_whatsapp_opt_in`, e as 3 colunas novas em `tenant_clinic_profile`
- [X] T010 🔒 Aplicar a migration local (`pnpm supabase:reset`) e regerar os tipos (`pnpm supabase:gen-types`) em `src/lib/db/generated/types.ts`
- [X] T011 [P] Portar a normalização de telefone BR para `src/lib/core/whatsapp/phone.ts` a partir de `_shared/phone.ts` do braço, preservando a regra de nunca remover o 9 de número de 13 dígitos
- [X] T012 [P] Criar teste unitário em `tests/unit/whatsapp-phone.spec.ts` cobrindo: celular 11 dígitos com DDD, fixo de 8 dígitos (não ganha o 9), celular de 8 dígitos sem o 9 (ganha), número de 13 dígitos com 9 seguido de 0-5 (não perde o 9), entrada com máscara e entrada vazia
- [X] T013 [P] Criar `src/lib/core/whatsapp/service-client.ts` — cliente HTTP do braço (provision, create/connect/delete instance, get instances, send message) com `AbortSignal.timeout`, mapeando os códigos de erro da tabela em `contracts/whatsapp-service.md` §3
- [X] T014 Criar `src/lib/core/whatsapp/config.ts` — leitura/escrita de `tenant_whatsapp_config` com `api_key_enc` cifrada via `enc_text_with_key`, seguindo o padrão de `tenant_memed_config`; a leitura usada pela UI **nunca** projeta `api_key_enc`
- [X] T015 Estender `src/lib/core/reminders/types.ts`: acrescentar `skipped_no_phone`, `skipped_no_connection` e `skipped_opt_out_channel` a `ReminderStatus` e a `TERMINAL_STATUSES`

**Checkpoint**: esquema no lugar, serviço endurecido, cápsula pronta. As user stories podem começar.

---

## Phase 3: User Story 1 — Clínica conecta o próprio número (Priority: P1) 🎯 MVP

**Goal**: a clínica vincula um número de WhatsApp sozinha e vê o estado da conexão.

**Independent Test**: conectar um número de teste, ver o painel virar "Conectado" com o número
aparecendo, desconectar e ver voltar para "Desconectado".

### Tests for User Story 1

- [X] T016 [P] [US1] Teste de contrato em `tests/contract/whatsapp-connection-rbac.spec.ts`: cada server action de conexão/desconexão testada contra cada papel — só `admin` passa; `financeiro`, `recepcionista` e `profissional_saude` recebem negação
- [X] T017 [P] [US1] Teste de isolamento em `tests/integration/whatsapp-tenant-isolation.spec.ts`: tenant A não lê, não conecta e não desconecta a instância do tenant B; a `api_key` de A nunca aparece em resposta de rota

### Implementation for User Story 1

- [ ] T018 [US1] Criar as server actions em `src/app/(dashboard)/configuracoes/whatsapp/actions.ts` (conectar, obter QR, atualizar estado, desconectar), todas sob `requireRole('admin')`, provisionando o tenant no braço na primeira conexão e gravando a `api_key` cifrada
- [ ] T019 [US1] Criar a tela `src/app/(dashboard)/configuracoes/whatsapp/page.tsx` + componente cliente de QR e estado, com os três estados visuais (desconectado / conectando / conectado com número) e polling do estado enquanto estiver conectando
- [ ] T020 [P] [US1] Acrescentar a entrada "WhatsApp" no hub de configurações em `src/app/(dashboard)/configuracoes/page.tsx`
- [ ] T020a [US1] Exibir aviso em destaque na tela de conexão quando o motivo da queda indicar **bloqueio** do número pelo WhatsApp, sem desligar o canal automaticamente (FR-012a) — depende de T005a
- [ ] T021 [US1] Registrar auditoria (`log_audit_event`) na conexão e na desconexão, conforme Princípio II

**Checkpoint**: a clínica conecta o número sozinha. Nada é enviado ainda.

---

## Phase 4: User Story 2 — Paciente recebe o lembrete no WhatsApp (Priority: P1)

**Goal**: o lembrete de consulta chega no WhatsApp do paciente, sem duplicar e sem rajada.

**Independent Test**: marcar consulta dentro da antecedência, disparar o ciclo por `curl` e
confirmar a chegada no celular; rodar o ciclo de novo e confirmar que **não** chega segunda vez.

### Tests for User Story 2

- [ ] T022 [P] [US2] Teste de idempotência em `tests/integration/whatsapp-reminder-idempotency.spec.ts`: dois ciclos consecutivos sobre o mesmo agendamento/offset/canal geram um único envio (SC-003)
- [ ] T023 [P] [US2] Teste de imutabilidade em `tests/contract/reminder-append-only.spec.ts`: um lembrete em estado terminal recusa `UPDATE` de status, e os 3 status novos são aceitos como destino de `queued →`
- [ ] T024 [P] [US2] Teste unitário em `tests/unit/render-whatsapp.spec.ts`: os 5 placeholders são substituídos, a saída não contém tag HTML, o texto traz a orientação de cancelamento, avisa que respostas não são lidas, e cai corretamente nos 3 níveis de fallback de contato (link público → telefone → orientação genérica)

### Implementation for User Story 2

- [ ] T025 [P] [US2] Criar `src/lib/core/reminders/render-whatsapp.ts` — template texto puro com os mesmos placeholders do e-mail (`paciente`, `medico`, `procedimento`, `horario`, `clinica`), respeitando `reminder_template_whatsapp` quando preenchido, avisando em tom de parceria que respostas não são lidas e oferecendo o contato pela hierarquia de fallback de 3 níveis já usada em `render-email.ts` (FR-007a)
- [ ] T026 [US2] Parametrizar `src/lib/core/reminders/select-due.ts` por canal: substituir o `.eq('channel','email')` fixo da linha 88, passar a selecionar `phone_enc` junto de `email_enc`, e expor "tem telefone?" sem trazer o claro para o buffer de seleção
- [ ] T027 [US2] Criar `src/lib/core/reminders/send-one-whatsapp.ts` — revalidação JIT (opt-in, médico ativo, telefone presente), decrypt via `get_patient_for_tenant`, normalização do telefone, chamada ao braço com `externalId` = id do lembrete, e finalização do status
- [ ] T028 [US2] Refatorar `src/lib/core/reminders/send-one.ts` para despachar por canal em vez de gravar `channel:'email'` fixo na linha 67, preservando o comportamento atual do e-mail sem alteração observável
- [ ] T029 [US2] Criar o worker `src/app/api/workers/send-whatsapp-reminder/route.ts` — executa um envio individual, autenticado por assinatura QStash no padrão de `/api/workers/process-ghl-event`
- [ ] T030 [US2] Estender `src/lib/core/reminders/process-batch.ts`: iterar os canais habilitados do tenant, verificar a conexão **antes** do lote e registrar uma única ocorrência `skipped_no_connection` quando ausente (FR-012), e enfileirar cada envio de WhatsApp no QStash com `delay = índice × 4s` em vez do `Promise.allSettled` em rajada da linha 164
- [ ] T031 [US2] Implementar o fallback de execução inline (lote reduzido, espaçamento menor) para quando `isQstashConfigured()` for falso, para o fluxo continuar testável em dev
- [ ] T031a [US2] Habilitar o **reenvio manual** de um lembrete no canal WhatsApp, reusando o caminho `is_manual = TRUE` já existente para e-mail (FR-027) — inclui o botão na tela de histórico de lembretes e a garantia de que o reenvio não é bloqueado pela regra de idempotência
- [ ] T032 [P] [US2] Teste de integração em `tests/integration/whatsapp-batch-guards.spec.ts`: número desconectado gera **uma** ocorrência agregada e não uma falha por paciente; paciente sem telefone vira `skipped_no_phone`; agendamento estornado não gera envio

**Checkpoint**: o lembrete chega no WhatsApp. US1 + US2 = produto utilizável.

---

## Phase 5: User Story 3 — Clínica escolhe o canal (Priority: P2)

**Goal**: e-mail, WhatsApp ou ambos, com fallback quando o paciente não tem telefone.

**Independent Test**: alternar os três modos e confirmar, para o mesmo agendamento, por quais
canais a mensagem sai.

### Tests for User Story 3

- [ ] T033 [P] [US3] Teste de integração em `tests/integration/reminder-channels.spec.ts`: modo "somente WhatsApp" não manda e-mail; modo "ambos" gera dois registros independentes para o mesmo agendamento/offset; modo "WhatsApp com fallback" manda e-mail quando falta telefone

### Implementation for User Story 3

- [ ] T034 [US3] Estender `src/lib/core/reminders/config.ts` — ler e gravar `reminder_channels`, `reminder_whatsapp_fallback_email` e `reminder_template_whatsapp`, com validação Zod (array não-vazio, subconjunto de `email`/`whatsapp`)
- [ ] T035 [US3] Acrescentar a escolha de canal e o editor do template de WhatsApp em `src/app/(dashboard)/configuracoes/lembretes/config-form.tsx`
- [ ] T036 [US3] Impedir a ativação do canal WhatsApp sem número conectado (FR-005), com mensagem que diga o que falta e link para a tela de conexão
- [ ] T037 [US3] Implementar o fallback para e-mail em `process-batch.ts` quando o canal é WhatsApp, o paciente não tem telefone e `reminder_whatsapp_fallback_email` está ligado

**Checkpoint**: a clínica controla por onde o lembrete sai.

---

## Phase 6: User Story 4 — Entrega e leitura no histórico (Priority: P3)

**Goal**: a clínica vê "enviada → entregue → lida" e o motivo compreensível quando falha.

**Independent Test**: enviar para um número de teste, abrir a mensagem no celular e ver o
histórico progredir.

### Tests for User Story 4

- [ ] T038 [P] [US4] Teste de contrato em `tests/contract/whatsapp-status-callback.spec.ts`: sem Bearer → `401` e nada gravado; Bearer errado → `401`; `externalId` desconhecido → `200` sem efeito; `tenant_id` derivado do lembrete e não do corpo
- [ ] T039 [P] [US4] Teste unitário em `tests/unit/delivery-precedence.spec.ts`: um `delivered` que chega depois de um `read` fica registrado mas não rebaixa o status exibido (FR-019)

### Implementation for User Story 4

- [ ] T040 [US4] Criar `src/lib/core/whatsapp/delivery.ts` — gravação de `whatsapp_delivery_events` e resolução do status corrente por precedência de rank (`sent=1 < delivered=2 < read=3 < error=9`)
- [ ] T041 [US4] Criar a rota `src/app/api/webhooks/whatsapp-status/route.ts` conforme `contracts/status-callback.md`, com validação de Bearer por `timingSafeEqual` e descarte do telefone recebido no payload (nunca persistido nem logado)
- [ ] T042 [US4] Acrescentar a coluna de status de entrega em `src/app/(dashboard)/configuracoes/lembretes/history-table.tsx`, lendo pela precedência de rank
- [ ] T043 [P] [US4] Mapear os motivos de falha para linguagem de recepção (FR-021) — sem código de erro nem jargão técnico na tela

**Checkpoint**: a clínica confia no canal porque enxerga o que aconteceu.

---

## Phase 7: User Story 5 — Recusa por canal (Priority: P3)

**Goal**: o paciente recusa WhatsApp sem perder o e-mail.

**Independent Test**: marcar a recusa de WhatsApp num paciente, rodar o ciclo em modo "ambos" e
confirmar que só o e-mail saiu.

### Tests for User Story 5

- [ ] T044 [P] [US5] Teste de integração em `tests/integration/reminder-optout-per-channel.spec.ts`: recusa de WhatsApp bloqueia só o WhatsApp; recusa mestra (`reminders_opt_in = FALSE`) bloqueia todos os canais

### Implementation for User Story 5

- [ ] T045 [US5] Estender `src/lib/core/reminders/opt-in.ts` com leitura e escrita de `reminders_whatsapp_opt_in`, mantendo `reminders_opt_in` como mestre
- [ ] T046 [US5] Acrescentar o controle de recusa por canal no cadastro do paciente em `src/app/(dashboard)/operacao/pacientes/[id]/_components/cadastro-tab.tsx`
- [ ] T047 [US5] Aplicar a recusa na revalidação JIT de `send-one-whatsapp.ts`, finalizando como `skipped_opt_out_channel`

**Checkpoint**: todas as user stories funcionam de forma independente.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T048 [P] Acrescentar a seção da feature 051 no `CLAUDE.md` (padrão das features anteriores): por que WhatsApp não está no registry de adapters, por que a entrega vai em tabela separada, e o risco de bloqueio aceito
- [ ] T049 [P] Documentar no `HANDOFF.md` do braço as mudanças de contrato (token do webhook, `provision-tenant`, idempotência por `external_id`)
- [ ] T050 Rodar `pnpm typecheck` e `pnpm lint:auth` e corrigir o que aparecer
- [ ] T051 🔒 Rodar `pnpm test` e re-semear com `pnpm seed:demo`
- [ ] T052 Percorrer o `quickstart.md` de ponta a ponta com um número real, incluindo os 5 cenários da tabela da seção 7
- [ ] T053 Confirmar que o SC-004 (≥ 70% dos lembretes entregues lidos em 24h) é apurável com os dados de `whatsapp_delivery_events` — a consulta que apura isso deve existir antes de a feature ser considerada validada

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Fase 1)**: sem dependência
- **Foundational (Fase 2)**: depende da Fase 1 — **bloqueia todas as user stories**
  - T003–T008 (braço) e T009–T015 (Clinni) podem correr em paralelo entre si
  - T010 depende de T009; T014 depende de T010
- **US1 (Fase 3)**: depende da Fase 2 completa
- **US2 (Fase 4)**: depende da Fase 2 **e** de US1 — sem número conectado não há o que enviar
- **US3 (Fase 5)**: depende de US2
- **US4 (Fase 6)**: depende de US2 (precisa de mensagem enviada para ter o que confirmar) e de T005 no braço
- **US5 (Fase 7)**: depende de US2
- **Polish (Fase 8)**: depois das stories desejadas

### Nota sobre independência

US2 depender de US1 é uma dependência real, não um defeito de recorte: o valor da US1 é
justamente ser a pré-condição física do canal. US3, US4 e US5 são independentes entre si e
podem ser feitas em qualquer ordem depois da US2.

### Parallel Opportunities

- Fase 2: T003, T004 e T007 no braço em paralelo com T011, T012 e T013 no Clinni
- Fase 3: T016 e T017 juntos; T020 em paralelo com T018/T019
- Fase 4: T022, T023, T024 e T025 juntos antes da implementação
- Fase 8: T048 e T049 em paralelo

---

## Parallel Example: Fase 2

```bash
# Braço e Clinni não compartilham arquivo — correm juntos:
Task: "[braço] RLS nas 4 tabelas em supabase/migrations/0002_hardening.sql"
Task: "[braço] provision-tenant em supabase/functions/provision-tenant/index.ts"
Task: "Portar normalização de telefone em src/lib/core/whatsapp/phone.ts"
Task: "Cliente HTTP do braço em src/lib/core/whatsapp/service-client.ts"
```

---

## Implementation Strategy

### MVP (US1 + US2)

1. Fase 1 → Fase 2 (com o braço endurecido — inegociável)
2. Fase 3: a clínica conecta o número
3. Fase 4: o lembrete chega no WhatsApp
4. **PARAR e VALIDAR** com um número real antes de qualquer coisa
5. Deploy

O MVP aqui é **duas** stories, não uma. US1 sozinha não entrega valor ao paciente — entrega uma
tela que conecta um número que não manda nada.

### Entrega incremental

1. MVP (US1 + US2) → demo → deploy
2. US3 (escolha de canal) → demo
3. US4 (entrega/leitura) e US5 (recusa por canal) em qualquer ordem

---

## Notes

- Toda migration em produção é aplicada pela integração GitHub da Supabase no push para
  `master` — **nunca** aplicar à mão também.
- Tarefas 🔒 (T010, T051) resetam o banco local compartilhado. Combinar antes; `pnpm seed:demo`
  depois.
- Commit por tarefa ou grupo lógico; parar em qualquer checkpoint para validar.
