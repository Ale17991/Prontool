/**
 * Feature 017 — Tela de cancelamento (paciente clica link no email).
 *
 * Server component que faz lookup read-only do token (não marca como
 * usado). Mostra resumo + botão "Confirmar cancelamento" + telefone da
 * clínica caso fora da janela.
 */

import { notFound } from 'next/navigation'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import { hashToken } from '@/lib/core/public-booking/tokens'
import { CancelForm } from '@/components/public-booking/cancel-form'

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

export default async function CancelarPage({
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
    .select('appointment_id, used_at, expires_at, action')
    .eq('tenant_id', tenant.tenantId)
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (!tokenRow || tokenRow.action !== 'cancel') notFound()

  const expired = new Date(tokenRow.expires_at).getTime() < Date.now()
  const used = !!tokenRow.used_at

  const { data: appt } = await supabase
    .from('appointments')
    .select('appointment_at')
    .eq('id', tokenRow.appointment_id)
    .eq('tenant_id', tenant.tenantId)
    .maybeSingle()

  if (!appt) notFound()

  const scheduledAt = appt.appointment_at as string
  const cancelMinHours = tenant.cancelMinHours
  const minNoticeMs = cancelMinHours * 60 * 60 * 1000
  const tooLate = new Date(scheduledAt).getTime() - Date.now() < minNoticeMs

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Cancelar agendamento</h1>

      <section className="rounded-lg border border-border bg-card p-4 text-sm">
        <div className="font-semibold text-slate-900">{tenant.displayName}</div>
        <div className="mt-2 text-slate-700">
          Consulta marcada para <strong>{formatBrasilia(scheduledAt)}</strong>.
        </div>
      </section>

      {used ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-sm">
          Este link já foi utilizado. Se você precisa cancelar novamente, entre em contato com a
          clínica.
        </div>
      ) : expired ? (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-4 text-sm">
          Este link expirou. Entre em contato com a clínica para cancelar.
        </div>
      ) : tooLate ? (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-semibold text-destructive">Cancelamento online indisponível</p>
          <p className="text-slate-700">
            Cancelamento online disponível até {cancelMinHours}h antes da consulta. Entre em contato
            com a clínica:
          </p>
          {tenant.phone && (
            <p className="text-slate-900">
              Telefone: <strong>{tenant.phone}</strong>
            </p>
          )}
        </div>
      ) : (
        <CancelForm slug={params.slug} token={params.token} />
      )}
    </div>
  )
}
