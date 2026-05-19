# T004 — Investigação trigger `appointment_slot_locks`

**Task**: T004 (Phase 1)
**Date**: 2026-05-19
**Source**: `supabase/migrations/0055_appointment_conflict_and_completion.sql`

## Achados

### Criação do slot lock

Linhas 189-192:
```sql
DROP TRIGGER IF EXISTS appointments_create_slot_lock ON public.appointments;
CREATE TRIGGER appointments_create_slot_lock
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.create_slot_lock_on_appointment();
```

**Implicação**: ao criar appointment público, o slot lock é **automaticamente** populado pelo trigger. Não precisamos chamar nada explícito em `create-booking.ts`.

### Release do slot lock

Linhas 202-205:
```sql
DROP TRIGGER IF EXISTS appointment_reversals_release_slot_lock ON public.appointment_reversals;
CREATE TRIGGER appointment_reversals_release_slot_lock
  AFTER INSERT ON public.appointment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.release_slot_lock_on_reversal();
```

Função `release_slot_lock_on_reversal` (linhas 194-200):
```sql
DELETE FROM public.appointment_slot_locks
 WHERE appointment_id = NEW.appointment_id;
```

**Implicação CRÍTICA**: o release do slot é disparado **apenas** por INSERT em `appointment_reversals`, não por UPDATE em `appointments`.

## Decisão de design para US4 (cancelamento via token)

**Padrão correto do projeto**: cancelar uma consulta = **INSERT em `appointment_reversals`** (append-only).

Não é `UPDATE appointments.status = 'cancelado'` — o domínio usa a view `appointments_effective` (linhas 414-434) que computa `effective_status` baseado em existência de reversal/completion:

```sql
CASE
  WHEN r.id IS NOT NULL THEN 'estornado'
  WHEN c.id IS NOT NULL THEN 'ativo'
  ELSE                       'agendado'
END AS effective_status
```

### O que `cancel-booking.ts` deve fazer

1. Validar token (hash + expiração + not used).
2. Buscar appointment + verificar janela `cancel_min_hours`.
3. **INSERT em `appointment_reversals`** com:
   - `tenant_id` (resolvido via appointment)
   - `appointment_id`
   - `reversal_amount_cents = -frozen_amount_cents` (cancela 100% — appointment público não foi cobrado mesmo)
   - `reason = 'public_booking_cancel_via_token'`
   - `created_by` = `NULL` ou um marker UUID dedicado (verificar schema de `appointment_reversals.created_by`)
4. Trigger `appointment_reversals_release_slot_lock` libera o slot automaticamente.
5. `UPDATE public_booking_tokens SET used_at = now() WHERE id = $1`.
6. Audit via `log_audit_event` event_type='public_booking_cancelled'.
7. Notifications para admins (type='public_booking').

### Sem mudança no schema

**Não preciso** adicionar `released_at` em `appointment_slot_locks` (alternativa B do research §13 descartada). Trigger existente já trata o release.

### Atenção: schema de `appointment_reversals.created_by`

Verificar se `created_by` aceita `NULL` (para ator anônimo do public booking) ou se exige UUID válido. Se exigir UUID, criar um marker UUID dedicado para "sistema público" (similar ao padrão de algumas migrations que usam `tenant_id` como fallback — ver linha 253 de 0055).

## Mudança no plano

- **Tasks afetadas**: T104, T105 do tasks.md original (US4 cancel) precisam ser atualizadas para refletir: "INSERT em appointment_reversals em vez de UPDATE em appointments + DELETE explícito do slot_lock".
- **Migration 0084 não precisa de mudança** — investigação concluída em favor de "usar mecanismo existente".

## Conclusão

- ✅ Decisão research §13 resolvida: **inserir em appointment_reversals**, trigger existente libera slot.
- ✅ Sem novas mudanças de schema.
- ⚠ Atualizar tasks T104-T105 no momento da implementação da US4 para refletir esse design (não fazer UPDATE direto em appointments.status).
