/**
 * Feature 017 — Tela de seleção de procedimento + horário.
 *
 * Server component. Recebe ?doctor_id= (e opcional ?procedure_id=).
 * Lista procedures do médico publicado; SlotPicker (client) busca slots
 * via API pública conforme procedure escolhido.
 */

import { notFound, redirect } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import {
  listProceduresAnyDoctor,
  listProceduresByDoctor,
  listPublishedDoctors,
} from '@/lib/core/public-booking/list-published'
import { SlotPicker } from '@/components/public-booking/slot-picker'

export const dynamic = 'force-dynamic'

export default async function HorariosPage({
  params,
  searchParams,
}: {
  params: { slug: string }
  searchParams: { doctor_id?: string; procedure_id?: string }
}) {
  const doctorId = searchParams.doctor_id
  if (!doctorId) redirect(`/agendar/${params.slug}`)

  const supabase = createSupabaseServiceClient()
  const tenant = await resolveTenantBySlug(supabase, params.slug)
  if (!tenant) notFound()

  // Modo "sem preferencia" — sem header de medico, procedures vem do union
  // de todos os medicos publicados.
  if (doctorId === 'any') {
    const procedures = await listProceduresAnyDoctor(supabase, tenant.tenantId)
    return (
      <div className="space-y-6">
        <header className="space-y-1">
          <a
            href={`/agendar/${params.slug}`}
            className="text-sm text-link underline-offset-2 hover:underline"
          >
            ← Voltar
          </a>
          <h1 className="text-2xl font-bold text-slate-900">Sem preferência de profissional</h1>
          <p className="text-sm text-slate-600">
            Escolha o procedimento e o horário. O profissional com melhor disponibilidade na semana
            será atribuído automaticamente.
          </p>
        </header>

        {procedures.length === 0 ? (
          <p className="rounded-md border border-border bg-card p-4 text-sm text-slate-500">
            Nenhum procedimento disponível para agendamento público no momento.
          </p>
        ) : (
          <SlotPicker
            slug={params.slug}
            doctorId="any"
            procedures={procedures.map((p) => ({
              procedureId: p.procedureId,
              displayName: p.displayName,
              durationMinutes: p.durationMinutes,
            }))}
            minHoursAdvance={tenant.minHoursAdvance}
            maxDaysAdvance={tenant.maxDaysAdvance}
            initialProcedureId={searchParams.procedure_id ?? null}
          />
        )}
      </div>
    )
  }

  const allDoctors = await listPublishedDoctors(supabase, tenant.tenantId)
  const doctor = allDoctors.find((d) => d.doctorId === doctorId)
  if (!doctor) notFound()

  const procedures = await listProceduresByDoctor(supabase, tenant.tenantId, doctorId)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <a
          href={`/agendar/${params.slug}`}
          className="text-sm text-link underline-offset-2 hover:underline"
        >
          ← Trocar profissional
        </a>
        <h1 className="text-2xl font-bold text-slate-900">{doctor.doctorFullName}</h1>
      </header>

      {procedures.length === 0 ? (
        <p className="rounded-md border border-border bg-card p-4 text-sm text-slate-500">
          Este profissional não tem procedimentos disponíveis para agendamento público.
        </p>
      ) : (
        <SlotPicker
          slug={params.slug}
          doctorId={doctor.doctorId}
          procedures={procedures.map((p) => ({
            procedureId: p.procedureId,
            displayName: p.displayName,
            durationMinutes: p.durationMinutes,
          }))}
          minHoursAdvance={tenant.minHoursAdvance}
          maxDaysAdvance={tenant.maxDaysAdvance}
          initialProcedureId={searchParams.procedure_id ?? null}
        />
      )}
    </div>
  )
}
