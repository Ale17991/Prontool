# Phase 0 — Research & Decisions

**Status**: completo. Sem `[NEEDS CLARIFICATION]` herdadas do `/speckit-specify`. Este documento congela as decisões de design e suas alternativas avaliadas.

---

## Decisão 1 — Geração de notificações: lazy vs cron

**Decisão**: **lazy on-demand** via RPC `SECURITY DEFINER` `generate_user_notifications(p_tenant_id, p_user_id)` invocada em pontos-chave:

- ao carregar `/operacao/notificacoes` (rota SSR);
- ao chamar `GET /api/notificacoes/unread-count` (poll do sininho na topbar — pode ser feito uma vez por carregamento do dashboard ou em intervalos de 60 s).

**Rationale**:

- Stack atual NÃO tem cron rodando (Vercel free não tem `pg_cron`; usar Vercel Cron Job adicional é overhead). A solução lazy entrega o mesmo valor sem nova infra.
- Idempotência garantida via UNIQUE natural key na tabela `notifications` (`tenant_id + user_id + type + reference_key`). `INSERT ... ON CONFLICT DO NOTHING` cobre re-execuções no mesmo dia/mês.
- Custo de geração é baixo (< 1 s para tenant médio); aceitável como overhead da primeira leitura do dia.

**Alternativas consideradas**:

- _pg_cron diário às 6h_: rejeitada — exige extensão pg_cron que nem todo deploy Supabase tem; e adia inicialização (usuário entra na app antes das 6h não vê).
- _Vercel Cron + endpoint protegido_: rejeitada — overhead operacional para uma feature de UI; lazy é suficiente.
- _Insert direto via triggers em appointments/tasks_: rejeitada — não cobre `aniversarios_mes` (que é agregação) e exige trigger em N tabelas, multiplicando lugares de falha. Lazy + RPC central é mais simples.

**Mitigação de race**: dois requests simultâneos do mesmo usuário invocam a RPC em paralelo. UNIQUE INDEX + `ON CONFLICT DO NOTHING` garante zero duplicatas mesmo nesse caso. RPC retorna `{inserted: N}` sem erros mesmo em conflito.

---

## Decisão 2 — Chave natural de idempotência das notificações

**Decisão**: UNIQUE INDEX parcial `notifications_dedup_idx ON (tenant_id, user_id, type, reference_key) WHERE deleted=false` onde `reference_key` é texto derivado pelo tipo:

| `type`             | `reference_id` (UUID) | `reference_key` (TEXT)                         | Semântica de unicidade                                           |
| ------------------ | --------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| `atendimento`      | `appointment_id`      | `appointment_id::text`                         | uma notificação por (usuário, atendimento)                       |
| `tarefa`           | `task_id`             | `task_id::text \|\| ':' \|\| due_date::text`   | uma por (usuário, tarefa, data limite) — se data muda, gera nova |
| `tarefa_atrasada`  | `task_id`             | `task_id::text`                                | uma por (usuário, tarefa) — não regenera enquanto atrasada       |
| `aniversarios_mes` | NULL                  | `to_char(now() at time zone 'utc', 'YYYY-MM')` | uma por (usuário, mês)                                           |

**Rationale**: `reference_key` é text porque alguns tipos não têm UUID (mês), e outros precisam de composto (tarefa + data). Manter `reference_id UUID NULL` como FK conceitual (sem REFERENCES — para evitar quebrar quando tarefa é soft-deleted) e `reference_key` derivado.

**Alternativas consideradas**:

- _Apenas `reference_id UUID`_: rejeitada — `aniversarios_mes` ficaria sem chave; alternativa de usar UUID determinístico por mês é frágil.
- _UNIQUE em (user_id, type) sem reference_: rejeitada — só permitiria 1 atendimento e 1 tarefa por usuário (errado).

---

## Decisão 3 — Destinatário das notificações de atendimento

**Decisão**: notificação `type='atendimento'` é gerada para:

- o **usuário vinculado ao profissional** do atendimento (via `doctors.user_id` quando preenchido);
- **+ TODOS os admins** ativos do tenant.

Recepcionistas/financeiro NÃO recebem notificações de atendimento (poderiam ser muitas por dia, ruído). Se a clínica preferir, configuração futura cobre.

**Rationale**: o destinatário natural é quem vai atender ou supervisionar. Admin recebe por papel de governança/visibilidade. RPC tem lógica explícita:

```sql
-- generate_user_notifications(p_tenant_id, p_user_id):
--   se p_user_id é admin: gera para TODOS os atendimentos do dia
--   se p_user_id está vinculado a um doctor: gera apenas para atendimentos desse doctor
--   senão: nenhuma notificação de atendimento
```

**Alternativas consideradas**:

- _Todos os usuários do tenant_: rejeitada — gera ruído para recepção/financeiro.
- _Apenas o profissional_: rejeitada — admin perde visibilidade do dia.

---

## Decisão 4 — Vínculo `doctors.user_id` — schema e unicidade

**Decisão**: coluna nova `doctors.user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL` + UNIQUE parcial `doctors_user_id_unique ON (tenant_id, user_id) WHERE user_id IS NOT NULL`.

**Rationale**:

- `NULL` permite a maioria dos doctors existentes continuarem sem login (profissional terceirizado).
- `ON DELETE SET NULL` evita órfãos quando usuário é deletado (raro; user_tenants soft-delete primeiro).
- UNIQUE parcial `(tenant_id, user_id) WHERE user_id IS NOT NULL` bloqueia: (a) dois doctors com mesmo user no mesmo tenant; (b) permite múltiplos doctors com `user_id IS NULL` (caso comum).
- Cross-tenant: como `user_id` é PK em `auth.users`, naturalmente seria único globalmente — mas tornar UNIQUE GLOBAL bloquearia um usuário pertencer a múltiplos tenants (caso multi-tenant válido). UNIQUE por tenant é o correto.

**Alternativas consideradas**:

- _Tabela ponte `user_doctor_links`_: rejeitada — over-engineering; 1:1 com colunas já cobre.
- _UNIQUE global em user_id_: rejeitada — quebra suporte multi-tenant existente.

---

## Decisão 5 — Append-only para `tasks`: nível de imutabilidade

**Decisão**: trigger `enforce_tasks_mutation` permite mutação de `status`, `completed_at`, `completed_by`, `notes`, `priority`, `deleted_at`, `deleted_by`. Imutáveis: `id`, `tenant_id`, `title`, `due_date`, `created_at`, `assigned_to`, `assigned_by`, `created_by`.

**Rationale**:

- Reabertura de tarefa concluída deve atualizar status → permitido.
- Repriorização durante a vida da tarefa é UX comum → `priority` mutável.
- Notas podem ser editadas durante execução → `notes` mutável (campo opcional similar ao de `expense.deleted_at`).
- Título, data limite, responsável são contrato — alterações geram nova tarefa (UX: "criar tarefa nova com correção"). Imutabilidade preserva audit history.

**Alternativas consideradas**:

- _Permitir editar `title`/`due_date` com audit_: rejeitada — pequeno ganho UX, custo de inconsistência em audit/relatórios.
- _Tudo mutável_: rejeitada — viola padrão append-only do projeto.

---

## Decisão 6 — RBAC granular para `tasks`

**Decisão**: adicionar actions `task.read` e `task.write` no MATRIX em `src/lib/auth/rbac.ts`. Atribuídas a `admin`, `financeiro`, `recepcionista`, `profissional_saude` (todos podem ler/escrever — mas RLS + service layer filtram).

Lógica de filtragem fica no service layer + RLS:

- **Leitura**: admin lê tudo do tenant; demais leem só onde `assigned_to = auth.uid()`. RLS aplica.
- **Escrita (POST)**: admin pode criar para qualquer `assigned_to`; demais **forçados** a `assigned_to = session.userId` no service.
- **Escrita (PATCH)**: admin pode alterar qualquer; demais só se `assigned_to = session.userId`. RLS bloqueia.
- **Soft-delete**: admin only.

**Rationale**: action única `task.write` cobre o gesto "pode usar a feature de tarefas para escrever". A regra de "para quem" é dado/RLS, não permissão estática. Mais simples que separar `task.write.self` vs `task.write.any`.

**Alternativas consideradas**:

- _Actions separadas `task.write.self` / `task.write.any`_: rejeitada — granularidade desnecessária; lógica fica clara no service layer.

---

## Decisão 7 — Audit de notificações

**Decisão**: notificações **não** são auditadas (criação ou mudança de `is_read`). Audit_log permanece focado em fatos financeiros + segurança.

**Rationale**:

- Volume alto (dezenas por usuário/dia × N usuários × N dias) — auditoria seria ruidosa.
- Valor probatório baixo: notificações são UX, não fato de negócio.
- Estado de leitura é trivialmente reconstruível se necessário (timestamps `read_at` na própria tabela).
- Constitution II é sobre "alteração em tabela de PREÇO, procedimento, convênio ou regra de cobrança" — notificações ficam fora desse escopo.

**Alternativas consideradas**:

- _Audit completo_: rejeitada por volume + custo de armazenamento + ruído na busca.
- _Audit só de geração_: rejeitada — overhead sem ganho operacional.

---

## Decisão 8 — Decifração de `birth_date` para aniversariantes

**Decisão**: a RPC `generate_user_notifications` decifra `birth_date_enc` apenas para extrair mês/dia, usando `PATIENT_DATA_ENCRYPTION_KEY` (mesma chave já em uso) via `pgp_sym_decrypt`. O ano de nascimento NÃO sai da RPC — só lista nome + dia do mês.

```sql
-- Pseudo-SQL dentro da RPC:
WITH birthdays AS (
  SELECT
    p.id,
    pgp_sym_decrypt(p.full_name_enc, k.key)   AS full_name,
    extract(day FROM (pgp_sym_decrypt(p.birth_date_enc, k.key))::date)::int AS dia
  FROM patients p
  CROSS JOIN (SELECT current_setting('app.encryption_key') AS key) k
  WHERE p.tenant_id = p_tenant_id
    AND p.birth_date_enc IS NOT NULL
    AND p.deleted_at IS NULL
    AND extract(month FROM (pgp_sym_decrypt(p.birth_date_enc, k.key))::date)
        = extract(month FROM CURRENT_DATE)
)
INSERT INTO notifications (...)
SELECT ... FROM birthdays;
```

A chave entra na RPC via `SET LOCAL app.encryption_key = '<key>'` no caller (mesmo padrão de `decrypt_patient_names_for_ids`).

**Rationale**: reusa infraestrutura existente. Body da notificação tem apenas mês + dia + nome — sem expor ano.

**Alternativas consideradas**:

- _Adicionar coluna `birth_month` / `birth_day` em claro_: rejeitada — mês é tecnicamente PII em conjunto com nome (mesmo sem ano); manter cifrado e decifrar só na RPC é mais conservador.
- _Materialized view de aniversariantes_: rejeitada — over-engineering; pacientes ≤ 5000 cabe num scan por mês.

---

## Decisão 9 — Senha do cadastro manual: validação

**Decisão**: validação mínima Zod `z.string().min(8).max(72)` (limite Supabase). Sem regras de complexidade (maiúscula + número + símbolo) no MVP.

**Rationale**:

- Senha é tipicamente temporária e trocada pelo usuário no primeiro acesso (UX recomenda; sistema NÃO força).
- Regras de complexidade adicionam fricção e há evidência que reduzem segurança real (usuários escolhem padrões previsíveis para satisfazer regras).
- Limite 72 = bcrypt boundary do Supabase.

**Alternativas consideradas**:

- _Regras de complexidade (mín 1 maiúscula, 1 número, 1 símbolo)_: rejeitada por fricção sem ganho material; pode ser adicionada depois se compliance exigir.
- _Geração automática + email com senha temp_: rejeitada — a UX deste fluxo é "admin define no momento, sem email". Fluxo de email já existe via convite.

---

## Decisão 10 — Sidebar: renomeação "Alertas" → "Notificações"

**Decisão**: item "Alertas" na seção "Operação" da sidebar vira "Notificações" apontando para `/operacao/notificacoes`. A rota antiga `/operacao/alertas` permanece (página intacta) acessível via:

- link "Alertas do sistema" dentro da página `/operacao/notificacoes` (sub-item visual);
- item "Pendências" (`/operacao/dlq`) já existe na sidebar como `AlertTriangle`.

Não introduzimos sub-menu colapsável na sidebar — manter sidebar plana.

**Rationale**:

- Renomeação preserva discoverability sem quebrar bookmarks (rota /operacao/alertas mantida).
- Sub-menu colapsável adicionaria complexidade visual sem ganho proporcional.

**Alternativas consideradas**:

- _Sub-menu colapsável "Notificações > Diário | Sistema"_: rejeitada — quebra padrão da sidebar atual.
- _Apagar `/operacao/alertas`_: rejeitada — quebra usuários existentes.

---

## Decisão 11 — Migration numbering & rollback

**Decisão**: `0078_tasks_notifications_user_link.sql`. Próximo número após `0077_appointment_procedures_notes.sql` (última migration merged). Adições não destrutivas:

- `CREATE TABLE tasks`, `CREATE TABLE notifications` (sem dados prévios)
- `ALTER doctors ADD COLUMN user_id ... NULL` (todos os doctors existentes ficam com NULL; sem backfill)
- `CREATE OR REPLACE FUNCTION generate_user_notifications` (idempotente)

**Rollback dev**: documentado no quickstart:

```sql
DROP TRIGGER ... ON tasks; DROP TABLE tasks;
DROP TRIGGER ... ON notifications; DROP TABLE notifications;
ALTER TABLE doctors DROP COLUMN user_id;
DROP FUNCTION generate_user_notifications;
```

---

## Decisão 12 — Testes obrigatórios por constituição

Constitution §"Fluxo de Desenvolvimento" impõe:

- **(a) imutabilidade**: `tests/contract/tasks-immutability.spec.ts` (não financeiro, mas seguimos padrão) — UPDATE de `title`/`due_date`/`assigned_to` bloqueado pelo trigger.
- **(b) isolamento entre tenants**: `tests/contract/api-tarefas-tenant-isolation.spec.ts` + `doctors-user-id-unique.spec.ts`.
- **(c) RBAC por papel**: `tests/contract/api-tarefas-rbac.spec.ts` + `api-notificacoes-rbac.spec.ts` + `api-usuarios-manual-rbac.spec.ts`.

Integration:

- `tests/integration/tasks-crud.spec.ts` — fluxo completo + audit.
- `tests/integration/notifications-generation.spec.ts` — 4 categorias × idempotência.
- `tests/integration/notifications-mark-read-flow.spec.ts`.
- `tests/integration/manual-user-create-with-doctor-link.spec.ts`.

---

## Sumário das alternativas avaliadas e rejeitadas

| #   | Tema                     | Rejeitado                      | Por quê                                        |
| --- | ------------------------ | ------------------------------ | ---------------------------------------------- |
| 1   | Geração de notif         | pg_cron                        | Infra extra; lazy basta                        |
| 1   | Geração de notif         | Triggers em appointments/tasks | Cobertura parcial; explosão de pontos de falha |
| 2   | Chave natural            | `reference_id` apenas UUID     | aniversariantes não tem UUID                   |
| 3   | Destinatário atendimento | Todos os usuários              | Ruído operacional                              |
| 4   | doctors.user_id          | UNIQUE global                  | Bloqueia multi-tenant                          |
| 5   | Imutabilidade tasks      | Tudo mutável                   | Quebra padrão append-only                      |
| 6   | RBAC tasks               | Action separada por escopo     | Granularidade desnecessária                    |
| 7   | Audit                    | Auditar notificações           | Volume + valor probatório baixo                |
| 8   | Aniversariantes          | Coluna birth_month em claro    | PII conservador                                |
| 9   | Senha cadastro manual    | Regras de complexidade         | Fricção sem ganho                              |
| 10  | Sidebar                  | Sub-menu colapsável            | Quebra padrão plano atual                      |

---

## Tudo resolvido — pronto para Phase 1
