/**
 * Feature 017 — Tela de sucesso pós-agendamento.
 *
 * Server component que valida token (read-only — NÃO marca como usado)
 * e exibe resumo. Placeholder "Adicionar ao Calendar" entra em US5.
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import { hashToken } from '@/lib/core/public-booking/tokens'
import { AddToCalendarButtons } from '@/components/public-booking/add-to-calendar-buttons'

export const dynamic = 'force-dynamic'

function formatBrasilia(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

export default async function SucessoPage({ params }: { params: { slug: string; token: string } }) {
  const supabase = createSupabaseServiceClient()
  const tenant = await resolveTenantBySlug(supabase, params.slug)
  if (!tenant) notFound()

  const tokenHash = hashToken(params.token)
  const { data: tokenRow } = await supabase
    .from('public_booking_tokens')
    .select('appointment_id, action, expires_at, used_at')
    .eq('tenant_id', tenant.tenantId)
    .eq('token_hash', tokenHash)
    .eq('action', 'cancel')
    .maybeSingle()

  if (!tokenRow) notFound()

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, appointment_at, duration_minutes, doctor_id, procedure_id')
    .eq('id', tokenRow.appointment_id)
    .eq('tenant_id', tenant.tenantId)
    .maybeSingle()

  if (!appt) notFound()

  // Nomes do medico e do procedimento — usados no resumo + no evento de
  // calendario. Falhas sao tolerantes: a tela ainda renderiza, mas o evento
  // do calendar fica com "—" no lugar do nome.
  const [doctorRes, procRes] = await Promise.all([
    supabase
      .from('doctors')
      .select('full_name')
      .eq('id', appt.doctor_id)
      .eq('tenant_id', tenant.tenantId)
      .maybeSingle(),
    supabase
      .from('procedures')
      .select('display_name, tuss_code')
      .eq('id', appt.procedure_id)
      .eq('tenant_id', tenant.tenantId)
      .maybeSingle(),
  ])
  const doctorName = (doctorRes.data?.full_name as string | undefined) ?? '—'
  const procedureName =
    (procRes.data?.display_name as string | null | undefined) ??
    (procRes.data?.tuss_code as string | null | undefined) ??
    'Consulta'
  const durationMinutes = appt.duration_minutes ?? 30

  const cancelHref = `/agendar/${params.slug}/cancelar/${params.token}`

  // Descricao formatada para o evento no Google Calendar / .ics.
  // Inclui procedimento, profissional, contato e endereco da clinica.
  const eventDescription = [
    `Atendimento: ${procedureName}`,
    `Profissional: Dr(a). ${doctorName}`,
    `Clínica: ${tenant.displayName}`,
    tenant.phone ? `Telefone: ${tenant.phone}` : null,
    tenant.addressLine ? `Endereço: ${tenant.addressLine}` : null,
    '',
    'Em caso de imprevisto, cancele com antecedência pelo link enviado no e-mail de confirmação.',
  ]
    .filter((line) => line !== null)
    .join('\n')

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-success/30 bg-success-bg p-6 text-center">
        <h1 className="text-2xl font-bold text-success-strong">Agendamento confirmado!</h1>
        <p className="mt-2 text-sm text-success-text">
          Você receberá um email de confirmação em instantes.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 text-sm">
        <div className="font-semibold text-slate-900">{tenant.displayName}</div>
        <div className="mt-2 grid gap-1 text-slate-700">
          <div>
            <span className="text-slate-500">Atendimento:</span> {procedureName}
          </div>
          <div>
            <span className="text-slate-500">Profissional:</span> Dr(a). {doctorName}
          </div>
          <div>
            <span className="text-slate-500">Data e hora:</span>{' '}
            {formatBrasilia(appt.appointment_at)}
          </div>
          {tenant.addressLine && (
            <div>
              <span className="text-slate-500">Endereço:</span> {tenant.addressLine}
            </div>
          )}
          {tenant.phone && (
            <div>
              <span className="text-slate-500">Contato da clínica:</span> {tenant.phone}
            </div>
          )}
        </div>
      </section>

      <AddToCalendarButtons
        title={`${procedureName} — Dr(a). ${doctorName}`}
        description={eventDescription}
        location={tenant.addressLine ?? tenant.displayName}
        startIso={appt.appointment_at}
        durationMinutes={durationMinutes}
        icsDownloadUrl={`/api/public/booking/${params.slug}/ics/${params.token}`}
      />

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link
          href={cancelHref}
          className="flex-1 rounded-md border border-destructive/30 px-4 py-2 text-center text-sm font-medium text-destructive hover:bg-destructive/5"
        >
          Cancelar agendamento
        </Link>
        <Link
          href={`/agendar/${params.slug}`}
          className="flex-1 rounded-md border border-border px-4 py-2 text-center text-sm font-medium text-slate-700 hover:bg-muted"
        >
          Agendar outro horário
        </Link>
      </div>
    </div>
  )
}
