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

export default async function SucessoPage({
  params,
}: {
  params: { slug: string; token: string }
}) {
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
    .select('id, appointment_at')
    .eq('id', tokenRow.appointment_id)
    .eq('tenant_id', tenant.tenantId)
    .maybeSingle()

  if (!appt) notFound()

  const cancelHref = `/agendar/${params.slug}/cancelar/${params.token}`

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-success/30 bg-success-bg p-6 text-center">
        <h1 className="text-2xl font-bold text-success-strong">
          Agendamento confirmado!
        </h1>
        <p className="mt-2 text-sm text-success-text">
          Você receberá um email de confirmação em instantes.
        </p>
      </div>

      <section className="rounded-lg border border-border bg-card p-4 text-sm">
        <div className="font-semibold text-slate-900">{tenant.displayName}</div>
        <div className="mt-2 grid gap-1 text-slate-700">
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
        title={`Consulta — ${tenant.displayName}`}
        description={`Agendamento confirmado pela ${tenant.displayName}.`}
        location={tenant.addressLine ?? tenant.displayName}
        startIso={appt.appointment_at}
        durationMinutes={30}
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
