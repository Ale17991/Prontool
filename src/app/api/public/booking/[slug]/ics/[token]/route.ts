/**
 * Feature 017 — GET /api/public/booking/[slug]/ics/[token]
 *
 * Retorna `.ics` (text/calendar) para download. Valida token (read-only:
 * NÃO marca como usado), localiza appointment + dados do tenant, gera o
 * arquivo .ics e retorna como attachment.
 */

import { type NextRequest } from 'next/server'
import { z } from 'zod'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'
import { hashToken } from '@/lib/core/public-booking/tokens'
import { generateBookingIcs } from '@/lib/utils/ics'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,31}$/)

export async function GET(
  _request: NextRequest,
  context: { params: { slug: string; token: string } },
) {
  const slugCheck = SlugSchema.safeParse(context.params.slug)
  if (!slugCheck.success) {
    return new Response('Not found', { status: 404 })
  }

  const supabase = createSupabaseServiceClient()
  const tenant = await resolveTenantBySlug(supabase, slugCheck.data)
  if (!tenant) return new Response('Not found', { status: 404 })

  const tokenHash = hashToken(context.params.token)
  const { data: tokenRow } = await supabase
    .from('public_booking_tokens')
    .select('appointment_id, action, expires_at')
    .eq('tenant_id', tenant.tenantId)
    .eq('token_hash', tokenHash)
    .eq('action', 'cancel')
    .maybeSingle()
  if (!tokenRow) return new Response('Not found', { status: 404 })
  if (new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return new Response('Token expired', { status: 410 })
  }

  const { data: appt } = await supabase
    .from('appointments')
    .select('id, appointment_at, duration_minutes, procedure_id, doctor_id')
    .eq('id', tokenRow.appointment_id)
    .eq('tenant_id', tenant.tenantId)
    .maybeSingle()
  if (!appt) return new Response('Not found', { status: 404 })

  // Buscar nomes para o .ics (best-effort).
  const [procRow, doctorRow] = await Promise.all([
    supabase
      .from('procedures')
      .select('display_name, tuss_code')
      .eq('id', appt.procedure_id)
      .eq('tenant_id', tenant.tenantId)
      .maybeSingle(),
    supabase
      .from('doctors')
      .select('full_name')
      .eq('id', appt.doctor_id)
      .eq('tenant_id', tenant.tenantId)
      .maybeSingle(),
  ])

  const procedureName =
    (procRow.data?.display_name as string | null | undefined) ??
    (procRow.data?.tuss_code as string | null | undefined) ??
    'Consulta'
  const doctorName = (doctorRow.data?.full_name as string | undefined) ?? '—'
  const durationMinutes = appt.duration_minutes ?? 30

  // Descricao alinhada com o evento do Google Calendar (mantem paridade).
  const description = [
    `Atendimento: ${procedureName}`,
    `Profissional: Dr(a). ${doctorName}`,
    `Clínica: ${tenant.displayName}`,
    tenant.phone ? `Telefone: ${tenant.phone}` : null,
    tenant.addressLine ? `Endereço: ${tenant.addressLine}` : null,
    '',
    'Em caso de imprevisto, cancele com antecedência pelo link enviado no e-mail de confirmação.',
  ]
    .filter((line): line is string => line !== null)
    .join('\n')

  let ics: string
  try {
    ics = generateBookingIcs({
      uid: appt.id,
      title: `${procedureName} — Dr(a). ${doctorName}`,
      description,
      location: tenant.addressLine ?? tenant.displayName,
      startIso: appt.appointment_at,
      durationMinutes,
      organizer: {
        name: tenant.displayName,
        email: process.env.RESEND_FROM ?? 'agendamentos@dev.clinnipro.io',
      },
    })
  } catch {
    return new Response('Internal Error', { status: 500 })
  }

  // `inline` permite que iOS/macOS Safari abram direto no Calendar.app em
  // vez de baixar o arquivo. Windows/Android tratam o text/calendar segundo
  // o app default do usuario.
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="consulta.ics"',
    },
  })
}
