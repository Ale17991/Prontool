# Quickstart: Motor de lembretes automáticos (Fase 1)

**Feature**: 018-appointment-reminders
**Audience**: dev local validando end-to-end antes do PR

---

## §1. Pré-requisitos

- Docker Desktop rodando
- Repositório atualizado: `git pull origin master && git checkout 018-appointment-reminders`
- `.env.local` com:
  ```
  RESEND_API_KEY=re_xxxxx          # https://resend.com/api-keys (dev key)
  RESEND_FROM=lembretes@dev.prontool.io
  CRON_SECRET=<gere com `openssl rand -base64 32`>
  NEXT_PUBLIC_APP_URL=http://localhost:3000
  PATIENT_DATA_ENCRYPTION_KEY=<copie da pasta env existente>
  NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
  SUPABASE_SERVICE_ROLE_KEY=<da output do supabase start>
  ```

---

## §2. Subir stack local

```bash
pnpm supabase:reset    # aplica migrations incluindo 0094
pnpm supabase:gen-types  # atualiza src/lib/db/generated/types.ts
pnpm install
pnpm typecheck
pnpm test:unit          # 17+ tests devem passar
```

Inspecionar:

- Tabela `appointment_reminders` existe: `psql -c '\d appointment_reminders' postgres://...`
- 7 novas colunas em `tenant_clinic_profile`: `psql -c '\d tenant_clinic_profile' | grep reminder_`

---

## §3. Smoke US1 — admin configura motor

1. `pnpm dev`
2. Login como admin (`operations@homio.com.br` ou similar).
3. Ir para `/configuracoes/lembretes`.
4. Confirmar que feature aparece **desabilitada** por padrão.
5. Habilitar; deixar antecedência em `24h`, janela `08:00–20:00`, fim de semana on.
6. Customizar template (opcional): `subject = "Lembrete: consulta amanhã na {{clinica}}"`.
7. Salvar.
8. Recarregar a página. Os valores aparecem persistidos.
9. **Validar via DB**:
   ```sql
   SELECT reminder_enabled, reminder_offsets_hours, reminder_window_start
   FROM tenant_clinic_profile
   WHERE tenant_id = '<seu tenant>';
   ```

**Esperado**: row com `reminder_enabled = true, reminder_offsets_hours = '{24}', reminder_window_start = '08:00:00'`.

---

## §4. Smoke US4 — opt-in/opt-out

1. Abrir ficha de um paciente (`/operacao/pacientes/<id>`).
2. Encontrar o toggle "Receber lembretes automáticos" (acrescentado pela feature 018).
3. Verificar que vem habilitado por default.
4. Desabilitar e salvar.
5. **Validar via DB**:
   ```sql
   SELECT reminders_opt_in FROM patients WHERE id = '<patient_id>';
   ```
   Esperado: `FALSE`.

---

## §5. Smoke US2 — ciclo do cron

1. Criar um agendamento para **daqui a ~24h e 7 min** (dentro da janela do offset). Usar paciente com email e `reminders_opt_in = TRUE`.
2. Disparar o cron manualmente:
   ```bash
   curl -X POST http://localhost:3000/api/cron/send-reminders \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
3. Inspecionar resposta JSON: `{ processed: N, sent: M, failed: ..., skipped: ... }`.
4. **Validar via DB**:
   ```sql
   SELECT id, appointment_id, status, sent_at, provider_message_id
   FROM appointment_reminders
   ORDER BY created_at DESC
   LIMIT 5;
   ```
   Esperado: row com `status = 'sent'`, `sent_at IS NOT NULL`, `provider_message_id` populado.
5. **Validar entrega real** (Resend dev): conferir https://resend.com/emails — o último email deve aparecer.
6. **Validar audit log**:
   ```sql
   SELECT entity, entity_id, field, new_value, reason
   FROM audit_log
   WHERE entity = 'appointment_reminders'
   ORDER BY timestamp_utc DESC
   LIMIT 5;
   ```

---

## §6. Smoke idempotência

1. Disparar o cron **2x consecutivamente**:
   ```bash
   curl -X POST ... CRON_SECRET ...
   curl -X POST ... CRON_SECRET ...
   ```
2. **Validar**: `SELECT count(*) FROM appointment_reminders WHERE appointment_id = '<id>' AND is_manual = FALSE` deve retornar **1** (não 2).

---

## §7. Smoke US3 — histórico + reenvio manual

1. Voltar para `/configuracoes/lembretes`.
2. Conferir aba "Histórico" — o lembrete enviado em §5 aparece.
3. Clicar "Reenviar" no registro.
4. Conferir que aparece novo registro no histórico marcado como **envio manual**.
5. **Validar via DB**:
   ```sql
   SELECT count(*) FROM appointment_reminders
   WHERE appointment_id = '<id>' AND is_manual = TRUE;
   ```
   Esperado: ≥1.
6. Inbox: verificar que o paciente recebeu o segundo email.

---

## §8. Smoke opt-out

1. Para o paciente que recebeu o lembrete em §5: ir para `/operacao/pacientes/<id>` e desabilitar `reminders_opt_in`.
2. Criar novo agendamento ~24h no futuro para ele.
3. Disparar o cron.
4. **Validar via DB**:
   ```sql
   SELECT status FROM appointment_reminders
   WHERE appointment_id = '<novo id>';
   ```
   Esperado: `skipped_opt_out`.
5. Inbox: paciente NÃO recebeu novo email.

---

## §9. Smoke estorno (race condition)

1. Criar agendamento ~24h no futuro.
2. Estornar (criar `appointment_reversal` via UI ou direto no DB).
3. Disparar cron.
4. **Validar**: registro de reminder com `status = 'skipped_reversed'`. Inbox vazio.

---

## §10. Smoke isolamento multi-tenant (gate constitucional)

1. Logar como admin do **tenant B**.
2. Confirmar `reminder_enabled = FALSE` no tenant B (para isolar).
3. Disparar cron.
4. **Validar**: registros do tenant A não foram tocados; registros do tenant B = 0 (nenhum agendamento elegível). Audit log do tenant B = 0 novos itens da feature.

(Teste automatizado equivalente: `tests/contract/reminders-tenant-isolation.spec.ts`.)

---

## §11. Smoke fora da janela

1. Configurar janela `08:00–20:00`.
2. Disparar cron em ambiente com hora local fora da janela (mudar relógio do sistema OU manipular `now()` via SQL para teste).
3. **Validar**: nenhum registro novo de reminder. Resposta do cron `processed = 0`.

---

## §12. Validação final pré-PR

```bash
pnpm typecheck
pnpm test  # full suite — failures permitidos são apenas de Docker/integration sem stack
pnpm lint:auth  # garante requireRole nas novas rotas
pnpm build
```

Conferir que `/configuracoes/lembretes` aparece no sidebar para admin/recepcionista (e NÃO aparece para profissional de saúde).

---

## Troubleshooting

- **`PATIENT_DATA_ENCRYPTION_KEY` ausente**: paciente lookup falha; setar via `.env.local`.
- **Resend retorna 401**: API key inválida ou domínio não verificado.
- **Cron retorna 401**: `CRON_SECRET` divergente entre `.env.local` e header.
- **Trigger anti-mutation barra UPDATE**: tentativa de UPDATE direto fora do path `queued→sent/failed/skipped_*`. É comportamento esperado — usar somente o helper `send-one.ts`.
- **Lembrete não dispara**: conferir TZ do server (`SELECT now() AT TIME ZONE 'America/Sao_Paulo'`); janela é interpretada nesse fuso.
