import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { logger } from '@/lib/observability/logger'
import { sendPasswordResetEmail } from '@/lib/integrations/email/resend-client'

/**
 * "Esqueci minha senha" — o caminho público, sem sessão e sem admin.
 *
 * O sistema já sabia redefinir senha por dois caminhos, e nenhum servia a
 * quem está trancado do lado de fora: `/configuracoes/perfil` exige estar
 * logado (é troca de senha, não recuperação), e o botão do `/admin` exige
 * outra pessoa. Faltava o caso mais comum de todos.
 *
 * O e-mail sai por NÓS, via Resend, e não pelo Supabase. `resetPasswordForEmail`
 * (usado no fluxo do admin) é mais curto, mas quem envia é o Supabase, do
 * remetente configurado no projeto — não dá para exigir que saia de
 * `nao-responda@clinnipro.com.br` sem trocar o SMTP do projeto inteiro, o que
 * mexeria também em convite e confirmação de conta. `generateLink` devolve o
 * link sem mandar nada, e aí o envio é nosso: remetente, texto e domínio.
 */

/** 1 hora — a janela vale para as duas contagens. */
const WINDOW_SECONDS = 60 * 60

/**
 * Por CAIXA: quantas vezes o mesmo endereço pode pedir por hora. Três cobre
 * o "não chegou, vou pedir de novo" (que costuma ser o e-mail preso em fila,
 * não perdido) sem transformar a caixa de alguém em alvo.
 */
const MAX_PER_EMAIL = 3

/**
 * Por ORIGEM: teto mais alto porque uma clínica inteira sai pelo mesmo IP —
 * três colegas esquecendo a senha na segunda de manhã é rotina, não ataque.
 * O que este limite corta é a varredura de muitos endereços diferentes.
 */
const MAX_PER_IP = 20

export interface RequestPasswordResetInput {
  supabaseService: SupabaseClient<Database>
  /** Cru, como digitado. A normalização acontece aqui dentro. */
  email: string
  /** IP de origem. Nunca é gravado em claro. */
  ip: string
  /** Origem real da requisição, ex.: `https://app.clinnipro.com.br`. */
  baseUrl: string
}

/**
 * O retorno descreve o que ACONTECEU, para log e teste. Ele não deve virar
 * corpo de resposta: a rota responde a mesma coisa em todos os casos.
 */
export type RequestPasswordResetOutcome =
  | { status: 'sent' }
  /** E-mail não corresponde a nenhuma conta. */
  | { status: 'unknown_email' }
  | { status: 'rate_limited'; scope: 'email' | 'ip'; retryAfterSec: number }
  /** Link gerado, mas o envio falhou (Resend fora, domínio não verificado). */
  | { status: 'send_failed' }

/**
 * Normaliza antes de hashear: `  Ana@Clinica.COM ` e `ana@clinica.com` são a
 * mesma caixa, e sem isso o teto por endereço seria contornável só mudando a
 * caixa alta de uma letra.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/**
 * Hash de contagem — não é armazenamento de credencial, é chave de agregação.
 * O prefixo separa os dois espaços para que um e-mail nunca colida com um IP
 * na mesma coluna caso alguém venha a unificar as consultas.
 */
export function hashPasswordResetSubject(kind: 'email' | 'ip', value: string): string {
  return createHash('sha256').update(`${kind}:${value}`).digest('hex')
}

async function countRecent(
  supabase: SupabaseClient<Database>,
  column: 'email_hash' | 'ip_hash',
  hash: string,
): Promise<{ used: number; oldestMs: number | null }> {
  const since = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString()
  const { data, error } = await supabase
    .from('password_reset_requests')
    .select('created_at')
    .eq(column, hash)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
  if (error) {
    // Mesma escolha do rate-limit do agendamento público: banco fora não pode
    // trancar todo mundo para fora da própria conta. Falha aberto.
    return { used: 0, oldestMs: null }
  }
  const rows = data ?? []
  const first = rows[0]?.created_at
  return { used: rows.length, oldestMs: first ? new Date(first).getTime() : null }
}

function retryAfter(oldestMs: number | null): number {
  if (oldestMs === null) return WINDOW_SECONDS
  const passed = (Date.now() - oldestMs) / 1000
  return Math.max(1, Math.ceil(WINDOW_SECONDS - passed))
}

export async function requestPasswordReset(
  input: RequestPasswordResetInput,
): Promise<RequestPasswordResetOutcome> {
  const email = normalizeEmail(input.email)
  const emailHash = hashPasswordResetSubject('email', email)
  const ipHash = hashPasswordResetSubject('ip', input.ip)

  const byEmail = await countRecent(input.supabaseService, 'email_hash', emailHash)
  if (byEmail.used >= MAX_PER_EMAIL) {
    return { status: 'rate_limited', scope: 'email', retryAfterSec: retryAfter(byEmail.oldestMs) }
  }
  const byIp = await countRecent(input.supabaseService, 'ip_hash', ipHash)
  if (byIp.used >= MAX_PER_IP) {
    return { status: 'rate_limited', scope: 'ip', retryAfterSec: retryAfter(byIp.oldestMs) }
  }

  // Gravado ANTES de saber se a conta existe, e por isso mesmo. Só contar as
  // tentativas bem-sucedidas deixaria a varredura de endereços — que é toda
  // feita de tentativas que dão em nada — inteiramente fora do limite.
  await recordAttempt(input.supabaseService, emailHash, ipHash)

  const redirectTo = `${input.baseUrl.replace(/\/+$/, '')}/redefinir-senha`

  // `generateLink` erra quando o e-mail não existe. Isso NÃO pode mudar a
  // resposta da rota — ver o comentário no handler.
  const { data, error } = await (
    input.supabaseService as unknown as {
      auth: {
        admin: {
          generateLink(args: {
            type: 'recovery'
            email: string
            options?: { redirectTo?: string }
          }): Promise<{
            data: { properties?: { action_link?: string } | null } | null
            error: { message: string } | null
          }>
        }
      }
    }
  ).auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })

  const actionLink = data?.properties?.action_link
  if (error || !actionLink) {
    // Não distinguimos "conta inexistente" de outros erros do generateLink no
    // que sai para fora; no log, sim, porque quem opera precisa saber se é
    // ninguém-com-esse-e-mail ou se o Supabase está recusando.
    logger.info(
      { email_hash: emailHash, reason: error?.message ?? 'no-action-link' },
      'password-reset-link-not-generated',
    )
    return { status: 'unknown_email' }
  }

  const { id } = await sendPasswordResetEmail({ to: email, actionLink })
  if (!id) {
    logger.error({ email_hash: emailHash }, 'password-reset-email-not-sent')
    return { status: 'send_failed' }
  }

  logger.info({ email_hash: emailHash }, 'password-reset-email-sent')
  return { status: 'sent' }
}

/**
 * Insere a tentativa e aproveita para varrer o que já saiu da janela desta
 * mesma caixa. A tabela não tem job de limpeza — e a alternativa (cron só
 * para isso) custa mais que apagar de duas a três linhas no caminho de quem
 * já está esperando um e-mail.
 */
async function recordAttempt(
  supabase: SupabaseClient<Database>,
  emailHash: string,
  ipHash: string,
): Promise<void> {
  const expired = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString()
  const { error } = await supabase
    .from('password_reset_requests')
    .insert({ email_hash: emailHash, ip_hash: ipHash } as never)
  if (error) {
    // Best-effort, como no agendamento público: o contador fica subcontado
    // neste request em vez de derrubar o pedido de quem perdeu a senha.
    logger.warn({ email_hash: emailHash }, 'password-reset-attempt-not-recorded')
    return
  }
  await supabase
    .from('password_reset_requests')
    .delete()
    .eq('email_hash', emailHash)
    .lt('created_at', expired)
}
