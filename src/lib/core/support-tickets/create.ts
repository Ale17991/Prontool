import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { sendSupportTicketEmail } from '@/lib/integrations/email/resend-client'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { isHomioCrmConfigured, sendTicketToHomioCrm, type CrmStatus } from './crm'
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
  /** Desfecho do envio ao CRM. `sem_config` não é falha. */
  crmStatus: CrmStatus
}

/**
 * support_tickets foi criada na 0109 mas ainda nao foi regerada em
 * `Database` (gen-types depende de Docker local). Mesmo padrao usado em
 * patient-tags/service.ts ate o proximo `pnpm supabase:gen-types`.
 */
type UntypedFrom = (table: string) => ReturnType<SupabaseClient['from']>
function untyped(supabase: SupabaseClient<Database>): { from: UntypedFrom } {
  return supabase as unknown as { from: UntypedFrom }
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
  const insertRes = await untyped(supabase)
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
    throw new Error(`createSupportTicket insert: ${insertRes.error?.message ?? 'no data returned'}`)
  }

  const ticketId = (insertRes.data as { id: string }).id

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

  // CRM da Homio (0218). Best-effort pelo mesmo motivo do e-mail: o ticket já
  // está gravado, e o GHL fora do ar não pode transformar "reclamação
  // registrada" em erro na cara de quem estava pedindo ajuda.
  //
  // Service client, e não o `supabase` recebido: `tenant_crm_contacts` é tabela
  // de plataforma, sem policy para `authenticated`. O INSERT do ticket acima
  // continua passando pela RLS, que é onde ela importa.
  let crmStatus: CrmStatus = 'sem_config'
  if (isHomioCrmConfigured()) {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
    let detail: Record<string, unknown> = {}
    try {
      const clinica = await carregarClinica(service, ctx.tenantId, ctx.tenantName)
      const res = await sendTicketToHomioCrm(service, clinica, {
        ticketId,
        kind: input.kind,
        title: input.title,
        description: input.description,
        pageUrl: input.pageUrl ?? null,
        userEmail: ctx.userEmail,
        userRole: ctx.userRole,
      })
      crmStatus = res.status
      detail = res.detail
    } catch (err) {
      crmStatus = 'erro'
      detail = { erro: err instanceof Error ? err.message : String(err) }
      logger.error(
        { err: detail.erro, ticket_id: ticketId, tenant_id: ctx.tenantId },
        'support-ticket-crm-failed',
      )
    }

    // Grava o desfecho NO TICKET (0219). Sem isto o diagnóstico dependia do log
    // da Vercel, que retém uma janela curta e devolve poucas linhas por
    // requisição — duas causas reais custaram rodadas de deploy só para serem
    // lidas. Falhar aqui não pode desfazer o ticket: só perde o rastro.
    try {
      await untyped(service)
        .from('support_tickets')
        .update({ crm_status: crmStatus, crm_detail: detail })
        .eq('id', ticketId)
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), ticket_id: ticketId },
        'support-ticket-crm-status-save-failed',
      )
    }
  }

  return { id: ticketId, emailDelivered, crmStatus }
}

/**
 * Dados da clínica que acompanham o contato no CRM.
 *
 * Tudo opcional: clínica com cadastro incompleto ainda vira contato — o que
 * falta some do registro, e não impede o lead de existir.
 */
async function carregarClinica(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  tenantName: string | null,
): Promise<{
  tenantId: string
  nome: string
  slug: string | null
  email: string | null
  telefone: string | null
  plano: string | null
  situacao: string | null
}> {
  const [tenant, perfil, ent] = await Promise.all([
    supabase.from('tenants').select('name, slug').eq('id', tenantId).maybeSingle(),
    supabase
      .from('tenant_clinic_profile')
      .select('corporate_name, email, phone')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('tenant_entitlements')
      .select('plan, status')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  const t = tenant.data as { name?: string; slug?: string } | null
  const p = perfil.data as {
    corporate_name?: string | null
    email?: string | null
    phone?: string | null
  } | null
  const e = ent.data as { plan?: string | null; status?: string | null } | null

  return {
    tenantId,
    nome: t?.name ?? tenantName ?? 'Clínica sem nome',
    slug: t?.slug ?? null,
    email: p?.email ?? null,
    telefone: p?.phone ?? null,
    plano: e?.plan ?? null,
    situacao: e?.status ?? null,
  }
}
