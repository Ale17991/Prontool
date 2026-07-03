# Phase 0 — Research: Integração agenda ↔ plano + conflito de horário

**Feature**: 005-agenda-plano-integracao
**Date**: 2026-04-28

Decisões técnicas que sustentam o plano. Itens marcados como "user input" foram fechados pelo usuário ao invocar `/speckit.plan`.

---

## R-001: Tabela auxiliar `appointment_slot_locks` em vez de EXCLUDE direto em `appointments`

**Decisão**: Criar `appointment_slot_locks(tenant_id, doctor_id, appointment_id, slot_range)` com EXCLUDE constraint. Trigger AFTER INSERT em `appointments` insere o lock; trigger AFTER INSERT em `appointment_reversals` deleta o lock.

**Rationale**:

- EXCLUDE constraint do Postgres aceita cláusula WHERE apenas com expressões sobre as próprias colunas da linha — **não permite subquery**. Para que estornados liberem o slot ("`appointments com status estornado` NÃO contam", FR-010), precisamos remover a entrada do índice.
- Não podemos fazer UPDATE em `appointments` (Princípio I — imutabilidade).
- Slot lock é **dado derivado** — análogo a um índice de banco materializado. DELETE nele é manutenção de cache, não destruição de evidência. A trilha financeira (`appointments`, `appointment_reversals`) permanece intacta e auditável.
- A EXCLUDE constraint na tabela auxiliar continua sendo o veto autoritativo: race-safe nativamente, sem precisar de advisory lock ou serializable isolation.

**Alternativas consideradas**:

- **Trigger BEFORE INSERT em `appointments` com `SELECT ... LIMIT 1`** — não é race-safe sem advisory lock manual; complexo e frágil.
- **Coluna `is_reversed BOOLEAN` em `appointments`, mantida por trigger; EXCLUDE com `WHERE NOT is_reversed`** — viola Princípio I (UPDATE em registro financeiro).
- **EXCLUDE direto com WHERE estática (`tenant_id IS NOT NULL`) + cleanup de reversed por job** — janela de inconsistência inaceitável; pode bloquear rebooking até o job rodar.

---

## R-002: Extensão `btree_gist` necessária

**Decisão (user input)**: Habilitar `btree_gist` no schema `extensions` na migration 0055.

**Rationale**: EXCLUDE multi-coluna `(tenant_id WITH =, doctor_id WITH =, slot_range WITH &&)` exige operador `=` indexável em GIST. UUIDs nativamente só têm `=` em B-tree. `btree_gist` adiciona suporte a `=` em GIST, viabilizando o índice composto. Já é extensão padrão e disponível no Supabase.

**Alternativas consideradas**:

- **Hashing `tenant_id||doctor_id` em uma coluna `lock_key` text** — feio, perde cardinalidade do índice, complica WHERE em queries de leitura.

---

## R-003: `tstzrange` semi-aberto `[start, end)`

**Decisão**: Sempre usar `tstzrange(appointment_at, appointment_at + duration_minutes * interval '1 minute', '[)')`.

**Rationale**: FR-014 exige back-to-back permitido. O literal de bounds `'[)'` (inclusivo no início, exclusivo no fim) garante: 14:00–14:30 e 14:30–15:00 não conflitam pela definição de `&&` em ranges. Comportamento padrão do Postgres alinha com o requisito.

**Alternativas consideradas**:

- **Bounds `'()' ` (exclusivo dos dois lados)** — agendamento de 1 minuto vira range vazio; perde cobertura.
- **Bounds `'[]'`** — back-to-back conflita; quebra FR-014.

---

## R-004: Recursão de triggers step↔appointment

**Decisão**: Cada trigger de sincronização (`step_status_sync_to_appointment`, `appointment_completion_sync_to_step`, `appointment_reversal_sync_to_step`) checa `pg_trigger_depth() = 1` no início. Se profundidade > 1, retorna sem fazer nada — o ciclo terminou.

**Rationale**:

- Sem essa guarda: marcar etapa como concluída → trigger A insere em completions → trigger B atualiza step.status='concluido' → trigger A re-fire (porque é UPDATE em step) → tentaria inserir nova completion → falha por UNIQUE → transação aborta.
- `pg_trigger_depth()` é função built-in que retorna o nível de aninhamento; 1 = trigger top-level disparado por SQL do usuário.

**Alternativas consideradas**:

- **Session variable `app.skip_sync` setada antes do INSERT/UPDATE controlado** — funcional, mas espalha estado por chamadas application-side; mais frágil que checar profundidade no próprio trigger.

---

## R-005: Atomicidade de "criar etapa + criar atendimento"

**Decisão**: Função plpgsql `create_step_with_appointment(p_tenant_id, p_patient_id, ...) RETURNS step_id`. Internamente:

1. INSERT em `appointments` (dispara trigger de slot_lock — pode falhar com 409 se conflitar).
2. INSERT em `treatment_plan_steps` com `appointment_id = appointment.id`.
3. RETURN o id da etapa.

Tudo em uma transação implícita da função. Se qualquer INSERT falhar, ROLLBACK automático.

**Rationale**:

- Garante que nunca existe etapa sem atendimento ou atendimento órfão criado pelo fluxo de etapa.
- A função é chamada via RPC do Supabase pelo handler `POST /api/pacientes/[id]/etapas`. RPC já está disponível no padrão do projeto.

**Alternativas consideradas**:

- **Two-phase no application code (insert appointment, then step)** — janela de inconsistência se o segundo falha.
- **Trigger que cria a etapa após o appointment** — direção errada; etapa só se cria se o caller é o fluxo de plano de tratamento.

---

## R-006: Auto-link FIFO em `create_manual`

**Decisão**: Após o INSERT bem-sucedido do appointment via `createAppointmentManually`, a função procura:

```sql
SELECT id FROM treatment_plan_steps
WHERE tenant_id = $1 AND patient_id = $2 AND procedure_id = $3
  AND status = 'pendente' AND appointment_id IS NULL
ORDER BY created_at ASC
LIMIT 1
```

Se encontrar, atualiza `appointment_id` na etapa.

O column-guard de `treatment_plan_steps` precisa relaxar para permitir UPDATE em `appointment_id` quando `OLD.appointment_id IS NULL` (one-shot link — uma vez setado, vira imutável).

**Rationale**:

- FIFO por `created_at` — primeira etapa pendente do mesmo procedimento é a candidata natural.
- "One-shot" preserva imutabilidade em casos normais; só permite o link inicial.

**Alternativas consideradas**:

- **Match também por `scheduled_date`** — falha quando o usuário cria atendimento com horário diferente do planejado; rigidez não exigida pela spec.
- **Não fazer auto-link, exigir click "Vincular a etapa"** — mais cliques; usuário pediu auto.

---

## R-007: Endpoint `/api/atendimentos/check-conflict`

**Decisão**: GET `?doctor_id=&start=&end=&exclude_id=`. Retorna 200 com `{conflict: false}` ou `{conflict: true, with: {appointment_id, patient_name, start, end, procedure_label}}`. Sem efeitos colaterais.

**Rationale**:

- Frontend chama na blur de horário ou doctor para feedback imediato (FR-013).
- Reusa o GIST index criado pela EXCLUDE constraint indireta no slot_locks → query é O(log N).
- Não substitui a validação do banco — é apenas UX.

**Alternativas consideradas**:

- **WebSocket/SSE para atualização em tempo real** — overkill para essa frequência de uso.
- **Cliente faz a query direto via Supabase** — duplica lógica de overlap; melhor centralizar na rota.

---

## R-008: Cookie de preferência de view

**Decisão**: Cookie `prontool_atendimentos_view` (httpOnly: false, sameSite: lax, max-age: 1 ano). Server lê via `cookies()` em `next/headers`. Client escreve via `document.cookie` ao alternar.

**Rationale**:

- SSR-friendly: server decide a view default sem flicker.
- Cookie por dispositivo (browser) — alinha com Assumption "preferência por dispositivo".
- `httpOnly: false` permite client escrever; sem dado sensível.

**Alternativas consideradas**:

- **Apenas localStorage** — flicker no SSR (server renderiza Lista, client troca para Calendário).
- **Coluna `users.preferences` no banco** — sincroniza entre dispositivos (não é o requisito); mais complexo.

---

## R-009: Conflito visual no calendário

**Decisão**: Em `src/lib/utils/calendar.ts`, helper `detectVisualConflicts(blocks)` — para cada par (a, b) com `a.doctorId === b.doctorId` e `range(a) overlaps range(b)`, marca `a.conflict = true` e `b.conflict = true`. `<CalendarBlock>` aplica `ring-2 ring-rose-500` quando flag.

**Rationale**:

- Defesa em profundidade (US4): se dados legados ou inserção forçada criar conflito, o usuário enxerga.
- Custo computacional O(n²) por dia, mas n ≤ 20 na prática.

**Alternativas consideradas**:

- **Query de conflitos no banco a cada render** — round-trip extra desnecessário; o cálculo client-side é trivial sobre os dados já carregados.

---

## R-010: Backfill de etapas legadas

**Decisão**: **Sem backfill**. Etapas pré-feature continuam com `appointment_id IS NULL` e `start_at`/`end_at` nulos. UI mostra banner "Sem horário definido — agende para aparecer no calendário". Botão "Agendar agora" abre formulário que faz UPDATE no `appointment_id` (criando o appointment associado naquele momento) — protegido pelo column-guard relaxado (`OLD.appointment_id IS NULL`).

**Rationale**:

- Backfill destrutivo viola intenção do registro original (não tinha horário, atribuir um seria inventar dado).
- Caminho limpo de migração: usuário decide quando agendar cada etapa antiga.

**Alternativas consideradas**:

- **Backfill com horário 09:00 + duração 30** — falsifica histórico.
- **Migrar todas para 'cancelado'** — perde etapas válidas que ainda farão sentido agendar.

---

## Resumo das deps adicionadas

- **`btree_gist`** extensão Postgres (zero deps no app side).
- **Nenhuma dep npm nova.**

## Open questions remanescentes

Nenhuma. Os 3 itens de risco arquitetural da spec foram fechados pelo user input no `/speckit.plan`.
