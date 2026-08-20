# Data Model — Lembretes por WhatsApp (051)

**Migration**: `0185_whatsapp_reminders.sql` (0184 é de exames laboratoriais)

Todos os timestamps em UTC. Todo objeto novo carrega `tenant_id` + RLS.

---

## 1. `tenant_whatsapp_config` (nova)

Conexão de WhatsApp de uma clínica. 1 linha por tenant (v1: um número por clínica).

| Coluna                      | Tipo                                     | Notas                                                                                                                                  |
| --------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant_id`                 | `UUID` PK                                | FK → `tenants(id)` ON DELETE RESTRICT                                                                                                  |
| `api_key_enc`               | `BYTEA` NOT NULL                         | `api_key` do tenant no braço, cifrada com `enc_text_with_key(?, PATIENT_DATA_ENCRYPTION_KEY)` — padrão de `tenant_memed_config` (0110) |
| `service_tenant_slug`       | `TEXT` NOT NULL                          | slug do tenant no braço (prefixo do nome da instância)                                                                                 |
| `instance_name`             | `TEXT` NULL                              | nome da instância na Evolution (`{slug}-{n}`)                                                                                          |
| `connection_status`         | `TEXT` NOT NULL DEFAULT `'disconnected'` | CHECK ∈ (`disconnected`, `connecting`, `connected`)                                                                                    |
| `number_connected`          | `TEXT` NULL                              | número vinculado, para exibição                                                                                                        |
| `connected_at`              | `TIMESTAMPTZ` NULL                       |                                                                                                                                        |
| `last_status_at`            | `TIMESTAMPTZ` NULL                       | última confirmação de estado vinda do braço                                                                                            |
| `created_at` / `updated_at` | `TIMESTAMPTZ` NOT NULL DEFAULT `now()`   |                                                                                                                                        |

**RLS**: leitura pelo tenant (`tenant_id = public.jwt_tenant_id()`); escrita só `service_role`.
`api_key_enc` **nunca** sai em SELECT de rota — as leituras da UI usam uma view/projeção sem ela.

**Auditoria** (Princípio II): trigger registrando conexão, desconexão e mudança de estado.

---

## 2. `whatsapp_delivery_events` (nova)

Append-only. Uma linha por confirmação de status recebida do braço. Ver D4 do research —
`appointment_reminders` não aceita `UPDATE` depois de terminal.

| Coluna                | Tipo                                   | Notas                                                              |
| --------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `id`                  | `UUID` PK DEFAULT `gen_random_uuid()`  |                                                                    |
| `tenant_id`           | `UUID` NOT NULL                        | FK → `tenants(id)`; filtro explícito em toda query (Princípio III) |
| `reminder_id`         | `UUID` NOT NULL                        | FK → `appointment_reminders(id)` ON DELETE RESTRICT                |
| `provider_message_id` | `TEXT` NULL                            | id da mensagem no braço                                            |
| `status`              | `TEXT` NOT NULL                        | CHECK ∈ (`sent`, `delivered`, `read`, `error`)                     |
| `error_detail`        | `TEXT` NULL                            | ≤ 500 chars                                                        |
| `occurred_at`         | `TIMESTAMPTZ` NOT NULL                 | quando o evento ocorreu (vem do braço)                             |
| `received_at`         | `TIMESTAMPTZ` NOT NULL DEFAULT `now()` | quando chegou aqui                                                 |

**Índices**: `(tenant_id, reminder_id)`, `(reminder_id, occurred_at DESC)`.

**RLS**: leitura pelo tenant; INSERT só `service_role`. Trigger anti-`UPDATE`/`DELETE`.

**Precedência de leitura** (FR-019 — status não regride): a UI resolve o status corrente do
lembrete pelo **maior rank** entre os eventos, não pelo mais recente.
`rank: sent=1, delivered=2, read=3, error=9`. Um `delivered` que chega depois de um `read` fica
registrado (é histórico verdadeiro) mas não rebaixa a exibição.

---

## 3. `appointment_reminders` (alterada)

Sem coluna nova. Apenas expansão do CHECK de `status`:

```
+ 'skipped_no_phone'              -- paciente sem telefone
+ 'skipped_no_connection'         -- número da clínica não conectado no momento do lote
+ 'skipped_opt_out_channel'       -- paciente recusou este canal especificamente
```

O CHECK de `channel` **já** aceita `'whatsapp'` (0094, linha 112) — nada a fazer.

O trigger `enforce_reminders_status_transition` precisa aceitar os três novos status como
destinos válidos de `queued →`. Continua proibindo qualquer transição a partir de terminal.

**Índice de idempotência**: nenhuma mudança. O parcial
`(appointment_id, scheduled_offset_hours, channel) WHERE is_manual = FALSE` já discrimina por
canal — e-mail e WhatsApp do mesmo agendamento/offset convivem sem colidir, que é justamente o
que o modo "ambos" (US3) precisa.

---

## 4. `patients` (alterada)

| Coluna                      | Tipo                              | Notas                               |
| --------------------------- | --------------------------------- | ----------------------------------- |
| `reminders_whatsapp_opt_in` | `BOOLEAN` NOT NULL DEFAULT `TRUE` | recusa específica do canal WhatsApp |

`reminders_opt_in` continua sendo o **mestre**: `FALSE` nele bloqueia todos os canais. O novo
campo só é consultado quando o mestre é `TRUE`. Auditoria já é automática pelo trigger existente
em `patients`.

---

## 5. `tenant_clinic_profile` (alterada)

| Coluna                             | Tipo                                  | Notas                                            |
| ---------------------------------- | ------------------------------------- | ------------------------------------------------ |
| `reminder_channels`                | `TEXT[]` NOT NULL DEFAULT `'{email}'` | subconjunto não-vazio de (`email`, `whatsapp`)   |
| `reminder_whatsapp_fallback_email` | `BOOLEAN` NOT NULL DEFAULT `TRUE`     | FR "WhatsApp com fallback" (US3)                 |
| `reminder_template_whatsapp`       | `TEXT` NULL                           | template texto puro; `NULL` = default do sistema |

**Constraint**: `array_length(reminder_channels, 1) >= 1`. A validação "não pode ligar
`whatsapp` sem número conectado" (FR-005) é de aplicação, não de banco — depende de estado que
vive no braço.

---

## Máquina de estados de um lembrete WhatsApp

```
                        (cron seleciona)
                              │
                              ▼
                           queued
                              │
        ┌─────────────────────┼──────────────────────────┐
        │                     │                          │
   (revalidação JIT)     (envio ok)                 (envio falhou)
        │                     │                          │
        ▼                     ▼                          ▼
  skipped_no_phone          sent                      failed
  skipped_opt_out           │
  skipped_opt_out_channel   │  ← daqui em diante o lembrete é IMUTÁVEL;
  skipped_no_connection     │    a evolução vive em whatsapp_delivery_events
  skipped_reversed          │
  skipped_doctor_inactive   ▼
                    delivered → read
                         (ou error)
```

---

## O que muda no braço `clinni-whatsapp` (repo separado)

Migration `0002_hardening.sql` naquele repo:

- `enable row level security` + policies nas 4 tabelas; `REVOKE ALL` de `anon`/`authenticated`.
- `UNIQUE (tenant_id, external_id)` em `outbound_messages` (D6).
- `webhook_token` em `instances` (ou em `tenants`) para autenticar o `status-webhook` (D7.1).

Sem mudança de contrato REST: `send-message` e o callback mantêm o formato já documentado no
`HANDOFF.md` daquele repo.
