# Data Model — Notificações por comportamento do paciente (053)

Migration: **`0192_patient_signal_rules.sql`**. Todas as tabelas com `tenant_id`
e RLS por `public.jwt_tenant_id()`, no padrão do repo (Princípio III).

---

## 1. `signal_rules` — a regra que a clínica ligou

Instância parametrizada de uma família do catálogo. A família em si é código
(`src/lib/core/signals/catalog.ts`, ver research D2) e **não** tem tabela.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL → `tenants` | CASCADE |
| `family` | TEXT NOT NULL | CHECK na lista fechada de famílias |
| `params` | JSONB NOT NULL | validado pelo Zod da família (D11) |
| `audience` | TEXT NOT NULL DEFAULT `'todos_ativos'` | CHECK `todos_ativos` \| `por_profissional` |
| `audience_doctor_id` | UUID NULL → `doctors` | obrigatório quando `audience='por_profissional'` |
| `channel` | TEXT NOT NULL | CHECK `whatsapp` \| `email` \| `preferencial` |
| `message_template` | TEXT NOT NULL | texto com campos `{{...}}` |
| `silence_days` | SMALLINT NOT NULL | CHECK entre 1 e 90 |
| `active` | BOOLEAN NOT NULL DEFAULT TRUE | |
| `created_by_user_id` | UUID NULL | |
| `created_at` / `updated_at` | TIMESTAMPTZ | trigger `touch_updated_at` |

**Regras**
- Mais de uma instância da mesma família é permitida (FR-004) — dois hábitos
  diferentes, dois limiares. Sem unique em `(tenant, family)`.
- CHECK de coerência: `audience_doctor_id IS NOT NULL` se e somente se
  `audience = 'por_profissional'`.
- `active = FALSE` mantém a linha: o histórico de ocorrências continua
  referenciando a regra, e apagar deixaria o histórico órfão.
- Auditoria em INSERT/UPDATE/DELETE via `log_audit_event` (FR-007, Princípio II).

**RLS**: leitura por tenant; escrita exige `reminders.config` — modelado como
policy de `admin` + verificação de permissão na rota (o RBAC fino vive na
aplicação, como no resto do repo).

---

## 2. `signal_occurrences` — o encontro entre regra e paciente num ciclo

Append-only. É o histórico (FR-025, FR-026) **e** a fonte do anti-spam (D6).

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `tenant_id` | UUID NOT NULL → `tenants` | RESTRICT |
| `rule_id` | UUID NOT NULL → `signal_rules` | RESTRICT |
| `patient_id` | UUID NOT NULL → `patients` | RESTRICT |
| `cycle_date` | DATE NOT NULL | dia do ciclo **no fuso da clínica** (FR-012) |
| `outcome` | TEXT NOT NULL | CHECK, ver abaixo |
| `observed` | JSONB NOT NULL | o que a regra viu: dias sem registro, itens, última data |
| `message_id` | UUID NULL → `patient_messages` | preenchido só quando `outcome='enviada'` |
| `created_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**`outcome`** — CHECK na lista:

| Valor | Significado |
|---|---|
| `enviada` | condição batida, mensagem despachada |
| `silenciada` | condição batida, mas a janela de silêncio da regra ainda não venceu |
| `adiada` | condição batida, mas o teto global do paciente estourou no ciclo |
| `suprimida_sem_portal` | condição batida, mas o paciente não teve atividade no portal na janela (D4) |
| `sem_consentimento` | paciente sem `outreach_opt_in`, ou canal recusado |
| `sem_contato` | paciente sem telefone e sem e-mail utilizáveis |
| `falha_envio` | despacho tentado e falhou |

Gravar os desfechos que **não** enviaram é o que permite responder "por que meu
paciente não recebeu?" — a primeira pergunta que a clínica faz. Contar só os
envios esconderia justamente o caso que gera dúvida.

**Índices**
- `(tenant_id, rule_id, patient_id, created_at DESC)` — consulta do silêncio.
- `(tenant_id, patient_id, created_at DESC) WHERE outcome = 'enviada'` — teto global.
- `UNIQUE (rule_id, patient_id, cycle_date)` — **idempotência do ciclo** (FR-024):
  reprocessar o mesmo dia não gera segunda ocorrência nem segunda mensagem.

**Trigger**: bloqueia UPDATE e DELETE (padrão `whatsapp_delivery_events` da 0185).

---

## 3. `patient_messages` — comunicação ao paciente, sem consulta

A peça que faltava (research D3/D8). Deliberadamente **não** conhece regra: é
"mensagem enviada a um paciente", e serve a esta feature e a quem vier depois.

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | é o `externalId` mandado ao serviço de envio |
| `tenant_id` | UUID NOT NULL → `tenants` | RESTRICT |
| `patient_id` | UUID NOT NULL → `patients` | RESTRICT |
| `purpose` | TEXT NOT NULL | CHECK; v1 só `acompanhamento` |
| `channel` | TEXT NOT NULL | CHECK `whatsapp` \| `email` |
| `body` | TEXT NOT NULL | o texto **já renderizado**, como o paciente leu |
| `status` | TEXT NOT NULL | CHECK `sent` \| `failed` |
| `error_detail` | TEXT NULL | truncado em 500 |
| `sent_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | |

**Guardar `body` renderizado é intencional.** O template pode ser editado depois;
recompor a mensagem a partir dele mostraria à clínica algo diferente do que o
paciente recebeu. É o oposto do `LabelResult` da 052, que é recomposto de
propósito — lá o documento ainda não foi entregue, aqui já foi.

**Sem `delivered`/`read` em v1** (research D3). O CHECK de `status` fica com dois
valores; ampliá-lo depois é `ALTER`, não redesenho.

**Sem PII no `body`?** Não — o body TEM o nome do paciente. A tabela é tratada
como dado de paciente para todos os efeitos: RLS por tenant, sem exposição em
log, e fora do `renderSafeDetail` de alertas.

---

## 4. `patients.outreach_opt_in` — consentimento de finalidade

```sql
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS outreach_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
```

`DEFAULT FALSE` é a decisão de research D5, não descuido: a base existente nasce
desligada porque o aceite de lembrete foi dado para outra finalidade.

Hierarquia efetiva na avaliação:

```
outreach_opt_in = FALSE                     → sem_consentimento (finalidade)
canal = whatsapp e reminders_whatsapp_opt_in = FALSE → sem_consentimento (canal)
```

`reminders_opt_in` **não** participa: é o gate do lembrete de consulta, outra
finalidade. Documentado em `COMMENT ON COLUMN`.

---

## 4b. `tenant_clinic_profile.outreach_weekly_cap` — o teto global

```sql
ALTER TABLE public.tenant_clinic_profile
  ADD COLUMN IF NOT EXISTS outreach_weekly_cap SMALLINT NOT NULL DEFAULT 2
    CHECK (outreach_weekly_cap BETWEEN 1 AND 7);
```

Mora no perfil da clínica, **não** em `signal_rules`: o paciente percebe o
volume total que recebe, não a origem de cada mensagem. Teto por regra não
somaria, que é exatamente o problema que a US4 resolve.

A janela horária **não** ganha colunas novas — reusa
`reminder_window_start`/`reminder_window_end` (Assumptions do spec).

---

## 4c. Resolução do público "por profissional"

Não há coluna. O vínculo é derivado: **o profissional da consulta mais recente
do paciente** em `appointments` (FR-003a). Paciente sem nenhuma consulta não
entra em público por profissional (FR-003b) — não há de quem ele seja.

Resolvido uma vez por ciclo, por clínica, num único `SELECT DISTINCT ON
(patient_id) ... ORDER BY patient_id, appointment_at DESC` — não por paciente,
que seria N+1 sobre a base inteira.

---

## 5. Entidades de leitura (nenhuma alteração)

| Tabela | Papel |
|---|---|
| `habit_checklist_marks`, `patient_habit_checklists` | sinal de hábito + piso da janela |
| `patient_measurements`, `patient_metric_goals`, `patient_metric_types` | sinal de medição e meta |
| `patient_portal_access_log` | elegibilidade e supressão (D4) |
| `appointments` | sinal de ausência de retorno |
| `patients` | contato cifrado (via RPC), status, consentimentos |
| `tenant_clinic_profile` | janela horária e fuso do envio |
| `tenant_whatsapp_config` | conexão do canal |
| `tenant_entitlements` | módulo `acompanhamento` |

---

## Fluxo de estado de uma ocorrência

Não há máquina de estado: a ocorrência **nasce no desfecho** e é imutável. Isso
é diferente de `appointment_reminders`, que nasce `queued` e transiciona — lá a
mensagem é enfileirada e o desfecho chega depois; aqui a avaliação e a decisão
acontecem no mesmo instante, e só o despacho é assíncrono.

Quando o despacho assíncrono falha, **não** se altera a ocorrência (é
append-only): grava-se `patient_messages.status='failed'`, e a ocorrência aponta
para ela. "Foi decidido enviar" e "a entrega falhou" são fatos distintos e
ambos verdadeiros.
