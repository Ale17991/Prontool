# Contract — Link `treatment_plan_steps.appointment_id` + auto-create + auto-link

**Locais**: `supabase/migrations/0055_appointment_conflict_and_completion.sql`; `src/lib/core/appointments/create-manual.ts`; `src/app/api/pacientes/[id]/etapas/route.ts`; `src/app/(dashboard)/operacao/pacientes/[id]/treatment-steps-section.tsx`.

## Schema

Ver [`../data-model.md`](../data-model.md#treatment_plan_steps-alter). Resumo:
- `appointment_id UUID NULL UNIQUE REFERENCES appointments(id)`.
- Column-guard relaxado: UPDATE em `appointment_id` aceito apenas quando `OLD.appointment_id IS NULL`.

## Função plpgsql

`create_step_with_appointment(p_tenant_id, p_patient_id, p_procedure_id, p_doctor_id, p_plan_id, p_appointment_at TIMESTAMPTZ, p_duration_minutes INTEGER, p_title TEXT, p_notes TEXT, p_created_by UUID) RETURNS UUID`

Lógica:
1. INSERT em `appointments` com `source='manual'`, `appointment_at=p_appointment_at`, `duration_minutes=p_duration_minutes`. Falha de slot lock propaga (HTTP 409 no caller).
2. INSERT em `treatment_plan_steps` com `appointment_id=appointment.id`, `scheduled_date=DATE(p_appointment_at AT TIME ZONE 'America/Sao_Paulo')`, demais campos.
3. RETURN `step.id`.

Tudo na transação implícita da função (sem savepoints).

## Endpoint

`POST /api/pacientes/[id]/etapas`

**Auth**: `requireRole(['admin', 'profissional_saude', 'recepcionista'])`.

**Body** (Zod, expandido):
```ts
z.object({
  procedure_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  health_plan_id: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).nullable(),
  // NOVOS campos:
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),  // HH:MM local
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
}).refine((d) => timeToMinutes(d.end_time) > timeToMinutes(d.start_time), {
  message: 'end_time deve ser depois de start_time',
})
```

Handler converte `scheduled_date + start_time` para `appointment_at` (UTC), calcula `duration_minutes = endMin - startMin`, e chama `create_step_with_appointment` via RPC.

**Resposta 201**:
```json
{
  "step_id": "uuid",
  "appointment_id": "uuid",
  "scheduled_at": "2026-05-04T14:00:00Z",
  "duration_minutes": 30
}
```

**Erros**:
- 400: validação Zod (incluindo `end > start`).
- 409: conflito de horário (`APPOINTMENT_CONFLICT`).
- 404: paciente/procedimento/profissional/plano não encontrado no tenant.

## Auto-link FIFO em `create_manual`

Após o INSERT bem-sucedido em `appointments`, a função `createAppointmentManually` (em `src/lib/core/appointments/create-manual.ts`) executa:

```ts
const linkable = await supabase
  .from('treatment_plan_steps')
  .select('id')
  .eq('tenant_id', input.tenantId)
  .eq('patient_id', input.patientId)
  .eq('procedure_id', input.procedureId)
  .eq('status', 'pendente')
  .is('appointment_id', null)
  .order('created_at', { ascending: true })
  .limit(1)
  .maybeSingle()

if (linkable.data) {
  await supabase
    .from('treatment_plan_steps')
    .update({ appointment_id: appointment.id })
    .eq('id', linkable.data.id)
}
```

O column-guard relaxado aceita esse UPDATE (porque `OLD.appointment_id IS NULL`).

## Sincronização bidirecional (triggers)

Ver detalhes em [`../data-model.md`](../data-model.md#triggers-resumo). Resumo dos cenários:

| Ação do usuário | Trigger primário | Efeito secundário |
|---|---|---|
| Marca etapa como `concluido` | `step_status_sync_to_appointment` (UPDATE on steps) | INSERT em `appointment_completions` → trigger `appointment_completion_sync_to_step` no-op (depth>1) |
| Marca etapa como `cancelado` | `step_status_sync_to_appointment` (UPDATE on steps) | INSERT em `appointment_reversals` → trigger `appointment_reversal_sync_to_step` no-op (depth>1) |
| Marca atendimento como realizado | endpoint chama `mark_appointment_realized` → INSERT em completions | trigger `appointment_completion_sync_to_step` UPDATE step.status='concluido'; `step_status_sync_to_appointment` no-op (depth>1) |
| Estorna atendimento | INSERT em `appointment_reversals` | trigger `appointment_reversal_sync_to_step` UPDATE step.status='cancelado'; trigger `release_slot_lock` libera o slot |

## UI

### `treatment-steps-section.tsx` — formulário de nova etapa

Campos novos:
- `<Input type="date" required>` para `scheduled_date` (já existia).
- `<Input type="time" required>` para `start_time`.
- `<Input type="time" required>` para `end_time`.

Pré-check de conflito ao mudar `doctor_id`, `start_time`, `end_time` ou `scheduled_date`: chama `/api/atendimentos/check-conflict`. Mostra aviso inline se conflito.

Bloco "valor estimado" continua aparecendo (não foi removido — só do card final, na feature anterior).

### Banner de etapa legada sem horário

Quando lista de etapas inclui alguma com `appointment_id IS NULL`:
```tsx
<Banner>
  Você tem N etapas sem horário definido. Agende cada uma para que apareçam no calendário da clínica.
</Banner>
```

Na linha da etapa (StepRow), botão "Agendar agora" abre modal com `scheduled_date + start_time + end_time`. Submit faz UPDATE no step com `appointment_id` (cria appointment via RPC `create_appointment_for_legacy_step`).

## Cenários de teste

1. **Criar etapa nova com horário**: payload válido → 201 com `step_id` e `appointment_id`. Ambos existem no banco. Slot lock criado.
2. **Conflito**: criar etapa que conflita com appointment existente → 409, nenhum step criado, transação rollback completa.
3. **Auto-link FIFO**: paciente tem 2 etapas pendentes do mesmo procedimento criadas em sequência. Criar atendimento avulso para esse paciente+procedimento → linka à etapa mais antiga.
4. **Sync etapa→ativo**: criar etapa, marcar concluída, ver appointment como `ativo` na view.
5. **Sync atendimento→step concluído**: criar etapa, marcar appointment realizado, ver step.status='concluido'.
6. **Sync etapa→cancelado**: cancelar etapa, ver appointment como `estornado` na view, slot lock liberado.
7. **Etapa legada (`appointment_id NULL`)**: aparece com banner; "Agendar agora" cria appointment e linka. Após link, `appointment_id` é imutável (tentar UPDATE de novo → erro do column-guard).
