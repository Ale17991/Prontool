import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { sendSupportTicketEmail } from '@/lib/integrations/email/resend-client'
import { KIND_LABELS, type SupportTicketCreateInput } from './schema'

export interface CreateSupportTicketContext {
  tenantId: string
  userId: string
  userEmail: string | null
  userRole: string | null
  tenantName: string | null
  userAgent: string | null
}

export interface CreateSupportTicketResult {
  id: string
  emailDelivered: boolean
}

/**
 * Insere o ticket em support_tickets (rodando com role authenticated via RLS)
 * e dispara email best-effort para a equipe de operacoes. Falha de email
 * nao bloqueia a criacao do ticket — registro fica no DB de qualquer forma.
 */
export async function createSupportTicket(
  supabase: SupabaseClient<Database>,
  ctx: CreateSupportTicketContext,
  input: SupportTicketCreateInput,
): Promise<CreateSupportTicketResult> {
  const insertRes = await supabase
    .from('support_tickets')
    .insert({
      tenant_id: ctx.tenantId,
      user_id: ctx.userId,
      kind: input.kind,
      title: input.title,
      description: input.description,
      page_url: input.pageUrl ?? null,
      user_agent: ctx.userAgent,
      user_email_cache: ctx.userEmail,
      user_role_cache: ctx.userRole,
    })
    .select('id')
    .single()

  if (insertRes.error || !insertRes.data) {
    throw new Error(
      `createSupportTicket insert: ${insertRes.error?.message ?? 'no data returned'}`,
    )
  }

  const ticketId = insertRes.data.id

  let emailDelivered = false
  try {
    const subject = `[Clinni · ${KIND_LABELS[input.kind]}] ${input.title}`
    const { id: emailId } = await sendSupportTicketEmail({
      ticketId,
      tenantId: ctx.tenantId,
      tenantName: ctx.tenantName,
      userEmail: ctx.userEmail,
      userRole: ctx.userRole,
      kind: input.kind,
      title: input.title,
      description: input.description,
      pageUrl: input.pageUrl ?? null,
      userAgent: ctx.userAgent,
      subject,
    })
    emailDelivered = emailId !== null
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : String(err),
        ticket_id: ticketId,
        tenant_id: ctx.tenantId,
      },
      'support-ticket-email-failed',
    )
  }

  return { id: ticketId, emailDelivered }
}
