# Contract — POST `/api/cron/send-reminders`

**Localização**: `src/app/api/cron/send-reminders/route.ts`.
**Acesso**: Vercel Cron (header `Authorization: Bearer ${CRON_SECRET}`).
**Schedule**: `*/15 * * * *` (a cada 15 minutos) via `vercel.json`.

---

## Request

```
POST /api/cron/send-reminders
Authorization: Bearer <CRON_SECRET>
```

Sem corpo. Sem query params. Sem path params.

## Response

### 200 OK — sucesso (mesmo com falhas individuais)

```json
{
  "processed": 47,
  "sent": 42,
  "failed": 2,
  "skipped": 3,
  "tenantsAffected": 12,
  "durationMs": 4823
}
```

Sempre 200 quando o ciclo completou — falhas individuais ficam contabilizadas mas não derrubam o cron (FR-014).

### 401 Unauthorized — header inválido

```json
{ "error": "UNAUTHORIZED" }
```

### 429 Too Many Requests — execução concorrente detectada

```json
{ "error": "CONCURRENT_RUN_DETECTED" }
```

(Defense-in-depth — Vercel não dispara concorrente normalmente; mas se um cron anterior ainda está rodando, retornamos 429 e o seguinte vai tentar de novo no próximo slot.)

### 500 Internal Server Error — erro fatal (DB indisponível, etc.)

```json
{ "error": "INTERNAL_ERROR", "message": "..." }
```

---

## Server-side flow

1. **Auth**: validar header `Authorization` contra `CRON_SECRET` em env. Falha → 401.
2. **Carregar tenants ativos**: `SELECT tenant_id, reminder_offsets_hours, reminder_send_weekends, reminder_window_start, reminder_window_end, reminder_template_subject, reminder_template_body FROM tenant_clinic_profile WHERE reminder_enabled = TRUE`.
3. **Para cada tenant**, em paralelo (limit 5 tenants concorrentes para não congestionar Resend rate):
   - Resolver fuso do tenant (`America/Sao_Paulo` default).
   - Calcular hora local atual.
   - Se fora da janela (`window_start <= now_local <= window_end`) → pular tenant.
   - Se hoje é fim de semana e `reminder_send_weekends = FALSE` → pular tenant.
   - Para cada `offset` em `reminder_offsets_hours`:
     - `SELECT appointments` onde `appointment_at BETWEEN now() + offset - 15min AND now() + offset` AND `tenant_id = ?` AND `patient.reminders_opt_in = TRUE` AND NOT EXISTS (SELECT 1 FROM appointment_reversals WHERE appointment_id = appointments.id) AND NOT EXISTS (SELECT 1 FROM appointment_reminders WHERE appointment_id = appointments.id AND scheduled_offset_hours = ? AND channel = 'email' AND is_manual = FALSE).
     - Acumular em buffer global do ciclo até 200 itens (cap §2).
4. **Processar buffer**:
   - `Promise.allSettled(items.map(sendOneReminder))`.
   - Para cada item:
     - `INSERT appointment_reminders` com `status='queued'` (transação curta com `ON CONFLICT DO NOTHING`).
     - Se conflito (já processado por race) → contabilizar como "skipped (idempotent)" e seguir.
     - Caso contrário, prosseguir com envio.
     - Validar opt-in atual (refresh): se `reminders_opt_in=FALSE` → `UPDATE status='skipped_opt_out'`.
     - Validar appointment não estornado: `SELECT 1 FROM appointment_reversals WHERE appointment_id = ?` → se existe, `UPDATE status='skipped_reversed'`.
     - Validar paciente tem email não-nulo: senão `UPDATE status='skipped_no_email'`.
     - Resolver `doctor.full_name`, `procedure.display_name`, `patient.full_name`, `patient.email` (dados ATUAIS — clarificação Q4).
     - Renderizar template (com escape HTML em cada placeholder).
     - Chamar `sendBookingEmail` (ou nova fn `sendReminderEmail`) do Resend client.
     - Se sucesso → `UPDATE status='sent', sent_at=now(), provider_message_id=<id>`.
     - Se erro → `UPDATE status='failed', error=<msg truncada 500 chars>`.
5. **Atualizar `tenant_clinic_profile.reminder_last_run_at`** = now() para cada tenant processado.
6. **Retornar** payload com contadores agregados.

---

## Edge cases tratados

- **Tenant sem feature habilitada**: filtrado no SELECT inicial; não aparece no buffer.
- **Tenant em fim de semana com toggle off**: pulado; nenhum registro criado.
- **Hora fora da janela**: pulado; agendamento volta a ser elegível no próximo ciclo dentro da janela.
- **Race com cron concorrente**: `INSERT ... ON CONFLICT DO NOTHING` na UNIQUE constraint resolve.
- **Erro de provedor (Resend 5xx)**: registro fica `status='failed'`; admin reenvia manual.
- **Timeout do cron (29s)**: tenta finalizar buffer atual; restantes ficam para próximo ciclo (idempotência protege contra duplicação).
- **Conexão DB cai no meio**: transação atual roll-backs; próximo ciclo retoma.

---

## Observability

- Log Pino info no início: `{ msg: 'cron-reminders-start', tick: now }`.
- Log Pino info no fim: `{ msg: 'cron-reminders-done', processed, sent, failed, skipped, durationMs }`.
- Cada falha individual loga `{ msg: 'reminder-send-failed', appointmentId, errorCode }` (NUNCA o email do paciente).
- Métricas agregadas (Vercel Analytics ou similar) podem usar o response JSON.

---

## Idempotência e segurança

- **Idempotência**: UNIQUE constraint cobre execuções concorrentes. Reexecutar com mesmo input não gera duplicação.
- **Auth**: `CRON_SECRET` em env separado; rotacionável sem afetar outras rotas.
- **Rate limit Resend**: respeitar limite do plano (100 req/s atual); concorrência interna 200 itens em ~5s estoura levemente — usar `p-limit` ou similar se necessário (Fase 1 não precisa; concorrência implícita do Node fetch é suficiente para 100-200/s).
