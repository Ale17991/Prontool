# Contract — Constraint de exclusão de conflito de horário

**Locais**: `supabase/migrations/0055_appointment_conflict_and_completion.sql` (DDL); `src/lib/core/appointments/check-conflict.ts` (helper); `src/app/api/atendimentos/check-conflict/route.ts` (endpoint).

## DDL

```sql
-- Pré-requisito
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- Tabela auxiliar (índice derivado, não financeiro)
CREATE TABLE public.appointment_slot_locks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  doctor_id       UUID NOT NULL REFERENCES public.doctors(id) ON DELETE RESTRICT,
  appointment_id  UUID NOT NULL UNIQUE REFERENCES public.appointments(id) ON DELETE RESTRICT,
  slot_range      TSTZRANGE NOT NULL,
  CONSTRAINT appointment_slot_locks_no_overlap
    EXCLUDE USING gist (
      tenant_id WITH =,
      doctor_id WITH =,
      slot_range WITH &&
    )
);

ALTER TABLE public.appointment_slot_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_select" ON public.appointment_slot_locks
  FOR SELECT USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid);

-- Trigger: ao inserir appointment, criar slot lock
CREATE OR REPLACE FUNCTION public.create_slot_lock_on_appointment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_duration INTEGER;
  v_range TSTZRANGE;
BEGIN
  v_duration := COALESCE(NEW.duration_minutes, 30);
  v_range := tstzrange(
    NEW.appointment_at,
    NEW.appointment_at + (v_duration * interval '1 minute'),
    '[)'
  );

  INSERT INTO public.appointment_slot_locks
    (tenant_id, doctor_id, appointment_id, slot_range)
  VALUES (NEW.tenant_id, NEW.doctor_id, NEW.id, v_range);

  RETURN NEW;
EXCEPTION WHEN exclusion_violation THEN
  -- Mensagem usa SQLSTATE 23P01 — handler na API mapeia para 409.
  RAISE EXCEPTION USING
    MESSAGE = format('APPOINTMENT_CONFLICT: doctor=%s slot=%s', NEW.doctor_id, v_range),
    ERRCODE = '23P01';
END $$;

CREATE TRIGGER appointments_create_slot_lock
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.create_slot_lock_on_appointment();

-- Trigger: ao registrar reversal, liberar slot lock
CREATE OR REPLACE FUNCTION public.release_slot_lock_on_reversal()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  DELETE FROM public.appointment_slot_locks
  WHERE appointment_id = NEW.appointment_id;
  RETURN NEW;
END $$;

CREATE TRIGGER appointment_reversals_release_slot_lock
  AFTER INSERT ON public.appointment_reversals
  FOR EACH ROW EXECUTE FUNCTION public.release_slot_lock_on_reversal();
```

## Helper TypeScript

`src/lib/core/appointments/check-conflict.ts`:

```ts
export interface ConflictCheckInput {
  tenantId: string
  doctorId: string
  startAt: Date
  endAt: Date
  excludeAppointmentId?: string // para edição
}

export interface ConflictHit {
  appointmentId: string
  patientName: string
  procedureLabel: string
  startAt: string
  endAt: string
}

export async function checkConflict(
  supabase: SupabaseClient<Database>,
  input: ConflictCheckInput,
): Promise<ConflictHit | null>
```

Implementação consulta `appointment_slot_locks` JOIN com `appointments` e `procedures`, filtrando por `slot_range && tstzrange(start, end, '[)')`. Retorna o primeiro hit ou `null`.

## Endpoint

`GET /api/atendimentos/check-conflict?doctor_id=&start=&end=&exclude_id=`

**Auth**: requer sessão (qualquer papel autenticado pode consultar).

**Resposta 200**:

```json
{ "conflict": false }
```

ou

```json
{
  "conflict": true,
  "with": {
    "appointment_id": "uuid",
    "patient_name": "Maria Silva",
    "procedure_label": "Consulta odontológica",
    "start_at": "2026-05-04T14:00:00-03:00",
    "end_at": "2026-05-04T14:30:00-03:00"
  }
}
```

## Mapeamento de erro 23P01 → HTTP 409

`src/lib/observability/http.ts` (extensão do handler existente):

```ts
if (err.code === '23P01' || /APPOINTMENT_CONFLICT/.test(err.message)) {
  return NextResponse.json(
    {
      error: {
        code: 'APPOINTMENT_CONFLICT',
        message: 'Já existe atendimento para este profissional no horário escolhido.',
        // detalhes vêm de uma SELECT auxiliar antes do INSERT, não do RAISE
      },
    },
    { status: 409 },
  )
}
```

Para enriquecer com nome do paciente conflitante, o handler chama `checkConflict` antes do INSERT (best-effort, race-tolerável; o veto autoritativo continua sendo o do INSERT).

## Cenários de teste

1. **Race**: 50 `Promise.all` POSTs ao `/api/atendimentos/manual` para mesmo doctor + slot → 1 sucesso (200), 49 conflitos (409). 0 erros 500.
2. **Back-to-back**: 14:00–14:30 e 14:30–15:00 com mesmo doctor → ambos OK.
3. **Cross-tenant**: tenant A das 14:00 e tenant B das 14:00 com mesmo doctor_id (impossível na prática — doctor pertence a um tenant) → bloqueado naturalmente porque doctor_id não atravessa tenants.
4. **Estorno + rebooking**: criar 14:00–14:30 → estornar → criar outro 14:00–14:30 mesmo doctor → sucesso.
5. **Diferentes doctors mesmo slot**: Dra. Aline 14:00 e Dr. Bruno 14:00 → ambos OK.
