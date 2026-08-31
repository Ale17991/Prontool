'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { superAdminUserId } from '@/lib/auth/platform-admin'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { upsertPartner, type UpsertPartnerInput } from '@/lib/core/billing/partners'
import {
  listApiKeys,
  revokeApiKey,
  type PartnerApiKey,
  type PartnerScope,
} from '@/lib/core/partners/api-keys'
import {
  createCredentialLink,
  validarFaixas,
  type CredentialLink,
} from '@/lib/core/partners/credential-link'
import { originFromHeaders } from '@/lib/core/app-url'
import {
  cancelTenantSubscription,
  saveTenantBilling,
  startOrUpdateSubscription,
  syncSubscriptionCharges,
  type SaveTenantBillingInput,
} from '@/lib/core/billing/subscription'

/**
 * Ações de cobrança da plataforma (feature Asaas).
 *
 * Todas exigem super-admin — é dinheiro da Clinni, não de clínica nenhuma, e o
 * `/admin` inteiro já vive atrás de `requireSuperAdmin` no layout. A checagem é
 * repetida aqui porque server action é endpoint: quem souber o id da action a
 * chama direto, sem passar pelo layout.
 */

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : 'Erro inesperado.' }
}

async function sb(): Promise<{ client: SupabaseClient<Database>; actorId: string } | null> {
  const actorId = await superAdminUserId()
  if (!actorId) return null
  return {
    client: createSupabaseServiceClient() as unknown as SupabaseClient<Database>,
    actorId,
  }
}

/** Cria ou atualiza um parceiro de split (ex.: zee.lu). */
export async function adminSavePartnerAction(input: UpsertPartnerInput): Promise<Result<string>> {
  const ctx = await sb()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    const id = await upsertPartner(ctx.client, ctx.actorId, input)
    revalidatePath('/admin/financeiro')
    return { ok: true, data: id }
  } catch (e) {
    return fail(e)
  }
}

/** Salva a configuração de cobrança de uma clínica (não fala com o Asaas). */
export async function adminSaveTenantBillingAction(
  tenantId: string,
  input: SaveTenantBillingInput,
): Promise<Result> {
  const ctx = await sb()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    await saveTenantBilling(ctx.client, tenantId, input)
    revalidatePath(`/admin/clinicas/${tenantId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

/**
 * Cria a assinatura no Asaas, ou propaga preço/ciclo/split para a existente.
 *
 * `updatePendingPayments` chega da tela porque a escolha é do operador: reemitir
 * uma fatura já enviada ao cliente é decisão comercial, não detalhe técnico.
 */
export async function adminStartSubscriptionAction(
  tenantId: string,
  updatePendingPayments = false,
): Promise<Result<{ subscriptionId: string; amountCents: number; splitCents: number | null }>> {
  const ctx = await sb()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    const res = await startOrUpdateSubscription(ctx.client, tenantId, { updatePendingPayments })
    revalidatePath(`/admin/clinicas/${tenantId}`)
    revalidatePath('/admin/financeiro')
    return {
      ok: true,
      data: {
        subscriptionId: res.subscriptionId,
        amountCents: res.amountCents,
        splitCents: res.splitCents,
      },
    }
  } catch (e) {
    return fail(e)
  }
}

/** Rede de segurança do webhook: relê as faturas no Asaas e reescreve o espelho. */
export async function adminSyncChargesAction(tenantId: string): Promise<Result<number>> {
  const ctx = await sb()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    const n = await syncSubscriptionCharges(ctx.client, tenantId)
    revalidatePath(`/admin/clinicas/${tenantId}`)
    return { ok: true, data: n }
  } catch (e) {
    return fail(e)
  }
}

/** Cancela a assinatura no Asaas. O histórico de faturas permanece. */
export async function adminCancelSubscriptionAction(tenantId: string): Promise<Result> {
  const ctx = await sb()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    await cancelTenantSubscription(ctx.client, tenantId)
    revalidatePath(`/admin/clinicas/${tenantId}`)
    revalidatePath('/admin/financeiro')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// =========================================================================
// Chaves de API de parceiro
// =========================================================================

/**
 * Gera as credenciais do parceiro e devolve o LINK que as entrega.
 *
 * A chave em si NÃO volta para esta tela. O segredo fica cifrado esperando o
 * parceiro abrir o link uma única vez — assim ele não passa pelo WhatsApp de
 * quem opera o /admin, onde ficaria no histórico de dois aparelhos para
 * sempre. Quem gera entrega um endereço; quem usa revela o segredo.
 */
export async function adminGerarCredenciaisAction(input: {
  partnerId: string
  name: string
  scopes: PartnerScope[]
  /** Texto livre do formulário: IPs/CIDR separados por vírgula ou espaço. */
  faixasIp?: string
  /** Validade da chave em dias. 0 ou ausente = sem prazo. */
  validadeDias?: number
  /** Validade do link, em horas. */
  ttlHoras?: number
}): Promise<Result<CredentialLink>> {
  const ctx = await sb()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    const allowedIps = input.faixasIp ? validarFaixas(input.faixasIp) : null
    const keyExpiresAt =
      input.validadeDias && input.validadeDias > 0
        ? new Date(Date.now() + input.validadeDias * 86400000).toISOString()
        : null

    const link = await createCredentialLink(ctx.client, ctx.actorId, {
      partnerId: input.partnerId,
      name: input.name,
      scopes: input.scopes,
      allowedIps,
      keyExpiresAt,
      ttlHoras: input.ttlHoras,
      // Origem REAL da requisição, não `NEXT_PUBLIC_APP_URL`. A env não está
      // garantida no build da Vercel, e sem ela `resolvePublicBaseUrl()` devolve
      // `http://localhost:3000` — o link sairia inútil para o parceiro, e o
      // erro só apareceria do lado dele. O domínio que quem gera está usando é
      // o domínio certo por construção.
      baseUrl: originFromHeaders(headers()),
    })
    revalidatePath('/admin/financeiro')
    return { ok: true, data: link }
  } catch (e) {
    return fail(e)
  }
}

export async function adminListPartnerKeysAction(
  partnerId: string,
): Promise<Result<PartnerApiKey[]>> {
  const ctx = await sb()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    return { ok: true, data: await listApiKeys(ctx.client, partnerId) }
  } catch (e) {
    return fail(e)
  }
}

export async function adminRevokePartnerKeyAction(keyId: string, reason?: string): Promise<Result> {
  const ctx = await sb()
  if (!ctx) return { ok: false, error: 'Não autorizado.' }
  try {
    await revokeApiKey(ctx.client, ctx.actorId, keyId, reason)
    revalidatePath('/admin/financeiro')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}
