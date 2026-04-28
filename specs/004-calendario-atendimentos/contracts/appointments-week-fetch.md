# Contract — `listAppointmentsForWeek`

**Localização**: `src/lib/core/appointments/list-week.ts`

## Assinatura

```ts
export interface ListWeekInput {
  tenantId: string
  weekStart: Date           // domingo 00:00:00 da semana exibida (em fuso da clínica)
  weekEnd: Date             // sábado 23:59:59
  doctorIds?: string[]      // opcional; ausente/vazio = todos
}

export interface AppointmentWeekRow {
  id: string
  patientId: string
  patientName: string                  // descriptografada via RPC `decrypt_patient_names_for_ids`
  doctorId: string
  doctorName: string
  procedureId: string
  procedureLabel: string               // display_name ?? tuss_code
  appointmentAt: string                // ISO with offset
  durationMinutes: number              // COALESCE(duration_minutes, 30)
  effectiveStatus: 'ativo' | 'estornado'
}

export async function listAppointmentsForWeek(
  supabase: SupabaseClient<Database>,
  input: ListWeekInput,
): Promise<AppointmentWeekRow[]>
```

## Comportamento

1. **Query base**: `appointments_effective` filtrada por `tenant_id`, `appointment_at >= weekStart`, `appointment_at <= weekEnd`. Order `appointment_at ASC`. Limit 500.
2. **Joins via Supabase select**:
   ```
   id, doctor_id, procedure_id, patient_id, appointment_at, duration_minutes, effective_status,
   doctors:doctor_id(full_name),
   procedures:procedure_id(tuss_code, display_name)
   ```
3. **Filtro de profissionais**: se `doctorIds` não-vazio, aplica `.in('doctor_id', doctorIds)`.
4. **Nomes de paciente**: chamada separada `service.rpc('decrypt_patient_names_for_ids', { p_tenant_id, p_patient_ids, p_key })` — mesmo padrão da página Lista. Pacientes anonimizados retornam `'[anonimizado]'`.
5. **Default duration**: rows com `duration_minutes IS NULL` mapeiam para `30` no DTO.
6. **Ausência da chave de criptografia** (`PATIENT_DATA_ENCRYPTION_KEY`): `patientName` retorna `'—'`; não bloqueia render do calendário.

## Erros

- `Error('appointments week fetch failed: ${message}')` em qualquer falha de query.
- Sem swallow silencioso — caller (server component) pode escolher renderizar fallback.

## Performance

- 1 query principal + 1 RPC de descriptografia em batch. Total ≤ 2 round-trips para até 500 atendimentos.
- Índice `appointments_tenant_at_idx` cobre o filtro principal.
- Filtro `doctor_id` adiciona predicate; cobertura via `appointments_tenant_doctor_at_idx`.

## RLS

Cliente: `createSupabaseServerClient()` (SSR). Policies existentes filtram por `tenant_id` automaticamente — o param `tenantId` no input é redundante para segurança mas explícito para legibilidade do código.

## Testes (integration)

`tests/integration/atendimentos-calendar.spec.ts`:

1. Seed 5 atendimentos em 2 profissionais ao longo de uma semana.
2. `listAppointmentsForWeek` sem `doctorIds` → 5 rows.
3. Com `doctorIds=[d1]` → apenas atendimentos de d1.
4. `weekStart`/`weekEnd` recortando 1 dia → apenas atendimentos daquele dia.
5. Atendimento com `duration_minutes IS NULL` → DTO retorna `durationMinutes=30`.
6. Atendimento estornado → `effectiveStatus='estornado'`.
