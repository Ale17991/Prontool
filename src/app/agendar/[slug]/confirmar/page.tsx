/**
 * Feature 017 — Tela de confirmação (form do paciente + LGPD).
 *
 * Server component que valida query params + resolve nomes (médico,
 * procedimento) para o resumo. Form em si é client component.
 */

import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import {
  listProceduresAnyDoctor,
  listProceduresByDoctor,
  listPublishedDoctors,
} from '@/lib/core/public-booking/list-published'
import { PatientForm } from '@/components/public-booking/patient-form'

export const dynamic = 'force-dynamic'

export default async function ConfirmarPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { doctor_id?: string; procedure_id?: string; slot_start?: string }
}) {
  const { doctor_id, procedure_id, slot_start } = searchParams
  if (!doctor_id || !procedure_id || !slot_start) {
    redirect(`/agendar/${params.slug}`)
  }

  const supabase = createSupabaseServiceClient()
  const tenant = await resolveTenantBySlug(supabase, params.slug)
  if (!tenant) notFound()

  let doctorName: string
  let procedureName: string

  if (doctor_id === 'any') {
    const procs = await listProceduresAnyDoctor(supabase, tenant.tenantId)
    const procedure = procs.find((p) => p.procedureId === procedure_id)
    if (!procedure) notFound()
    procedureName = procedure.displayName
    doctorName = 'A definir pela clínica'
  } else {
    const allDoctors = await listPublishedDoctors(supabase, tenant.tenantId)
    const doctor = allDoctors.find((d) => d.doctorId === doctor_id)
    if (!doctor) notFound()
    const procs = await listProceduresByDoctor(supabase, tenant.tenantId, doctor_id)
    const procedure = procs.find((p) => p.procedureId === procedure_id)
    if (!procedure) notFound()
    procedureName = procedure.displayName
    doctorName = doctor.doctorFullName
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <a
          href={`/agendar/${params.slug}/horarios?doctor_id=${doctor_id}&procedure_id=${procedure_id}`}
          className="text-sm text-link underline-offset-2 hover:underline"
        >
          ← Alterar horário
        </a>
        <h1 className="text-2xl font-bold text-slate-900">Confirmar agendamento</h1>
      </header>

      <PatientForm
        slug={params.slug}
        doctorId={doctor_id}
        doctorName={doctorName}
        procedureId={procedure_id}
        procedureName={procedureName}
        slotStart={slot_start}
        clinicName={tenant.displayName}
      />
    </div>
  )
}
