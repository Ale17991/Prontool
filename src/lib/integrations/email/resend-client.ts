import { Resend } from 'resend'
import { logger } from '@/lib/observability/logger'
import { resolvePublicBaseUrl } from '@/lib/core/app-url'

let resendSingleton: Resend | null = null

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

function getResend(key: string): Resend {
  if (resendSingleton) return resendSingleton
  resendSingleton = new Resend(key)
  return resendSingleton
}

export interface AlertEmailInput {
  tenantId: string
  to: string[]
  subject: string
  /**
   * Markdown-ish safe summary. MUST NOT contain PII. Patient references
   * use internal identifiers; the recipient follows the dashboard link to
   * see details behind authentication.
   */
  bodyMarkdown: string
  dashboardUrl: string
}

export async function sendAlertEmail(input: AlertEmailInput): Promise<{ id: string | null }> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    logger.warn(
      { tenantId: input.tenantId, subject: input.subject },
      'resend-not-configured-skipping-email',
    )
    return { id: null }
  }

  const from = process.env.RESEND_FROM ?? 'alertas@dev.clinnipro.io'
  const appUrl = resolvePublicBaseUrl()

  const html = renderAlertHtml({
    subject: input.subject,
    bodyMarkdown: input.bodyMarkdown,
    dashboardUrl: new URL(input.dashboardUrl, appUrl).toString(),
  })

  try {
    const res = await getResend(key).emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html,
    })
    return { id: res.data?.id ?? null }
  } catch (err) {
    logger.error({ err, tenantId: input.tenantId, subject: input.subject }, 'resend-send-failed')
    throw err
  }
}

// =========================================================================
// Feature 017 — Emails de booking público (paciente + admin)
// =========================================================================

export interface SendBookingEmailInput {
  tenantId: string
  to: string
  subject: string
  html: string
  attachments?: Array<{
    filename: string
    /** Conteúdo bruto (string utf-8 ou base64). */
    content: string
  }>
}

/**
 * Envia email com suporte a attachments. Usado pelo fluxo de booking
 * público (anexa .ics no email do paciente). Em ambiente sem RESEND_API_KEY
 * registra warning e retorna { id: null } — não joga.
 */
export async function sendBookingEmail(
  input: SendBookingEmailInput,
): Promise<{ id: string | null }> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    logger.warn(
      { tenantId: input.tenantId, subject: input.subject },
      'resend-not-configured-skipping-booking-email',
    )
    return { id: null }
  }

  const from = process.env.RESEND_FROM ?? 'agendamentos@dev.clinnipro.io'

  try {
    const res = await getResend(key).emails.send({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    })
    return { id: res.data?.id ?? null }
  } catch (err) {
    logger.error(
      { err, tenantId: input.tenantId, subject: input.subject },
      'resend-send-booking-failed',
    )
    // Não joga — emails são fire-and-forget no fluxo de booking.
    return { id: null }
  }
}

// =========================================================================
// Redefinição de senha (self-service) — o único e-mail transacional que sai
// do endereço de "não responda". Os demais (alertas, agendamento, suporte)
// são conversas em que responder faz sentido; este é o oposto: quem recebe
// não deve responder, e o endereço diz isso antes de o texto explicar.
// =========================================================================

export interface SendPasswordResetEmailInput {
  to: string
  /** Link de recuperação do Supabase (`generateLink`), já com o redirectTo. */
  actionLink: string
}

/**
 * Remetente próprio, separado do `RESEND_FROM` dos alertas: o padrão de
 * fábrica dos outros envios aponta para o domínio de desenvolvimento, e um
 * e-mail de recuperação de senha saindo de `dev.` é exatamente o que treina o
 * usuário a ignorar aviso de segurança — ou o provedor a marcar como phishing.
 */
function passwordResetFrom(): string {
  return process.env.RESEND_FROM_NOREPLY ?? 'nao-responda@clinnipro.com.br'
}

export async function sendPasswordResetEmail(
  input: SendPasswordResetEmailInput,
): Promise<{ id: string | null; detail?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    logger.warn({}, 'resend-not-configured-skipping-password-reset-email')
    return { id: null, detail: 'RESEND_API_KEY ausente no runtime' }
  }

  try {
    const from = passwordResetFrom()
    const res = await getResend(key).emails.send({
      from,
      to: [input.to],
      subject: 'Redefinição de senha — Clinni',
      html: renderPasswordResetHtml(input.actionLink),
      text: renderPasswordResetText(input.actionLink),
    })
    // O SDK do Resend NÃO lança em erro de API — devolve `{ data, error }`. Sem
    // olhar `res.error` aqui, uma recusa (domínio não verificado, chave sem
    // permissão de envio, remetente inválido) sumia sem deixar rastro: o
    // chamador só via `id: null` e registrava "nao enviado", sem o porquê. Foi
    // exatamente esse silêncio que travou o diagnóstico em 19/08.
    if (res.error) {
      logger.error(
        { name: res.error.name, message: res.error.message, from },
        'resend-recusou-password-reset',
      )
      return {
        id: null,
        detail: `resend recusou (${res.error.name}): ${res.error.message} [from=${from}]`,
      }
    }
    return { id: res.data?.id ?? null }
  } catch (err) {
    // Só falha de REDE cai aqui (DNS, timeout). Erro de API vem acima.
    // Sem e-mail em log: quem recebeu o link é justamente o dado que este
    // fluxo não deve deixar espalhado. O chamador loga o hash.
    logger.error({ err }, 'resend-send-password-reset-failed')
    return {
      id: null,
      detail: `excecao de rede: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function renderPasswordResetHtml(actionLink: string): string {
  const href = escapeHtml(actionLink)
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 24px auto; padding: 0 16px; color: #0f172a;">
    <h2 style="margin: 0 0 16px; font-size: 20px;">Redefinição de senha</h2>
    <p style="font-size: 14px; line-height: 1.6;">
      Recebemos um pedido para redefinir a senha da sua conta na Clinni.
      Clique no botão abaixo para escolher uma nova senha.
    </p>
    <p style="margin: 24px 0;">
      <a href="${href}" style="background: #003883; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">Criar nova senha</a>
    </p>
    <p style="font-size: 13px; line-height: 1.6; color: #475569;">
      O link vale por tempo limitado e só pode ser usado uma vez.
      <strong>Se você não pediu isso, ignore este e-mail</strong> — sua senha
      atual continua valendo e nada muda.
    </p>
    <p style="font-size: 12px; color: #64748b; line-height: 1.6;">
      Se o botão não funcionar, copie e cole este endereço no navegador:<br />
      <span style="word-break: break-all;">${href}</span>
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
    <p style="color: #94a3b8; font-size: 11px;">
      Esta mensagem foi enviada por um endereço que não recebe respostas.
    </p>
  </body>
</html>`
}

/**
 * Versão em texto puro junto do HTML. Não é capricho: e-mail transacional só
 * com HTML pontua pior em filtro de spam, e o de recuperação de senha é
 * justamente o que não pode cair na caixa de lixo.
 */
function renderPasswordResetText(actionLink: string): string {
  return [
    'Redefinição de senha',
    '',
    'Recebemos um pedido para redefinir a senha da sua conta na Clinni.',
    'Abra o endereço abaixo para escolher uma nova senha:',
    '',
    actionLink,
    '',
    'O link vale por tempo limitado e só pode ser usado uma vez.',
    'Se você não pediu isso, ignore este e-mail — sua senha atual continua valendo.',
    '',
    'Esta mensagem foi enviada por um endereço que não recebe respostas.',
  ].join('\n')
}

/**
 * Convite de novo membro da equipe.
 *
 * Sai pelo mesmo remetente e pelo mesmo caminho da redefinição de senha, e não
 * mais pelo `inviteUserByEmail` do Supabase. Dois motivos, os dois descobertos
 * em produção: o remetente era o padrão do Supabase (não o da clínica), e o
 * `redirectTo` apontava para `/welcome` — uma rota que NÃO EXISTE neste app e
 * que o middleware nem libera. Ou seja, o convidado recebia de um endereço
 * estranho um link que terminava em 404.
 */
export async function sendInviteEmail(
  input: SendPasswordResetEmailInput,
): Promise<{ id: string | null; detail?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    logger.warn({}, 'resend-not-configured-skipping-invite-email')
    return { id: null, detail: 'RESEND_API_KEY ausente no runtime' }
  }

  try {
    const from = passwordResetFrom()
    const res = await getResend(key).emails.send({
      from,
      to: [input.to],
      subject: 'Seu acesso à Clinni',
      html: renderInviteHtml(input.actionLink),
      text: renderInviteText(input.actionLink),
    })
    if (res.error) {
      logger.error(
        { name: res.error.name, message: res.error.message, from },
        'resend-recusou-convite',
      )
      return { id: null, detail: `resend recusou (${res.error.name}): ${res.error.message}` }
    }
    return { id: res.data?.id ?? null }
  } catch (err) {
    logger.error({ err }, 'resend-send-invite-failed')
    return {
      id: null,
      detail: `excecao de rede: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

function renderInviteHtml(actionLink: string): string {
  const href = escapeHtml(actionLink)
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 24px auto; padding: 0 16px; color: #0f172a;">
    <h2 style="margin: 0 0 16px; font-size: 20px;">Seu acesso à Clinni</h2>
    <p style="font-size: 14px; line-height: 1.6;">
      Uma clínica criou um acesso para você no sistema Clinni. Para entrar pela
      primeira vez, escolha uma senha.
    </p>
    <p style="margin: 24px 0;">
      <a href="${href}" style="background: #003883; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 14px;">Definir minha senha</a>
    </p>
    <p style="font-size: 13px; line-height: 1.6; color: #475569;">
      O link vale por tempo limitado e só pode ser usado uma vez.
      <strong>Se você não esperava este convite, ignore este e-mail</strong> —
      sem definir a senha, o acesso não é ativado.
    </p>
    <p style="font-size: 12px; color: #64748b; line-height: 1.6;">
      Se o botão não funcionar, copie e cole este endereço no navegador:<br />
      <span style="word-break: break-all;">${href}</span>
    </p>
    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
    <p style="color: #94a3b8; font-size: 11px;">
      Esta mensagem foi enviada por um endereço que não recebe respostas.
    </p>
  </body>
</html>`
}

function renderInviteText(actionLink: string): string {
  return [
    'Seu acesso à Clinni',
    '',
    'Uma clínica criou um acesso para você no sistema Clinni.',
    'Para entrar pela primeira vez, escolha uma senha:',
    '',
    actionLink,
    '',
    'O link vale por tempo limitado e só pode ser usado uma vez.',
    'Se você não esperava este convite, ignore este e-mail.',
    '',
    'Esta mensagem foi enviada por um endereço que não recebe respostas.',
  ].join('\n')
}

// =========================================================================
// Tickets de suporte (bug/sugestao/suporte) — enviados pelos usuarios via
// botao na sidebar. Destino: operations@homio.com.br (ou SUPPORT_TICKETS_TO
// em env). Carrega contexto pra triagem (origem, role, page_url, user-agent).
// =========================================================================

export interface SendSupportTicketEmailInput {
  ticketId: string
  tenantId: string
  tenantName: string | null
  userEmail: string | null
  userRole: string | null
  kind: 'bug' | 'suggestion' | 'support'
  title: string
  description: string
  pageUrl: string | null
  userAgent: string | null
  subject: string
}

export async function sendSupportTicketEmail(
  input: SendSupportTicketEmailInput,
): Promise<{ id: string | null }> {
  const key = process.env.RESEND_API_KEY
  if (!key) {
    logger.warn(
      { ticket_id: input.ticketId, tenant_id: input.tenantId },
      'resend-not-configured-skipping-support-ticket-email',
    )
    return { id: null }
  }

  const from = process.env.RESEND_FROM ?? 'alertas@dev.prontool.io'
  const to = (process.env.SUPPORT_TICKETS_TO ?? 'operations@homio.com.br')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const html = renderSupportTicketHtml(input)

  try {
    const res = await getResend(key).emails.send({
      from,
      to,
      subject: input.subject,
      html,
      reply_to: input.userEmail ?? undefined,
    })
    return { id: res.data?.id ?? null }
  } catch (err) {
    logger.error(
      { err, ticket_id: input.ticketId, tenant_id: input.tenantId },
      'resend-send-support-ticket-failed',
    )
    return { id: null }
  }
}

function renderSupportTicketHtml(x: SendSupportTicketEmailInput): string {
  const kindLabel =
    x.kind === 'bug' ? 'Bug / Erro' : x.kind === 'suggestion' ? 'Sugestão' : 'Suporte'
  const kindColor = x.kind === 'bug' ? '#b91c1c' : x.kind === 'suggestion' ? '#1d4ed8' : '#15803d'
  const row = (label: string, value: string | null) =>
    value
      ? `<tr><td style="padding: 4px 12px 4px 0; color: #64748b; vertical-align: top;">${escapeHtml(label)}</td><td style="padding: 4px 0; color: #0f172a;">${escapeHtml(value)}</td></tr>`
      : ''
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 720px; margin: 24px auto; padding: 0 16px; color: #0f172a;">
    <div style="display: inline-block; padding: 4px 10px; background: ${kindColor}; color: white; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; border-radius: 999px;">${escapeHtml(kindLabel)}</div>
    <h2 style="margin: 16px 0 8px;">${escapeHtml(x.title)}</h2>
    <table style="font-size: 13px; margin-bottom: 16px;">
      ${row('Tenant', x.tenantName ?? x.tenantId)}
      ${row('Usuário', x.userEmail)}
      ${row('Papel', x.userRole)}
      ${row('Página', x.pageUrl)}
      ${row('User-Agent', x.userAgent)}
      ${row('Ticket ID', x.ticketId)}
    </table>
    <pre style="white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 6px; font-family: inherit; font-size: 13px; border: 1px solid #e2e8f0;">${escapeHtml(x.description)}</pre>
    <p style="color: #94a3b8; font-size: 11px; margin-top: 24px;">Responda a este e-mail para falar diretamente com o usuário (Reply-To configurado).</p>
  </body>
</html>`
}

function renderAlertHtml(x: {
  subject: string
  bodyMarkdown: string
  dashboardUrl: string
}): string {
  // Very deliberate: no dynamic PII-bearing fields rendered here.
  const escaped = escapeHtml(x.bodyMarkdown)
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 640px; margin: 24px auto; padding: 0 16px;">
    <h2 style="color: #b91c1c;">${escapeHtml(x.subject)}</h2>
    <pre style="white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 6px;">${escaped}</pre>
    <p><a href="${escapeHtml(x.dashboardUrl)}" style="background: #003883; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px; display: inline-block;">Abrir no dashboard</a></p>
    <p style="color: #64748b; font-size: 12px;">Este e-mail não contém dados pessoais de pacientes. Os detalhes completos requerem autenticação no dashboard.</p>
  </body>
</html>`
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
