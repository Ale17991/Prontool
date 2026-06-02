import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { NotFoundError } from '@/lib/observability/errors'
import { toHttpResponse } from '@/lib/observability/http'
import { listAllergies } from '@/lib/core/patient-medical/allergies'
import { listAppointmentMaterials } from '@/lib/core/appointments/materials'
import { listAppointmentProcedures } from '@/lib/core/appointments/procedures'
import { listAssistantsByAppointment } from '@/lib/core/appointment-assistants/list-by-appointment'
import { getMemedConfigPublic } from '@/lib/core/integrations/memed/get-config-public'
import { doctorHasPrescriberFields } from '@/lib/core/integrations/memed/register-prescriber'

/**
 * GET /api/atendimentos/{id}.
 *
 * Hoje entrega o payload completo necessário tanto pela página standalone
 * quanto pelo painel lateral (feature 025). Inclui:
 *   - Row de `appointments_effective` (com embeds básicos)
 *   - Nome do paciente descriptografado (via service RPC)
 *   - Linhas de procedimento (multi-procedimento, feature 0069)
 *   - Materiais utilizados (feature 0061)
 *   - Alergias do paciente
 *   - Assistentes ativos
 *   - Trilha de auditoria (mantida por back-compat com consumers existentes)
 *
 * Todos os sub-loaders são best-effort (retornam vazio se a migration
 * correspondente ainda não estiver aplicada) — comportamento espelha o da
 * página standalone (`[id]/page.tsx`).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  try {
    const session = await requireRole(
      ['admin', 'financeiro', 'recepcionista', 'profissional_saude'],
      {
        entity: 'appointments',
        entityId: params.id,
        route: `/api/atendimentos/${params.id}`,
        request: req,
      },
    )

    const supabase = createSupabaseServiceClient()

    // 1. Appointment com fallback de colunas opcionais (mesmo padrão da page).
    const appointment = await loadAppointmentDetail(supabase, params.id, session.tenantId)
    if (!appointment) throw new NotFoundError('appointment', params.id)
    const appointmentIdResolved = (appointment.id as string | null) ?? params.id
    const patientIdResolved = appointment.patient_id as string | null

    // 2. Nome do paciente — decrypt via RPC dedicada.
    let patientName = '—'
    let patientAnonymized = false
    const encryptionKey = process.env.PATIENT_DATA_ENCRYPTION_KEY
    if (patientIdResolved && encryptionKey) {
      try {
        const { data } = await supabase.rpc('decrypt_patient_names_for_ids', {
          p_tenant_id: session.tenantId,
          p_patient_ids: [patientIdResolved],
          p_key: encryptionKey,
        })
        type DecryptRow = { id: string; full_name: string | null; anonymized_at: string | null }
        const dec = ((data ?? []) as DecryptRow[])[0]
        if (dec) {
          patientAnonymized = dec.anonymized_at !== null
          patientName = patientAnonymized ? '[anonimizado]' : dec.full_name ?? '—'
        }
      } catch {
        // best-effort
      }
    }

    // 3. Sub-loaders paralelos.
    const [proceduresR, materialsR, allergiesR, assistantsR, auditR] = await Promise.all([
      listAppointmentProcedures(supabase, {
        appointmentId: appointmentIdResolved,
        tenantId: session.tenantId,
      }).catch(() => []),
      listAppointmentMaterials(supabase, {
        appointmentId: appointmentIdResolved,
        tenantId: session.tenantId,
      }).catch(() => []),
      patientIdResolved
        ? listAllergies(supabase, {
            tenantId: session.tenantId,
            patientId: patientIdResolved,
          }).catch(() => [])
        : Promise.resolve([]),
      listAssistantsByAppointment(supabase, {
        tenantId: session.tenantId,
        appointmentId: appointmentIdResolved,
      }).catch(() => ({ active: [], removedCount: 0 })),
      supabase
        .from('audit_log')
        .select('*')
        .eq('tenant_id', session.tenantId)
        .eq('entity', 'appointments')
        .eq('entity_id', params.id)
        .order('timestamp_utc', { ascending: true }),
    ])

    if (auditR.error) {
      throw new Error(`audit history read failed: ${auditR.error.message}`)
    }

    // 4. Prescrição digital (Feature 026): botão só para admin/profissional
    // quando a clínica está conectada e o médico é prescritor registrado.
    const doctorId = appointment.doctor_id as string | null
    let prescriberReady = false
    if (doctorId && (session.role === 'admin' || session.role === 'profissional_saude')) {
      const memed = await getMemedConfigPublic(supabase, session.tenantId).catch(() => null)
      if (memed?.connected) {
        const [{ data: presc }, { data: doc }] = await Promise.all([
          supabase
            .from('memed_prescribers')
            .select('status')
            .eq('tenant_id', session.tenantId)
            .eq('doctor_id', doctorId)
            .maybeSingle(),
          supabase
            .from('doctors')
            .select('cpf, council_name, council_number, council_state, birth_date')
            .eq('tenant_id', session.tenantId)
            .eq('id', doctorId)
            .maybeSingle(),
        ])
        // Registrado E com cadastro ainda completo — se um campo exigido foi
        // removido depois, o prescritor deixa de estar apto.
        prescriberReady =
          (presc as { status?: string } | null)?.status === 'registered' &&
          doctorHasPrescriberFields((doc ?? {}) as Parameters<typeof doctorHasPrescriberFields>[0])
      }
    }

    const { data: prescRows } = await supabase
      .from('prescription_records')
      .select('id, memed_prescription_id, status, issued_at')
      .eq('tenant_id', session.tenantId)
      .eq('appointment_id', appointmentIdResolved)
      .order('issued_at', { ascending: false })

    return NextResponse.json(
      {
        appointment,
        patient: { name: patientName, anonymized: patientAnonymized },
        procedures: proceduresR,
        materials: materialsR,
        allergies: allergiesR,
        assistants: assistantsR.active,
        assistantsRemovedCount: assistantsR.removedCount,
        audit: auditR.data ?? [],
        memed: { prescriberReady },
        prescriptions: prescRows ?? [],
      },
      { status: 200 },
    )
  } catch (err) {
    return toHttpResponse(err, { route: `/api/atendimentos/${params.id}` })
  }
}

/**
 * Carrega o detalhe do atendimento de `appointments_effective` com fallback
 * gracioso para colunas opcionais que podem nao existir em todos os ambientes
 * (`observacoes`, `duration_minutes`). Espelha o `loadAppointmentDetail`
 * da página standalone (`[id]/page.tsx`).
 */
async function loadAppointmentDetail(
  supabase: SupabaseClient<Database>,
  id: string,
  tenantId: string,
): Promise<Record<string, unknown> | null> {
  const baseColumns =
    'id, tenant_id, patient_id, doctor_id, plan_id, appointment_at, ' +
    'frozen_amount_cents, frozen_commission_bps, net_amount_cents, net_commission_cents, ' +
    'effective_status, reversal_id, reversed_at, ' +
    'procedures:procedure_id(tuss_code, display_name), ' +
    'doctors:doctor_id(full_name), ' +
    'health_plans:plan_id(name)'

  const attempts: Array<string> = [
    `${baseColumns}, duration_minutes, observacoes`,
    `${baseColumns}, duration_minutes`,
    `${baseColumns}, observacoes`,
    baseColumns,
  ]

  for (const select of attempts) {
    const result = await supabase
      .from('appointments_effective')
      .select(select)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!result.error) {
      return (result.data as Record<string, unknown> | null) ?? null
    }
    const msg = result.error.message?.toLowerCase() ?? ''
    if (msg.includes('observacoes') || msg.includes('duration_minutes')) {
      continue
    }
    throw new Error(`appointment read failed: ${result.error.message}`)
  }
  throw new Error('appointment read failed: no compatible select')
}
