/**
 * Cliente HTTP do Asaas (API v3) — cápsula da cobrança da PLATAFORMA.
 *
 * SEGURANÇA
 * - `ASAAS_API_KEY` é segredo de plataforma: é a chave da conta que RECEBE das
 *   clínicas. Este arquivo é o único autorizado a lê-la, no mesmo espírito da
 *   cápsula `integrations/ghl/oauth/`. Nada fora daqui monta header do Asaas.
 * - Nenhuma função deste arquivo loga a chave, o corpo cru da resposta (que
 *   ecoa CPF/CNPJ do cliente) nem payload de PIX.
 *
 * A URL base é env-overridável (`ASAAS_API_URL`) de propósito: o Asaas já
 * mudou o host do sandbox uma vez, e trocar host não pode exigir deploy de
 * código.
 */

import { logger } from '@/lib/observability/logger'
import { centsToReais } from './money'
import type {
  AsaasBillingType,
  AsaasCustomer,
  AsaasCycle,
  AsaasEnvironment,
  AsaasPayment,
  AsaasPixQrCode,
  AsaasSplit,
  AsaasSubscription,
} from './types'

const TIMEOUT_MS = 20_000

const DEFAULT_URL: Record<AsaasEnvironment, string> = {
  production: 'https://api.asaas.com/v3',
  sandbox: 'https://api-sandbox.asaas.com/v3',
}

export function asaasEnvironment(): AsaasEnvironment {
  return process.env.ASAAS_ENV === 'production' ? 'production' : 'sandbox'
}

/**
 * Está configurado? Usado pela UI para mostrar "não conectado" em vez de
 * quebrar, e pelos testes para pular o que depende de rede.
 */
export function isAsaasConfigured(): boolean {
  return Boolean(process.env.ASAAS_API_KEY)
}

function baseUrl(): string {
  const override = process.env.ASAAS_API_URL
  const url = override && override.trim() ? override : DEFAULT_URL[asaasEnvironment()]
  return url.replace(/\/+$/, '')
}

function apiKey(): string {
  const key = process.env.ASAAS_API_KEY
  if (!key) throw new Error('ASAAS_API_KEY is required to reach Asaas')
  return key
}

/** Erro de negócio devolvido pelo Asaas (lista `errors[]` com code/description). */
export class AsaasError extends Error {
  readonly status: number
  readonly code: string | null
  constructor(message: string, status: number, code: string | null) {
    super(message)
    this.name = 'AsaasError'
    this.status = status
    this.code = code
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey(),
      // O Asaas usa isto para identificar a integração no suporte deles.
      'User-Agent': 'Clinni',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  })

  const body = (await res.json().catch(() => null)) as unknown

  if (!res.ok) {
    const errs = (body as { errors?: Array<{ code?: string; description?: string }> } | null)
      ?.errors
    const first = errs?.[0]
    // Logamos rota e status, nunca o corpo: ele ecoa CPF/CNPJ e dados de conta.
    logger.error(
      { path, status: res.status, asaas_code: first?.code ?? null },
      'asaas-request-failed',
    )
    throw new AsaasError(
      first?.description ?? `Asaas respondeu ${res.status}`,
      res.status,
      first?.code ?? null,
    )
  }
  return body as T
}

// =========================================================================
// Clientes
// =========================================================================

export interface UpsertCustomerInput {
  /** `tenants.id` — é por ele que reencontramos o cliente, não pelo nome. */
  externalReference: string
  name: string
  /** CNPJ da clínica (só dígitos). O Asaas exige documento válido. */
  cpfCnpj: string
  email?: string | null
  mobilePhone?: string | null
}

/**
 * Busca o cliente pelo nosso `tenants.id`. `null` = ainda não existe lá.
 *
 * A busca é por `externalReference` e não por CNPJ porque o CNPJ pode ser
 * corrigido no cadastro da clínica; o uuid não muda nunca.
 */
export async function findCustomerByExternalRef(ref: string): Promise<AsaasCustomer | null> {
  const res = await call<{ data?: AsaasCustomer[] }>(
    `/customers?externalReference=${encodeURIComponent(ref)}&limit=1`,
  )
  return res.data?.[0] ?? null
}

export async function createCustomer(input: UpsertCustomerInput): Promise<AsaasCustomer> {
  return call<AsaasCustomer>('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      cpfCnpj: input.cpfCnpj,
      email: input.email ?? undefined,
      mobilePhone: input.mobilePhone ?? undefined,
      externalReference: input.externalReference,
      notificationDisabled: false,
    }),
  })
}

export async function updateCustomer(
  customerId: string,
  input: Partial<UpsertCustomerInput>,
): Promise<AsaasCustomer> {
  return call<AsaasCustomer>(`/customers/${encodeURIComponent(customerId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: input.name,
      cpfCnpj: input.cpfCnpj,
      email: input.email ?? undefined,
      mobilePhone: input.mobilePhone ?? undefined,
    }),
  })
}

// =========================================================================
// Assinaturas
// =========================================================================

export interface CreateSubscriptionInput {
  customerId: string
  amountCents: number
  cycle: AsaasCycle
  billingType: AsaasBillingType
  /** YYYY-MM-DD — primeira cobrança. */
  nextDueDate: string
  description: string
  /** `tenants.id`, para o webhook resolver a clínica sem consultar o banco. */
  externalReference: string
  split?: AsaasSplit[]
}

export async function createSubscription(
  input: CreateSubscriptionInput,
): Promise<AsaasSubscription> {
  return call<AsaasSubscription>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      customer: input.customerId,
      billingType: input.billingType,
      value: centsToReais(input.amountCents),
      nextDueDate: input.nextDueDate,
      cycle: input.cycle,
      description: input.description,
      externalReference: input.externalReference,
      // Array vazio faria o Asaas registrar um split de nada; ausente é ausente.
      split: input.split && input.split.length > 0 ? input.split : undefined,
    }),
  })
}

export interface UpdateSubscriptionInput {
  amountCents?: number
  cycle?: AsaasCycle
  billingType?: AsaasBillingType
  nextDueDate?: string
  description?: string
  split?: AsaasSplit[]
  /**
   * Se `true`, o Asaas reemite as cobranças já geradas e ainda não pagas com o
   * novo valor. Sem isso, uma mudança de plano só valeria no mês seguinte —
   * que às vezes é o que se quer, e por isso a escolha é do chamador.
   */
  updatePendingPayments?: boolean
}

export async function updateSubscription(
  subscriptionId: string,
  input: UpdateSubscriptionInput,
): Promise<AsaasSubscription> {
  return call<AsaasSubscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      value: input.amountCents !== undefined ? centsToReais(input.amountCents) : undefined,
      cycle: input.cycle,
      billingType: input.billingType,
      nextDueDate: input.nextDueDate,
      description: input.description,
      split: input.split,
      updatePendingPayments: input.updatePendingPayments,
    }),
  })
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await call<{ deleted: boolean }>(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
  })
}

/** Cobranças geradas por uma assinatura, mais recentes primeiro. */
export async function listSubscriptionPayments(
  subscriptionId: string,
  limit = 50,
): Promise<AsaasPayment[]> {
  const res = await call<{ data?: AsaasPayment[] }>(
    `/subscriptions/${encodeURIComponent(subscriptionId)}/payments?limit=${limit}`,
  )
  return res.data ?? []
}

// =========================================================================
// Cobranças avulsas e consulta
// =========================================================================

export interface CreatePaymentInput {
  customerId: string
  amountCents: number
  billingType: AsaasBillingType
  /** YYYY-MM-DD */
  dueDate: string
  description: string
  externalReference: string
  split?: AsaasSplit[]
}

export async function createPayment(input: CreatePaymentInput): Promise<AsaasPayment> {
  return call<AsaasPayment>('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: input.customerId,
      billingType: input.billingType,
      value: centsToReais(input.amountCents),
      dueDate: input.dueDate,
      description: input.description,
      externalReference: input.externalReference,
      split: input.split && input.split.length > 0 ? input.split : undefined,
    }),
  })
}

export async function getPayment(paymentId: string): Promise<AsaasPayment> {
  return call<AsaasPayment>(`/payments/${encodeURIComponent(paymentId)}`)
}

/**
 * QR do PIX de uma cobrança. Buscado sob demanda e nunca persistido: o payload
 * tem validade e guardar código de pagamento em banco é passivo sem ganho.
 */
export async function getPixQrCode(paymentId: string): Promise<AsaasPixQrCode> {
  return call<AsaasPixQrCode>(`/payments/${encodeURIComponent(paymentId)}/pixQrCode`)
}

/** Estorna uma cobrança já paga. */
export async function refundPayment(paymentId: string): Promise<AsaasPayment> {
  return call<AsaasPayment>(`/payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST' })
}
