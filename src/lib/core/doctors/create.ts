import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, ValidationError } from '@/lib/observability/errors'
import type { PaymentMode } from '@/lib/core/payment-terms/types'

/**
 * Cria um profissional com modalidade de pagamento (feature 013).
 *
 * Para qualquer modalidade, escreve em 3 tabelas (rollback manual em
 * caso de falha):
 *   1. doctors (com `payment_mode`)
 *   2. doctor_commission_history (linha inicial: bps real p/ comissionado;
 *      0 p/ fixo/liberal — preserva o caminho atual de appointment lookup)
 *   3. doctor_payment_terms_history (linha inicial com params especificos
 *      da modalidade)
 *
 * Validacoes:
 *   - CRM non-empty
 *   - external_identifier opcional
 *   - Por modalidade: parametros obrigatorios validados antes do INSERT
 *   - reason >= 3 chars
 */
export interface CreateDoctorInput {
  tenantId: string
  fullName: string
  crm: string
  externalIdentifier?: string | null
  role?: string | null
  specialty?: string | null
  councilName?: string | null
  councilNumber?: string | null
  /** CPF do prescritor (11 dígitos), exigido pela Memed. Opcional no cadastro. */
  cpf?: string | null
  /** UF do conselho (board_state na Memed), 2 letras. Opcional no cadastro. */
  councilState?: string | null
  /** Data de nascimento do prescritor (YYYY-MM-DD), exigida pela Memed. Opcional no cadastro. */
  birthDate?: string | null
  /** CBO (Classificação Brasileira de Ocupações, dom. TISS 24), 6 dígitos. Opcional. */
  cbo?: string | null
  /** Default: 'comissionado' (retrocompat). */
  paymentMode?: PaymentMode
  /** Obrigatorio quando paymentMode = 'comissionado' (ou ausente). */
  initialPercentageBps?: number | null
  /** Obrigatorio quando paymentMode = 'fixo'. */
  monthlyAmountCents?: number | null
  /** Obrigatorio quando paymentMode = 'fixo' (1..28). */
  billingDay?: number | null
  /** Obrigatorio quando paymentMode = 'liberal'. */
  liberalDefaultCents?: number | null
  /** Data efetiva da modalidade inicial (YYYY-MM-DD). */
  initialValidFrom: string
  initialReason: string
  actorUserId: string
}

export interface CreatedDoctor {
  id: string
  fullName: string
  crm: string
  externalIdentifier: string | null
  role: string
  specialty: string | null
  councilName: string | null
  councilNumber: string | null
  active: boolean
  createdAt: string
  paymentMode: PaymentMode
  currentPercentageBps: number | null
  currentMonthlyAmountCents: number | null
  currentBillingDay: number | null
  currentLiberalDefaultCents: number | null
  currentValidFrom: string
  commissionHistoryId: string
  paymentTermsHistoryId: string
}

export async function createDoctor(
  supabase: SupabaseClient<Database>,
  input: CreateDoctorInput,
): Promise<CreatedDoctor> {
  const crm = input.crm.trim()
  if (!crm) throw new ValidationError('CRM obrigatório')
  if (!input.fullName.trim()) throw new ValidationError('Nome completo obrigatório')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.initialValidFrom)) {
    throw new ValidationError('valid_from deve estar no formato YYYY-MM-DD')
  }
  if (input.initialReason.trim().length < 3) {
    throw new ValidationError('Motivo deve ter ao menos 3 caracteres')
  }

  // Validacao por modalidade — replica a logica da RPC mas no app layer
  // pra erros mais bonitos antes do round-trip.
  const paymentMode: PaymentMode = input.paymentMode ?? 'comissionado'
  let commissionBps = 0
  switch (paymentMode) {
    case 'comissionado':
      if (
        input.initialPercentageBps === null ||
        input.initialPercentageBps === undefined ||
        input.initialPercentageBps < 0 ||
        input.initialPercentageBps > 10_000
      ) {
        throw new ValidationError('Comissão deve estar entre 0 e 10000 bps (0%–100%)')
      }
      commissionBps = input.initialPercentageBps
      break
    case 'fixo':
      if (
        input.monthlyAmountCents === null ||
        input.monthlyAmountCents === undefined ||
        input.monthlyAmountCents <= 0
      ) {
        throw new ValidationError('Valor mensal deve ser maior que zero')
      }
      if (
        input.billingDay === null ||
        input.billingDay === undefined ||
        input.billingDay < 1 ||
        input.billingDay > 28
      ) {
        throw new ValidationError('Dia de faturamento deve estar entre 1 e 28')
      }
      commissionBps = 0 // Fixos não recebem comissão variável (Decisão 10).
      break
    case 'liberal':
      if (
        input.liberalDefaultCents === null ||
        input.liberalDefaultCents === undefined ||
        input.liberalDefaultCents <= 0
      ) {
        throw new ValidationError('Valor padrão por participação deve ser maior que zero')
      }
      commissionBps = 0
      break
  }

  const councilNumber = input.councilNumber?.trim() || crm
  const doctorInsert = await supabase
    .from('doctors')
    .insert({
      tenant_id: input.tenantId,
      full_name: input.fullName.trim(),
      crm,
      external_identifier: input.externalIdentifier?.trim() || null,
      role: input.role?.trim() || 'profissional',
      specialty: input.specialty?.trim() || null,
      council_name: input.councilName?.trim() || null,
      council_number: councilNumber,
      cpf: input.cpf?.trim() || null,
      council_state: input.councilState?.trim().toUpperCase() || null,
      birth_date: input.birthDate || null,
      cbo: input.cbo?.trim() || null,
      created_by: input.actorUserId,
      payment_mode: paymentMode,
    } as never)
    .select(
      'id, full_name, crm, external_identifier, role, specialty, council_name, council_number, active, created_at, payment_mode',
    )
    .single()

  if (doctorInsert.error) {
    if (doctorInsert.error.code === '23505') {
      const msg = /external/i.test(doctorInsert.error.message)
        ? `Identificador externo já usado por outro profissional`
        : `Já existe um profissional com o nº de registro ${crm} nesta clínica`
      throw new ConflictError('DOCTOR_DUPLICATE', msg, {
        crm,
        external_identifier: input.externalIdentifier ?? null,
      })
    }
    throw new Error(`createDoctor failed: ${doctorInsert.error.message}`)
  }
  const doctor = doctorInsert.data as unknown as {
    id: string
    full_name: string
    crm: string
    external_identifier: string | null
    role: string
    specialty: string | null
    council_name: string | null
    council_number: string | null
    active: boolean
    created_at: string
    payment_mode: PaymentMode
  }

  // 2) commission_history — sempre escreve (com 0 bps para fixo/liberal).
  const commissionInsert = await supabase
    .from('doctor_commission_history')
    .insert({
      tenant_id: input.tenantId,
      doctor_id: doctor.id,
      percentage_bps: commissionBps,
      valid_from: input.initialValidFrom,
      reason: input.initialReason.trim(),
      created_by: input.actorUserId,
    })
    .select('id, percentage_bps, valid_from')
    .single()

  if (commissionInsert.error || !commissionInsert.data) {
    await supabase.from('doctors').delete().eq('id', doctor.id).eq('tenant_id', input.tenantId)
    throw new Error(
      `createDoctor commission insert failed: ${commissionInsert.error?.message ?? 'unknown'}`,
    )
  }

  // 3) payment_terms_history — sempre escreve com os params especificos da modalidade.
  const ptResult = (await supabase
    .from('doctor_payment_terms_history' as never)
    .insert({
      tenant_id: input.tenantId,
      doctor_id: doctor.id,
      payment_mode: paymentMode,
      percentage_bps: paymentMode === 'comissionado' ? commissionBps : null,
      monthly_amount_cents: paymentMode === 'fixo' ? (input.monthlyAmountCents as number) : null,
      billing_day: paymentMode === 'fixo' ? (input.billingDay as number) : null,
      liberal_default_cents:
        paymentMode === 'liberal' ? (input.liberalDefaultCents as number) : null,
      valid_from: input.initialValidFrom,
      reason: input.initialReason.trim(),
      created_by: input.actorUserId,
    } as never)
    .select('id')
    .single()) as unknown as {
    data: { id: string } | null
    error: { message: string } | null
  }

  if (ptResult.error || !ptResult.data) {
    // Rollback: remove commission row + doctor row.
    await supabase.from('doctor_commission_history').delete().eq('id', commissionInsert.data.id)
    await supabase.from('doctors').delete().eq('id', doctor.id).eq('tenant_id', input.tenantId)
    throw new Error(
      `createDoctor payment_terms insert failed: ${ptResult.error?.message ?? 'unknown'}`,
    )
  }

  return {
    id: doctor.id,
    fullName: doctor.full_name,
    crm: doctor.crm,
    externalIdentifier: doctor.external_identifier,
    role: doctor.role,
    specialty: doctor.specialty,
    councilName: doctor.council_name,
    councilNumber: doctor.council_number,
    active: doctor.active,
    createdAt: doctor.created_at,
    paymentMode: doctor.payment_mode,
    currentPercentageBps: paymentMode === 'comissionado' ? commissionBps : null,
    currentMonthlyAmountCents: paymentMode === 'fixo' ? (input.monthlyAmountCents as number) : null,
    currentBillingDay: paymentMode === 'fixo' ? (input.billingDay as number) : null,
    currentLiberalDefaultCents:
      paymentMode === 'liberal' ? (input.liberalDefaultCents as number) : null,
    currentValidFrom: commissionInsert.data.valid_from,
    commissionHistoryId: commissionInsert.data.id,
    paymentTermsHistoryId: ptResult.data.id,
  }
}
