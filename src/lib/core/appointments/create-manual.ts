import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import {
  AppointmentPriceMissingError,
  DomainError,
  NotFoundError,
  TussCodeRetiredError,
} from '@/lib/observability/errors'
import { resolvePrice } from '@/lib/core/pricing/resolve-price'
import { resolveCommission } from '@/lib/core/commissions/resolve-commission'

/**
 * Cria um atendimento manualmente (admin/recepcionista) com N procedimentos.
 *
 * Cada item em `procedures` representa uma linha (procedimento + plano +
 * valor congelado). A primeira linha (index 0 → sequence=1) e denormalizada
 * em appointments.procedure_id/plan_id/source_price_version_id (mantem
 * compatibilidade com o trigger enforce_appointment_preconditions, com a
 * UI legada e com o auto-link FIFO em treatment_plan_steps).
 *
 * appointments.frozen_amount_cents = SUM(line_amount_cents).
 * Comissao e doctor-centric: uma taxa para o atendimento inteiro.
 *
 * `amountCentsOverride` por linha permite registrar valor diferente do
 * vigente em price_versions (ex.: paciente particular pagou menos). O
 * source_price_version_id aponta para o vigente; o override fica
 * registrado em `amount_was_overridden=true`.
 */
export interface ProcedureLineInput {
  procedureId: string
  /** UUID do plano OU null = linha particular. */
  planId: string | null
  /** Quando ausente, usa preco vigente (convenio) ou default_amount_cents (particular). */
  amountCentsOverride?: number
  /** Observação opcional por linha (até 500 chars). Migration 0077. */
  notes?: string | null
}

export interface ResolvedProcedureLine {
  procedureId: string
  planId: string | null
  sourcePriceVersionId: string | null
  lineAmountCents: number
  vigenteAmountCents: number
  amountWasOverridden: boolean
  sequence: number
  notes: string | null
}

export interface CreateManualAppointmentInput {
  tenantId: string
  actorUserId: string
  patientId: string
  doctorId: string
  /** Pelo menos uma linha. A primeira vira a linha "primaria" (sequence=1). */
  procedures: ProcedureLineInput[]
  /** ISO-8601 UTC. */
  appointmentAt: string
  durationMinutes?: number
  observacoes?: string
  /** Materiais opcionais (TUSS tabela 19). Feature 007. */
  materials?: Array<{ tussCode: string; tussDescription: string; quantity: number }>
  /**
   * Quando true (default), garante que existira uma treatment_plan_step
   * vinculada ao atendimento:
   *   1) Auto-link FIFO tenta vincular a uma step pendente sem appointment
   *      (mesmo procedure_id).
   *   2) Se nenhuma step compativel for vinculada, cria uma nova step
   *      ja com appointment_id setado (usando a linha primaria como
   *      procedimento, alinhado ao schema 1:N do treatment_plan_steps).
   * Quando false, mantem apenas o passo 1 (comportamento legado).
   */
  addToTreatmentPlan?: boolean
}

export interface CreateManualAppointmentResult {
  appointmentId: string
  /** Soma dos line_amount_cents. */
  frozenAmountCents: number
  frozenCommissionBps: number
  commissionHistoryId: string
  proceduresCount: number
  /** Quantidade de linhas com override aplicado. */
  proceduresOverridden: number
  lines: ResolvedProcedureLine[]
  materialsCount?: number
}

export async function createAppointmentManually(
  supabase: SupabaseClient<Database>,
  input: CreateManualAppointmentInput,
): Promise<CreateManualAppointmentResult> {
  const when = new Date(input.appointmentAt)
  if (Number.isNaN(when.getTime())) {
    throw new DomainError('INVALID_BODY', 'Data e hora do atendimento em formato inválido.', { status: 400 })
  }

  if (!input.procedures || input.procedures.length === 0) {
    throw new DomainError('PROCEDURES_REQUIRED', 'Informe ao menos um procedimento.', {
      status: 400,
    })
  }

  // Pre-valida FKs do paciente, profissional e cada procedimento/plano por
  // linha — em paralelo, mas single-shot por linha (N pequeno).
  const distinctProcedureIds = Array.from(new Set(input.procedures.map((p) => p.procedureId)))
  const distinctPlanIds = Array.from(
    new Set(
      input.procedures
        .map((p) => p.planId)
        .filter((v): v is string => typeof v === 'string'),
    ),
  )

  const fkChecks: Array<Promise<void>> = [
    ensureBelongsToTenant(supabase, 'patients', input.patientId, input.tenantId, 'PATIENT_NOT_FOUND'),
    ensureBelongsToTenant(supabase, 'doctors', input.doctorId, input.tenantId, 'DOCTOR_NOT_FOUND'),
    ...distinctProcedureIds.map((pid) =>
      ensureBelongsToTenant(supabase, 'procedures', pid, input.tenantId, 'PROCEDURE_NOT_FOUND'),
    ),
    ...distinctPlanIds.map((plid) =>
      ensureBelongsToTenant(supabase, 'health_plans', plid, input.tenantId, 'PLAN_NOT_FOUND'),
    ),
  ]
  await Promise.all(fkChecks)

  // Carrega TUSS + is_unlisted de cada procedimento.
  const procedureRows = await supabase
    .from('procedures')
    .select('id, tuss_code, default_amount_cents, is_unlisted')
    .in('id', distinctProcedureIds)
  if (procedureRows.error) {
    throw new Error(`procedures lookup failed: ${procedureRows.error.message}`)
  }
  const procedureById = new Map<
    string,
    { tussCode: string | null; defaultAmountCents: number | null; isUnlisted: boolean }
  >()
  for (const r of (procedureRows.data ?? []) as Array<{
    id: string
    tuss_code: string | null
    default_amount_cents: number | null
    is_unlisted: boolean | null
  }>) {
    procedureById.set(r.id, {
      tussCode: r.tuss_code,
      defaultAmountCents: r.default_amount_cents,
      isUnlisted: r.is_unlisted === true,
    })
  }

  // Valida vigencia TUSS apenas para procedimentos LISTADOS — unlisted nao
  // tem tuss_code para validar (constraint procedures_tuss_code_consistency
  // da 0066 garante a coerencia).
  const listedCodes = Array.from(
    new Set(
      Array.from(procedureById.values())
        .filter((p) => !p.isUnlisted && p.tussCode !== null)
        .map((p) => p.tussCode as string),
    ),
  )
  if (listedCodes.length > 0) {
    const today = new Date().toISOString().slice(0, 10)
    const tussRows = await supabase
      .from('tuss_codes')
      .select('code, valid_to')
      .in('code', listedCodes)
    if (tussRows.error) {
      throw new Error(`tuss_codes lookup failed: ${tussRows.error.message}`)
    }
    const tussByCode = new Map<string, { validTo: string | null }>()
    for (const r of (tussRows.data ?? []) as Array<{ code: string; valid_to: string | null }>) {
      tussByCode.set(r.code, { validTo: r.valid_to })
    }
    for (const [, p] of procedureById) {
      if (p.isUnlisted || p.tussCode === null) continue
      const t = tussByCode.get(p.tussCode)
      if (!t) {
        throw new DomainError(
          'TUSS_CODE_UNKNOWN',
          `Codigo TUSS ${p.tussCode} nao encontrado no catalogo.`,
          { status: 400 },
        )
      }
      if (t.validTo && t.validTo < today) {
        throw new TussCodeRetiredError(p.tussCode, t.validTo)
      }
    }
  }

  // Resolve comissao do profissional (doctor-centric, vale para o atendimento inteiro).
  const commission = await resolveCommission(supabase, {
    tenantId: input.tenantId,
    doctorId: input.doctorId,
    asOf: when,
  })

  // Resolve preco linha-a-linha.
  const lines: ResolvedProcedureLine[] = []
  let proceduresOverridden = 0
  for (let i = 0; i < input.procedures.length; i++) {
    const raw = input.procedures[i]!
    const proc = procedureById.get(raw.procedureId)
    if (!proc) {
      throw new NotFoundError('procedures', raw.procedureId)
    }
    let sourcePriceVersionId: string | null = null
    let vigenteAmountCents = 0
    if (raw.planId !== null) {
      try {
        const price = await resolvePrice(supabase, {
          tenantId: input.tenantId,
          procedureId: raw.procedureId,
          planId: raw.planId,
          asOf: when,
        })
        sourcePriceVersionId = price.priceVersionId
        vigenteAmountCents = price.amountCents
      } catch (err) {
        // Procedimento "nao listado" pode estar em pacote negociado sem
        // price_version cadastrada — cai em default_amount_cents/override.
        // Procedimento listado SEM price_version e erro de configuracao.
        const isPriceMissing =
          err instanceof AppointmentPriceMissingError ||
          (err instanceof DomainError && err.code === 'APPOINTMENT_PRICE_MISSING')
        if (!isPriceMissing || !proc.isUnlisted) {
          throw err
        }
        vigenteAmountCents = proc.defaultAmountCents ?? 0
      }
    } else {
      vigenteAmountCents = proc.defaultAmountCents ?? 0
    }
    const lineAmount =
      raw.amountCentsOverride !== undefined ? raw.amountCentsOverride : vigenteAmountCents
    if (lineAmount <= 0) {
      const label = proc.tussCode ?? '(nao listado)'
      throw new DomainError(
        'PROCEDURE_LINE_AMOUNT_REQUIRED',
        `Valor obrigatorio para o procedimento ${label}. Cadastre um valor particular para o procedimento ou informe o valor no atendimento.`,
        { status: 400 },
      )
    }
    const overridden =
      raw.amountCentsOverride !== undefined && raw.amountCentsOverride !== vigenteAmountCents
    if (overridden) proceduresOverridden++

    const notes = (() => {
      const raw_notes = raw.notes
      if (raw_notes === null || raw_notes === undefined) return null
      const trimmed = raw_notes.trim()
      if (trimmed.length === 0) return null
      if (trimmed.length > 500) {
        throw new DomainError(
          'PROCEDURE_LINE_NOTES_TOO_LONG',
          'Observação por procedimento limitada a 500 caracteres.',
          { status: 400 },
        )
      }
      return trimmed
    })()

    lines.push({
      procedureId: raw.procedureId,
      planId: raw.planId,
      sourcePriceVersionId,
      lineAmountCents: lineAmount,
      vigenteAmountCents,
      amountWasOverridden: overridden,
      sequence: i + 1,
      notes,
    })
  }

  const totalCents = lines.reduce((acc, l) => acc + l.lineAmountCents, 0)

  // Materiais — pre-validacao (defesa redundante ao trigger SQL).
  let materialsPayload: Array<{ tuss_code: string; tuss_description: string; quantity: number }> = []
  if (input.materials && input.materials.length > 0) {
    const codes = input.materials.map((m) => m.tussCode)
    const valid = await supabase
      .from('tuss_codes')
      .select('code')
      .in('code', codes)
      .eq('tuss_table', '19')
      .is('valid_to', null)
    if (valid.error) {
      throw new Error(`pre-validate materials TUSS failed: ${valid.error.message}`)
    }
    const validSet = new Set((valid.data ?? []).map((r) => r.code as string))
    const invalid = codes.filter((c) => !validSet.has(c))
    if (invalid.length > 0) {
      throw new DomainError(
        'MATERIAL_TUSS_INVALID',
        `Códigos TUSS inválidos ou não vigentes: ${invalid.join(', ')}`,
        { status: 400 },
      )
    }
    materialsPayload = input.materials.map((m) => ({
      tuss_code: m.tussCode,
      tuss_description: m.tussDescription,
      quantity: m.quantity,
    }))
  }

  // Cria appointment + linhas + materiais atomicamente via RPC.
  const proceduresPayload = lines.map((l) => ({
    procedure_id: l.procedureId,
    plan_id: l.planId,
    source_price_version_id: l.sourcePriceVersionId,
    line_amount_cents: l.lineAmountCents,
    vigente_amount_cents: l.vigenteAmountCents,
    amount_was_overridden: l.amountWasOverridden,
    sequence: l.sequence,
    notes: l.notes ?? '',
  }))

  const rpc = await supabase.rpc(
    'create_appointment_with_procedures_and_materials' as never,
    {
      p_tenant_id: input.tenantId,
      p_patient_id: input.patientId,
      p_doctor_id: input.doctorId,
      p_appointment_at: when.toISOString(),
      p_duration_minutes: input.durationMinutes ?? null,
      p_observacoes: input.observacoes ?? null,
      p_source: 'manual',
      p_actor: input.actorUserId,
      p_procedures: proceduresPayload,
      p_frozen_commission_bps: commission.percentageBps,
      p_source_commission_history_id: commission.commissionHistoryId,
      p_materials: materialsPayload,
    } as never,
  )

  if (rpc.error) {
    const msg = rpc.error.message ?? ''
    if (/APPOINTMENT_CONFLICT/i.test(msg) || /exclusion_violation/i.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_CONFLICT',
        'Já existe atendimento para este profissional no horário escolhido.',
        { status: 409 },
      )
    }
    if (/PROCEDURE_LINE_PRICE_MISSING|APPOINTMENT_PRICE_MISSING/i.test(msg)) {
      throw new DomainError(
        'APPOINTMENT_PRICE_MISSING',
        'Algum procedimento não tem preço vigente cadastrado para o plano informado.',
        { status: 400 },
      )
    }
    if (/PROCEDURE_LINE_TUSS_RETIRED|TUSS_CODE_RETIRED/i.test(msg)) {
      throw new DomainError(
        'TUSS_CODE_RETIRED',
        'Algum procedimento tem código TUSS retirado do catálogo.',
        { status: 400 },
      )
    }
    if (/PROCEDURE_LINE_UNKNOWN|APPOINTMENT_PROCEDURE_UNKNOWN/i.test(msg)) {
      throw new DomainError(
        'PROCEDURE_NOT_FOUND',
        'Procedimento não encontrado para este tenant.',
        { status: 400 },
      )
    }
    if (/MATERIAL_TUSS_INVALID/i.test(msg)) {
      throw new DomainError(
        'MATERIAL_TUSS_INVALID',
        'Código TUSS não pertence à tabela de materiais ou não está vigente.',
        { status: 400 },
      )
    }
    throw new Error(`createAppointmentWithProceduresAndMaterials RPC failed: ${msg}`)
  }

  const data = rpc.data as {
    appointment_id: string
    procedures_count: number
    materials_count: number
    frozen_amount_cents: number
  } | null
  if (!data?.appointment_id) {
    throw new Error('createAppointmentWithProceduresAndMaterials: empty response')
  }

  // Auto-link FIFO: para cada procedureId distinto, vincular a etapa
  // pendente do mesmo (patient, procedure) sem appointment. Best-effort.
  let anyStepLinkedOrCreated = false
  for (const pid of distinctProcedureIds) {
    try {
      const linkable = await supabase
        .from('treatment_plan_steps')
        .select('id')
        .eq('tenant_id', input.tenantId)
        .eq('patient_id', input.patientId)
        .eq('procedure_id', pid)
        .eq('status', 'pendente')
        .is('appointment_id', null)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (linkable.data) {
        await supabase
          .from('treatment_plan_steps')
          .update({ appointment_id: data.appointment_id } as never)
          .eq('id', linkable.data.id)
        anyStepLinkedOrCreated = true
      }
    } catch {
      // best-effort; ignora.
    }
  }

  // Se o caller pediu para garantir vinculacao ao plano e nenhuma step
  // foi linkada acima, cria uma step nova ja vinculada — usando a linha
  // primaria como procedimento. Default true (UI passa o estado do
  // checkbox; nao informar mantem default por seguranca).
  const shouldEnsurePlanStep = input.addToTreatmentPlan !== false
  if (shouldEnsurePlanStep && !anyStepLinkedOrCreated) {
    try {
      const primary = lines[0]!
      const scheduledDate = when.toISOString().slice(0, 10)
      await supabase.from('treatment_plan_steps').insert({
        tenant_id: input.tenantId,
        patient_id: input.patientId,
        procedure_id: primary.procedureId,
        plan_id: primary.planId,
        doctor_id: input.doctorId,
        title: 'Atendimento agendado (criado com o atendimento)',
        notes: null,
        scheduled_date: scheduledDate,
        status: 'pendente',
        appointment_id: data.appointment_id,
        created_by: input.actorUserId,
      } as never)
    } catch {
      // best-effort; nao deve impedir o sucesso do atendimento.
    }
  }

  return {
    appointmentId: data.appointment_id,
    frozenAmountCents: totalCents,
    frozenCommissionBps: commission.percentageBps,
    commissionHistoryId: commission.commissionHistoryId,
    proceduresCount: data.procedures_count,
    proceduresOverridden,
    lines,
    materialsCount: data.materials_count,
  }
}

async function ensureBelongsToTenant(
  supabase: SupabaseClient<Database>,
  table: 'patients' | 'doctors' | 'procedures' | 'health_plans',
  id: string,
  tenantId: string,
  notFoundCode: string,
): Promise<void> {
  const res = await supabase
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (res.error) throw new Error(`${table} lookup failed: ${res.error.message}`)
  if (!res.data) {
    const label = PT_TABLE_LABEL[table] ?? table
    throw new DomainError(notFoundCode, `${label} não encontrado(a) neste tenant.`, { status: 404 })
  }
}

const PT_TABLE_LABEL: Record<string, string> = {
  patients: 'Paciente',
  doctors: 'Profissional',
  procedures: 'Procedimento',
  health_plans: 'Plano de saúde',
}
