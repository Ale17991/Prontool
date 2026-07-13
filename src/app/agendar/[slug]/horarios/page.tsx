/**
 * Feature 017 — Tela de seleção de procedimento + horário.
 *
 * Server component. Recebe ?doctor_id= (e opcional ?procedure_id=).
 * Lista procedures do médico publicado; SlotPicker (client) busca slots
 * via API pública conforme procedure escolhido.
 */

import { notFound, redirect } from 'next/navigation'
import { ChevronLeft, CalendarClock } from 'lucide-react'
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
        <header className="space-y-2">
          <a
            href={`/agendar/${params.slug}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </a>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-black tracking-tight text-foreground sm:text-2xl">
                Sem preferência de profissional
              </h1>
              <p className="text-sm text-muted-foreground">
                Escolha o procedimento e o horário — atribuímos o profissional com melhor
                disponibilidade.
              </p>
            </div>
          </div>
        </header>

        {procedures.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
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
      <header className="space-y-2">
        <a
          href={`/agendar/${params.slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Trocar profissional
        </a>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-gradient-to-br from-[#0AB9C7] to-[#0A6BAA] text-sm font-bold text-white">
            {doctor.doctorFullName
              .trim()
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]!)
              .join('')
              .toUpperCase()}
          </span>
          <div>
            <h1 className="text-xl font-black tracking-tight text-foreground sm:text-2xl">
              {doctor.doctorFullName}
            </h1>
            <p className="text-sm text-muted-foreground">Escolha o procedimento e o horário.</p>
          </div>
        </div>
      </header>

      {procedures.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
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
