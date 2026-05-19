/**
 * Feature 017 — Envia confirmação ao paciente + admins após booking público.
 *
 * Fire-and-forget: erros aqui NÃO falham a request HTTP — o appointment
 * já foi persistido. Logamos via pino para observability.
 *
 * Envia 3 coisas:
 *   1. Email para o paciente (com .ics anexado, link cancelar)
 *   2. Email para cada admin ativo do tenant
 *   3. INSERT em `notifications` (type='public_booking') para cada admin
 *      → aparece no sino do dashboard
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { sendBookingEmail } from '@/lib/integrations/email/resend-client'
import {
  renderAdminBookingHtml,
  renderPatientBookingHtml,
} from '@/lib/integrations/email/booking-template'
import { generateBookingIcs } from '@/lib/utils/ics'

export interface SendBookingConfirmationsInput {
  supabase: SupabaseClient<Database>
  tenantId: string
  tenantDisplayName: string
  tenantPhone: string | null
  tenantAddress: string | null
  appointmentId: string
  patientName: string
  patientEmail: string
  doctorName: string
  procedureName: string
  scheduledAt: Date
  durationMinutes: number
  /** URL absoluta de cancelamento com token raw (`/agendar/[slug]/cancelar/[token]`) */
  cancelUrl: string
  /** URL absoluta para o admin abrir o appointment no dashboard. */
  dashboardUrl: string
}

export async function sendBookingConfirmations(
  input: SendBookingConfirmationsInput,
): Promise<void> {
  const settled = await Promise.allSettled([
    sendPatientEmail(input),
    sendAdminEmails(input),
    createBellNotifications(input),
  ])
  for (const s of settled) {
    if (s.status === 'rejected') {
      logger.warn(
        { tenantId: input.tenantId, appointmentId: input.appointmentId, err: s.reason },
        'public-booking-confirmation-step-failed',
      )
    }
  }
}

async function sendPatientEmail(input: SendBookingConfirmationsInput): Promise<void> {
  if (!input.patientEmail) return

  let icsContent: string | null = null
  try {
    icsContent = generateBookingIcs({
      uid: input.appointmentId,
      title: `${input.procedureName} — ${input.tenantDisplayName}`,
      description: `Agendamento confirmado.\nProfissional: ${input.doctorName}\nClínica: ${input.tenantDisplayName}`,
      location: input.tenantAddress ?? input.tenantDisplayName,
      startIso: input.scheduledAt.toISOString(),
      durationMinutes: input.durationMinutes,
      organizer: {
        name: input.tenantDisplayName,
        email: process.env.RESEND_FROM ?? 'agendamentos@dev.prontool.io',
      },
    })
  } catch (err) {
    logger.warn({ err, appointmentId: input.appointmentId }, 'ics-generation-failed')
  }

  const html = renderPatientBookingHtml({
    patientName: input.patientName,
    clinicName: input.tenantDisplayName,
    clinicPhone: input.tenantPhone,
    clinicAddress: input.tenantAddress,
    doctorName: input.doctorName,
    procedureName: input.procedureName,
    scheduledAt: input.scheduledAt,
    timezoneLabel: 'horário de Brasília',
    cancelUrl: input.cancelUrl,
  })

  await sendBookingEmail({
    tenantId: input.tenantId,
    to: input.patientEmail,
    subject: `Agendamento confirmado — ${input.tenantDisplayName}`,
    html,
    attachments: icsContent
      ? [{ filename: 'consulta.ics', content: icsContent }]
      : undefined,
  })
}

async function sendAdminEmails(input: SendBookingConfirmationsInput): Promise<void> {
  const admins = await listAdmins(input.supabase, input.tenantId)
  if (admins.length === 0) return

  const html = renderAdminBookingHtml({
    clinicName: input.tenantDisplayName,
    patientName: input.patientName,
    doctorName: input.doctorName,
    procedureName: input.procedureName,
    scheduledAt: input.scheduledAt,
    dashboardUrl: input.dashboardUrl,
  })

  // 1 email por admin (sem CC para preservar privacidade entre clínicas
  // que compartilham email de admin).
  await Promise.allSettled(
    admins.map((a) =>
      sendBookingEmail({
        tenantId: input.tenantId,
        to: a.email,
        subject: `Novo agendamento online — ${input.tenantDisplayName}`,
        html,
      }),
    ),
  )
}

async function createBellNotifications(
  input: SendBookingConfirmationsInput,
): Promise<void> {
  const admins = await listAdmins(input.supabase, input.tenantId)
  if (admins.length === 0) return

  const rows = admins.map((a) => ({
    tenant_id: input.tenantId,
    user_id: a.userId,
    type: 'public_booking' as const,
    title: 'Novo agendamento online',
    body: `${input.patientName} agendou ${input.procedureName} com ${input.doctorName}`,
    reference_id: input.appointmentId,
    reference_type: 'appointment',
    reference_key: input.appointmentId,
  }))

  // ON CONFLICT DO NOTHING via reference_key UNIQUE (já existente).
  const { error } = await input.supabase
    .from('notifications')
    .upsert(rows as never, {
      onConflict: 'tenant_id,user_id,type,reference_key',
      ignoreDuplicates: true,
    })
  if (error) {
    logger.warn(
      { err: error, tenantId: input.tenantId, appointmentId: input.appointmentId },
      'public-booking-bell-notification-failed',
    )
  }
}

interface AdminContact {
  userId: string
  email: string
}

async function listAdmins(
  supabase: SupabaseClient<Database>,
  tenantId: string,
): Promise<AdminContact[]> {
  const { data: ut, error: utError } = await supabase
    .from('user_tenants')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('role', 'admin')
    .eq('status', 'active')
  if (utError || !ut) return []

  const adminUserIds = (ut as Array<{ user_id: string }>).map((r) => r.user_id)
  if (adminUserIds.length === 0) return []

  // auth.users só acessível via service-role (caller já deve estar passando
  // service-role client — public-booking sempre roda nesse modo).
  // Usar Supabase auth admin API se disponível, ou via raw SQL.
  // Aqui usamos um raw fetch via from('auth.users') — pode falhar se schema
  // não estiver exposto. Best-effort.
  const contacts: AdminContact[] = []
  type AuthAdmin = {
    getUserById: (id: string) => Promise<{
      data: { user: { email: string | null } | null }
    }>
  }
  for (const userId of adminUserIds) {
    try {
      const client = supabase as unknown as { auth?: { admin?: AuthAdmin } }
      const authAdmin = client.auth?.admin
      if (authAdmin?.getUserById) {
        const { data: u } = await authAdmin.getUserById(userId)
        const email = u?.user?.email
        if (email) contacts.push({ userId, email })
      }
    } catch {
      // ignore
    }
  }
  return contacts
}
