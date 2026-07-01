# Contract — Fluxo de "Atendimento realizado" (`appointment_completions`)

**Locais**: `supabase/migrations/0055_appointment_conflict_and_completion.sql` (DDL); `src/lib/core/appointments/mark-realized.ts`; `src/app/api/atendimentos/[id]/realizado/route.ts`; `src/app/(dashboard)/operacao/atendimentos/[id]/mark-realized-form.tsx`.

## Schema

Ver detalhes completos em [`../data-model.md`](../data-model.md#appointment_completions-new). Resumo:

- `id, tenant_id, appointment_id (UNIQUE), completed_at, completed_by, source ('plan_step'|'manual'), reason`.
- Append-only via trigger `appointment_completions_immutable`.
- Audit via trigger `audit_appointment_completion_change`.

## Função RPC

`mark_appointment_realized(p_appointment_id UUID, p_by UUID, p_reason TEXT) RETURNS UUID`

Ver detalhes em [`../data-model.md`](../data-model.md#funções).

Comportamento:

- Falha com `appointment % not found` se inexistente.
- Falha com `cannot mark reversed appointment as realized` se já estornado.
- Falha com unique violation se já marcado realizado.
- Sucesso: retorna `completion_id`.

## Helper TypeScript

`src/lib/core/appointments/mark-realized.ts`:

```ts
export interface MarkRealizedInput {
  appointmentId: string
  actorUserId: string
  reason?: string
}

export async function markAppointmentRealized(
  supabase: SupabaseClient<Database>,
  input: MarkRealizedInput,
): Promise<{ completionId: string }>
```

Wrapper sobre `supabase.rpc('mark_appointment_realized', { ... })`. Mapeia erros conhecidos para `DomainError` apropriado.

## Endpoint

`POST /api/atendimentos/[id]/realizado`

**Auth**: `requireRole(['admin', 'profissional_saude'])` — mesmos papéis que executam estorno.

**Body** (Zod):

```ts
z.object({ reason: z.string().trim().max(500).optional() })
```

**Resposta 201**:

```json
{
  "completion_id": "uuid",
  "appointment_id": "uuid",
  "completed_at": "2026-05-04T15:30:00Z"
}
```

**Erros**:

- 404: appointment não existe.
- 409: já marcado realizado OU já estornado (mensagem específica em cada caso).
- 403: papel insuficiente.

## Sincronização com `treatment_plan_steps`

A trigger `appointment_completion_sync_to_step` cuida automaticamente: ao inserir em completions, se a tabela appointments tiver step com `appointment_id` igual, esse step é marcado como concluído.

Ordem de eventos:

1. `POST /api/atendimentos/[id]/realizado` chega.
2. Endpoint chama `markAppointmentRealized`.
3. RPC insere em `appointment_completions`.
4. Trigger `audit_appointment_completion_change` registra audit.
5. Trigger `appointment_completion_sync_to_step` UPDATE no step (se houver).
6. Trigger `step_status_sync_to_appointment` AOS step UPDATE — checa `pg_trigger_depth() = 2`, sai sem fazer nada (evita loop).

## UI

`mark-realized-form.tsx` — botão `<Button>` no detalhe do atendimento, visível quando `status === 'agendado'` E papel autorizado. Modal opcional pedindo reason. Após sucesso, `router.refresh()` para reflectir status `ativo`.

## Cenários de teste

1. **Caminho feliz**: agendar atendimento → marcar realizado via API → status na view vira `ativo`; completion existe; audit log tem entrada.
2. **Idempotência**: marcar realizado 2x → segundo retorna 409.
3. **Estornado não pode realizar**: estornar atendimento → tentar marcar realizado → 409 com mensagem específica.
4. **Sync com step**: criar etapa com horário (cria appointment+step linkados) → marcar realizado o appointment → step.status === 'concluido', step.completed_at preenchido.
5. **Sync reverso**: criar etapa+appointment → marcar etapa concluída → completion existe; appointment.status === 'ativo' na view.
