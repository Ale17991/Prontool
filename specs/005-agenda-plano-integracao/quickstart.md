# Quickstart — Feature 005 (Integração agenda ↔ plano + conflito de horário)

**Branch**: `005-agenda-plano-integracao`

## Pré-requisitos

- Node 20 LTS, pnpm
- Docker Desktop em execução (Supabase local)
- Conta admin/recepcionista no tenant de dev

## Setup

```bash
git fetch origin
git checkout 005-agenda-plano-integracao

pnpm install                # nenhuma dep nova
pnpm supabase start
pnpm supabase:reset         # aplica 0055 (e todas as anteriores)
pnpm supabase:gen-types     # regenera types com appointment_completions, appointment_slot_locks, etc
```

## Validação manual — fluxo principal

1. `pnpm dev` → http://localhost:3000 → login admin.
2. Vá em `/operacao/atendimentos`. Espera-se que abra **Calendário** (US3 — default).
3. Crie um atendimento: clique no slot 14:00 de hoje. Preencha paciente, profissional Dra. Aline, procedimento, **horário início 14:00**, **horário fim 14:30** (formulário já mostra os campos novos). Salve.
4. Bloco aparece azul-claro no calendário (status `agendado`).
5. **Tente criar conflito**: clique no slot 14:15 de hoje. Mesma profissional. **Esperado**: erro 409 "Conflito com [paciente] das 14:00 às 14:30".
6. **Back-to-back**: crie atendimento das 14:30–15:00 com Dra. Aline. **Esperado**: sucesso.
7. **Outro profissional, mesmo horário**: crie atendimento das 14:00–14:30 com Dr. Bruno. **Esperado**: sucesso (conflito é por profissional).
8. **Marcar realizado**: abra o detalhe do atendimento das 14:00 da Dra. Aline. Clique em "Marcar realizado". Bloco vira azul-escuro (status `ativo`).
9. **Estorno libera o slot**: estorne o atendimento das 14:30–15:00 da Dra. Aline. Tente criar novo atendimento dela das 14:30–15:00. **Esperado**: sucesso (estornado não bloqueia).

## Validação manual — integração agenda ↔ plano

1. Abra `/operacao/pacientes/[algum-paciente]`. Vá em "Plano de Tratamento" → "+ Nova etapa".
2. Preencha procedimento, profissional, **data + horário início + horário fim**. Salve.
3. Verifique no calendário (`/operacao/atendimentos`): a etapa aparece como bloco "agendado".
4. Volte ao plano. Marque a etapa como **concluída**.
5. Volte ao calendário. O bloco mudou para "ativo" automaticamente.
6. Crie outra etapa para o mesmo paciente + procedimento. Em vez de concluir, vá em "Novo atendimento" no calendário e crie um avulso para o mesmo paciente + procedimento. **Esperado**: vínculo automático com a etapa pendente FIFO. A etapa fica concluída assim que o atendimento for marcado realizado.
7. **Cancelamento bidirecional**: crie etapa, cancele a etapa pelo plano. **Esperado**: o atendimento vinculado fica estornado.

## Validação manual — preferência de view

1. Abra `/operacao/atendimentos` em navegador privado novo. **Esperado**: Calendário (default global).
2. Clique em "Lista". Recarregue a página. **Esperado**: ainda Lista.
3. Clique em "Calendário". Recarregue. **Esperado**: ainda Calendário.

## Teste de carga (SC-008)

```bash
pnpm tsx scripts/bench-conflict.ts
```

Espera-se:

```
[bench-conflict] disparando 50 POSTs concorrentes para o mesmo slot...
[bench-conflict] resultado: 1 sucesso, 49 conflitos (HTTP 409). 0 erros inesperados.
[bench-conflict] PASS — race condition controlada.
```

## Testes automatizados

```bash
pnpm typecheck
pnpm lint:auth
pnpm test                     # vitest full suite
pnpm test:integration         # com DB local
pnpm test:contract
pnpm test:e2e -- conflict     # opcional, smoke Playwright
```

## Troubleshooting

- **`error: extension "btree_gist" does not exist`** ao aplicar 0055 → `CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;` (já está na migration; verifique se Supabase local foi atualizado).
- **Erro 409 inesperado em testes**: limpe `appointment_slot_locks` no setup (`DELETE FROM appointment_slot_locks;`) — registros stale de runs anteriores.
- **Trigger loop "stack depth limit exceeded"** → o `pg_trigger_depth()` deveria ter cortado. Investigue se algum trigger novo de `appointments_effective` cai em loop indireto.
- **Calendário não mostra etapa nova**: confirme que a etapa tem `appointment_id` setado (`SELECT appointment_id FROM treatment_plan_steps WHERE id = '...'`). Etapas legadas (NULL) não aparecem; agende-as via banner.
