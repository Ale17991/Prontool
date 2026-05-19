# LGPD Email Audit — Feature 018

**Date**: 2026-05-19
**Auditor**: code review pré-merge

## Objetivo

Verificar que o email do paciente NUNCA aparece em texto claro em logs operacionais. SC-009 do spec.

## Inspeção do código

### Locais onde `patient.email` ou similar aparece

| Arquivo | Linha | Contexto | Avaliação |
|---------|-------|----------|-----------|
| `src/app/api/lembretes/[id]/reenviar/route.ts` | 59 | `select('email_enc, ...')` em query | OK — ciphertext, nunca claro |
| `src/app/api/lembretes/[id]/reenviar/route.ts` | 78,82,163 | refs a `email_enc` | OK — ciphertext |
| `src/lib/core/reminders/select-due.ts` | 57,118,141,143 | refs a `email_enc` | OK — ciphertext; comentário explica decrypt só em send-one.ts |
| `src/lib/core/reminders/send-one.ts` | 130 | check de `eligible.patientEmail` | OK — sentinela `'__encrypted__'`, não claro |
| `src/lib/core/reminders/send-one.ts` | 175 | `to: patient.email` | **CRÍTICO**: email em memória; passado direto ao Resend SDK; NÃO é logado em lugar nenhum |

### Logs em send-one.ts

```typescript
logger.info({ appointmentId, offsetHours }, 'reminder-already-queued-skipping')
logger.warn({ appointmentId, offsetHours }, 'reminder-insert-no-data')
logger.error({ appointmentId, offsetHours, errorCode }, 'reminder-insert-queued-failed')
logger.error({ reminderId, status, errorCode }, 'reminder-finalize-failed')
```

✅ Nenhum log contém `patient.email`, `email`, `patientEmail` ou `to`.

### Logs em route.ts (cron + reenviar)

```typescript
logger.info({}, 'cron-reminders-start')
logger.info(result, 'cron-reminders-done')   // result = {processed, sent, failed, ...}
logger.info({ appointmentId, actorUserId }, 'manual-resend-start')
logger.info({ appointmentId, reminderId, status }, 'manual-resend-done')
logger.error({ appointmentId, errorCode }, 'manual-resend-fatal')
```

✅ Nenhum log contém email.

### Pino redact (defesa em camadas)

`src/lib/observability/logger.ts` linhas 22-30 já redacta:
- `*.email` (linha 23)
- `*.phone`, `*.cpf`, `*.full_name`, `*.birth_date`
- `patient.email` (linha 28)
- `patient.phone`, `patient.cpf`, etc.

Mesmo se um caller futuro acidentalmente passar `{patient: {...}}` para um logger, o Pino mascara.

## Decrypt scope

O email do paciente em texto claro existe somente:
1. **In-memory** dentro de `sendOneReminder` entre RPC `get_patient_for_tenant` e chamada Resend
2. **No wire** entre Prontool e Resend (HTTPS — TLS handshake)
3. **No registro do Resend** (transparency: que o cliente do Resend mantém)

NUNCA fica:
- ✅ Em logs (Pino redact + cuidado manual em todos os call sites)
- ✅ Em audit_log (trigger registra `field=status`, `entity=appointment_reminders` — sem PII)
- ✅ Em browser console (route handler retorna apenas `{reminderId, status, providerMessageId, errorMessage}`)
- ✅ Em error responses (404/422/500 não incluem PII)

## Conclusão

**SC-009 atendido**: zero registros de email do paciente em texto claro em logs operacionais.

Defesa em 2 camadas:
1. **Local**: nenhum `logger.*` call inclui campos de email (auditoria por inspeção neste documento)
2. **Global**: Pino redact com `*.email` + `patient.email` (defesa em profundidade)
