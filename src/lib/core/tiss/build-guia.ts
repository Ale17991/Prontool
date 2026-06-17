/**
 * Feature 029 (US2/T027+T030) — montagem e persistência da Guia de Consulta.
 *
 * Lê o atendimento + procedimento (primário) + médico + paciente (decifrado) +
 * carteira + config TISS da operadora; mapeia os domínios (conselho 26, UF 59,
 * tabela 87); valida o conteúdo (`validate-content`); congela o valor e a versão
 * do catálogo TUSS; e grava `tiss_guias` + `tiss_guia_procedures` com status
 * `rascunho` (há pendências) ou `pronta` (sem pendências) — espelha o bloqueio
 * de prescrição da Memed.
 *
 * Append-only: cada chamada gera UMA guia por atendimento (idempotente — se já
 * existe, devolve a existente; revalidação/reapresentação ficam para US4/US5).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { getPatient } from '@/lib/core/patients/get'
import { recordTissAudit } from './audit'
import { getTissOperatorConfig } from './operator-config'
import { getPatientCard } from './patient-cards'
import { conselhoToCode, ufToIbgeCode } from './xml/domain-maps'
import {
  validateConsultaContent,
  validateSpSadtContent,
  type GuiaConsultaDraft,
  type GuiaSpSadtDraft,
  type DraftProcedimento,
  type ValidationError as ContentError,
} from './xml/validate-content'
import type { ConsultaGuiaModel } from './xml/render-consulta'

type Client = SupabaseClient<Database>

export interface GenerateConsultaArgs {
  supabase: Client
  tenantId: string
  appointmentId: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface GenerateConsultaResult {
  guiaId: string
  guiaNumber: string
  status: 'rascunho' | 'pronta'
  validationErrors: ContentError[]
  /** Modelo de render (presente apenas quando `pronta`). */
  model: ConsultaGuiaModel | null
}

/** ISO timestamp → 'YYYY-MM-DD' no fuso da clínica. */
function toClinicDate(iso: string, tz = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export async function generateConsultaGuia(
  args: GenerateConsultaArgs,
): Promise<GenerateConsultaResult> {
  const { supabase, tenantId, appointmentId } = args

  // Idempotência: uma guia por atendimento.
  const { data: existing } = await supabase
    .from('tiss_guias')
    .select('id, guia_number_prestador, status, validation_errors')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .maybeSingle()
  if (existing) {
    throw new ConflictError(
      'TISS_GUIA_EXISTS',
      `Já existe uma guia (${existing.guia_number_prestador}) para este atendimento.`,
      { guia_id: existing.id, status: existing.status },
    )
  }

  // 1. Atendimento (com status efetivo e valor líquido).
  const { data: appt, error: apptErr } = await supabase
    .from('appointments_effective')
    .select('id, patient_id, doctor_id, plan_id, appointment_at, net_amount_cents, effective_status')
    .eq('tenant_id', tenantId)
    .eq('id', appointmentId)
    .maybeSingle()
  if (apptErr) throw new Error(`generateConsultaGuia appointment read: ${apptErr.message}`)
  if (!appt) throw new NotFoundError('appointment', appointmentId)
  if (appt.effective_status === 'estornado') {
    throw new ValidationError('Atendimento estornado não gera guia TISS.')
  }
  if (!appt.plan_id) {
    throw new ValidationError('Atendimento particular (sem convênio) não gera guia TISS.')
  }
  if (!appt.patient_id || !appt.doctor_id || !appt.appointment_at) {
    throw new ValidationError('Atendimento incompleto (paciente, médico ou data ausentes).')
  }

  // 2. Config TISS da operadora (1:1 health_plan).
  const config = await getTissOperatorConfig(supabase, tenantId, appt.plan_id)
  if (!config || !config.active) {
    throw new ValidationError('Operadora não está configurada para faturamento TISS.')
  }

  // 3. Médico executante.
  const { data: doctor, error: docErr } = await supabase
    .from('doctors')
    .select('full_name, council_name, council_number, council_state, cbo')
    .eq('tenant_id', tenantId)
    .eq('id', appt.doctor_id)
    .maybeSingle()
  if (docErr) throw new Error(`generateConsultaGuia doctor read: ${docErr.message}`)
  if (!doctor) throw new NotFoundError('doctor', appt.doctor_id)

  // 4. Paciente (PII decifrada server-side). Anonimizado não fatura.
  const { patient } = await getPatient(supabase, { tenantId, patientId: appt.patient_id })
  if (patient.anonymizedAt) {
    throw new ValidationError('Paciente anonimizado (LGPD) não pode ser faturado.')
  }

  // 5. Carteira do beneficiário na operadora.
  const card = await getPatientCard(supabase, tenantId, appt.patient_id, appt.plan_id)

  // 6. Procedimento primário (consulta = uma linha) + dados do catálogo TUSS.
  const { data: procLines, error: procErr } = await supabase
    .from('appointment_procedures')
    .select('sequence, line_amount_cents, procedures!inner(tuss_code)')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .order('sequence', { ascending: true })
    .limit(1)
  if (procErr) throw new Error(`generateConsultaGuia procedures read: ${procErr.message}`)
  const primary = procLines?.[0]
  if (!primary) {
    throw new ValidationError('Atendimento sem procedimento — nada a faturar.')
  }
  const tussCodeStr = (primary.procedures as unknown as { tuss_code: string | null } | null)?.tuss_code ?? null

  let tussTable = '22'
  let tussCodeId: string | null = null
  let tussCatalogVersionId: string | null = null
  let tussVigente = true
  let description = 'Consulta'
  if (tussCodeStr) {
    const { data: tuss } = await supabase
      .from('tuss_codes')
      .select('id, tuss_table, description, valid_to, source_catalog_version_id')
      .eq('code', tussCodeStr)
      .maybeSingle()
    if (tuss) {
      tussTable = tuss.tuss_table
      tussCodeId = tuss.id
      tussCatalogVersionId = tuss.source_catalog_version_id
      description = tuss.description
      const today = new Date().toISOString().slice(0, 10)
      tussVigente = tuss.valid_to === null || tuss.valid_to >= today
    }
  }
  const lineAmount = primary.line_amount_cents

  // 7. Mapeamento de domínios.
  const conselhoCode = conselhoToCode(doctor.council_name)
  const ufCode = ufToIbgeCode(doctor.council_state)
  const dataAtendimento = toClinicDate(appt.appointment_at)

  // 8. Validação de conteúdo.
  const draft: GuiaConsultaDraft = {
    registroANS: config.ans_registration,
    numeroGuiaPrestador: 'pendente', // número definitivo gerado na persistência
    numeroCarteira: card?.cardNumber ?? null,
    atendimentoRN: 'N',
    contractedCode: config.contracted_code,
    cnes: config.contracted_cnes ?? '9999999',
    contratadoIsPJ: true, // clínica fatura como PJ (codigoPrestadorNaOperadora + CNPJ)
    profissional: {
      nome: doctor.full_name ?? null,
      conselhoCodigo: conselhoCode,
      conselhoRaw: doctor.council_name,
      numeroConselho: doctor.council_number ?? null,
      ufCodigo: ufCode,
      ufRaw: doctor.council_state,
      cbo: doctor.cbo,
    },
    indicacaoAcidente: '9',
    regimeAtendimento: '01',
    dataAtendimento,
    tipoConsulta: '1',
    procedimentos: [{ tabela: tussTable, codigo: tussCodeStr, valorCents: lineAmount, tussVigente }],
  }
  const validationErrors = validateConsultaContent(draft)
  const status: 'rascunho' | 'pronta' = validationErrors.length === 0 ? 'pronta' : 'rascunho'

  // 9. Número da guia no prestador (sequencial por tenant).
  const { count } = await supabase
    .from('tiss_guias')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  const guiaNumber = String((count ?? 0) + 1).padStart(6, '0')

  // 10. Snapshots: beneficiário cifrado (PII) + executante (não-PII).
  const beneficiarySnapshotEnc = await encText(
    supabase,
    JSON.stringify({ nome: patient.fullName, carteira: card?.cardNumber ?? null }),
  )
  const executanteSnapshot = {
    nome: doctor.full_name,
    conselho: conselhoCode,
    numeroConselho: doctor.council_number,
    uf: ufCode,
    cbo: doctor.cbo,
  }

  // 11. Persistência da guia + linha de procedimento + auditoria.
  const { data: guiaRow, error: guiaErr } = await supabase
    .from('tiss_guias')
    .insert({
      tenant_id: tenantId,
      health_plan_id: appt.plan_id,
      appointment_id: appointmentId,
      guia_type: 'consulta',
      guia_number_prestador: guiaNumber,
      beneficiary_snapshot_enc: beneficiarySnapshotEnc as unknown as string,
      executante_snapshot: executanteSnapshot as unknown as Json,
      frozen_amount_cents: lineAmount,
      tuss_catalog_version_id: tussCatalogVersionId,
      status,
      validation_errors: validationErrors as unknown as Json,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (guiaErr) throw new Error(`generateConsultaGuia insert guia: ${guiaErr.message}`)

  const { error: lineErr } = await supabase.from('tiss_guia_procedures').insert({
    tenant_id: tenantId,
    guia_id: guiaRow.id,
    sequence: 1,
    tuss_table: tussTable,
    procedure_code: tussCodeStr ?? '',
    description,
    quantity: 1,
    unit_amount_cents: lineAmount,
    total_amount_cents: lineAmount,
    tuss_code_id: tussCodeId,
  })
  if (lineErr) throw new Error(`generateConsultaGuia insert procedure: ${lineErr.message}`)

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tiss_guias',
    entityId: guiaRow.id,
    field: 'tiss.guia.generate',
    detail: { appointment_id: appointmentId, status, guia_number: guiaNumber },
    reason: `geração de guia de consulta (${status})`,
    ip: args.ip,
    userAgent: args.userAgent,
  })

  // 12. Modelo de render apenas quando pronta (todos os campos presentes).
  const model: ConsultaGuiaModel | null =
    status === 'pronta'
      ? {
          registroANS: config.ans_registration,
          numeroGuiaPrestador: guiaNumber,
          beneficiario: { numeroCarteira: card!.cardNumber, atendimentoRN: 'N' },
          contratadoExecutante: {
            codigoPrestadorNaOperadora: config.contracted_code,
            cnes: config.contracted_cnes ?? '9999999',
          },
          profissionalExecutante: {
            nome: doctor.full_name,
            conselho: conselhoCode!,
            numeroConselho: doctor.council_number!,
            uf: ufCode!,
            cbo: doctor.cbo!,
          },
          indicacaoAcidente: '9',
          atendimento: {
            regimeAtendimento: '01',
            dataAtendimento,
            tipoConsulta: '1',
            procedimento: {
              codigoTabela: tussTable,
              codigoProcedimento: tussCodeStr!,
              valorCents: lineAmount,
            },
          },
        }
      : null

  return { guiaId: guiaRow.id, guiaNumber, status, validationErrors, model }
}

export interface GenerateSpSadtResult {
  guiaId: string
  guiaNumber: string
  status: 'rascunho' | 'pronta'
  validationErrors: ContentError[]
}

/** Defaults TISS para SP/SADT gerada a partir de um atendimento de clínica. */
const SPSADT_DEFAULTS = {
  caraterAtendimento: '1', // eletivo
  tipoAtendimento: '04', // consulta (valor válido no XSD 04.03.00)
  indicacaoAcidente: '9', // não acidente
  regimeAtendimento: '01', // ambulatorial
} as const

/**
 * Feature 029 (US3) — gera a Guia de SP/SADT (execução) de um atendimento de
 * convênio. Diferente da Consulta: agrega TODAS as linhas de
 * `appointment_procedures`, congela os campos extras (nome do contratado,
 * caráter, tipo de atendimento) no snapshot do executante para reprodutibilidade
 * no lote, e persiste N `tiss_guia_procedures`.
 */
export async function generateSpSadtGuia(
  args: GenerateConsultaArgs,
): Promise<GenerateSpSadtResult> {
  const { supabase, tenantId, appointmentId } = args

  const { data: existing } = await supabase
    .from('tiss_guias')
    .select('id, guia_number_prestador, status')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .maybeSingle()
  if (existing) {
    throw new ConflictError(
      'TISS_GUIA_EXISTS',
      `Já existe uma guia (${existing.guia_number_prestador}) para este atendimento.`,
      { guia_id: existing.id, status: existing.status },
    )
  }

  const { data: appt, error: apptErr } = await supabase
    .from('appointments_effective')
    .select('id, patient_id, doctor_id, plan_id, appointment_at, effective_status')
    .eq('tenant_id', tenantId)
    .eq('id', appointmentId)
    .maybeSingle()
  if (apptErr) throw new Error(`generateSpSadtGuia appointment read: ${apptErr.message}`)
  if (!appt) throw new NotFoundError('appointment', appointmentId)
  if (appt.effective_status === 'estornado') {
    throw new ValidationError('Atendimento estornado não gera guia TISS.')
  }
  if (!appt.plan_id) {
    throw new ValidationError('Atendimento particular (sem convênio) não gera guia TISS.')
  }
  if (!appt.patient_id || !appt.doctor_id || !appt.appointment_at) {
    throw new ValidationError('Atendimento incompleto (paciente, médico ou data ausentes).')
  }

  const config = await getTissOperatorConfig(supabase, tenantId, appt.plan_id)
  if (!config || !config.active) {
    throw new ValidationError('Operadora não está configurada para faturamento TISS.')
  }

  const { data: doctor, error: docErr } = await supabase
    .from('doctors')
    .select('full_name, council_name, council_number, council_state, cbo')
    .eq('tenant_id', tenantId)
    .eq('id', appt.doctor_id)
    .maybeSingle()
  if (docErr) throw new Error(`generateSpSadtGuia doctor read: ${docErr.message}`)
  if (!doctor) throw new NotFoundError('doctor', appt.doctor_id)

  const { patient } = await getPatient(supabase, { tenantId, patientId: appt.patient_id })
  if (patient.anonymizedAt) {
    throw new ValidationError('Paciente anonimizado (LGPD) não pode ser faturado.')
  }

  const card = await getPatientCard(supabase, tenantId, appt.patient_id, appt.plan_id)

  // Nome do contratado (razão social) — obrigatório no bloco solicitante.
  const { data: profile } = await supabase
    .from('tenant_clinic_profile')
    .select('corporate_name')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  let nomeContratado = (profile?.corporate_name as string | null) ?? null
  if (!nomeContratado) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenantId)
      .maybeSingle()
    nomeContratado = (tenant?.name as string | null) ?? null
  }

  // TODAS as linhas de procedimento do atendimento.
  const { data: rawLines, error: linesErr } = await supabase
    .from('appointment_procedures')
    .select('sequence, line_amount_cents, quantity, procedures!inner(tuss_code, display_name)')
    .eq('tenant_id', tenantId)
    .eq('appointment_id', appointmentId)
    .order('sequence', { ascending: true })
  if (linesErr) throw new Error(`generateSpSadtGuia procedures read: ${linesErr.message}`)
  const lines = (rawLines ?? []) as unknown as Array<{
    sequence: number
    line_amount_cents: number
    quantity: number | null
    procedures: { tuss_code: string | null; display_name: string | null } | null
  }>
  if (lines.length === 0) {
    throw new ValidationError('Atendimento sem procedimento — nada a faturar.')
  }

  // Resolve catálogo TUSS de todos os códigos em uma consulta.
  const codes = Array.from(
    new Set(lines.map((l) => l.procedures?.tuss_code).filter((c): c is string => !!c)),
  )
  const tussByCode = new Map<
    string,
    { table: string; id: string; description: string; vigente: boolean; versionId: string | null }
  >()
  if (codes.length > 0) {
    const { data: tussRows } = await supabase
      .from('tuss_codes')
      .select('id, code, tuss_table, description, valid_to, source_catalog_version_id')
      .in('code', codes)
    const today = new Date().toISOString().slice(0, 10)
    for (const t of (tussRows ?? []) as Array<{
      id: string
      code: string
      tuss_table: string
      description: string
      valid_to: string | null
      source_catalog_version_id: string | null
    }>) {
      tussByCode.set(t.code, {
        table: t.tuss_table,
        id: t.id,
        description: t.description,
        vigente: t.valid_to === null || t.valid_to >= today,
        versionId: t.source_catalog_version_id,
      })
    }
  }

  interface BuiltLine {
    sequence: number
    tussTable: string
    code: string
    description: string
    quantity: number
    unitCents: number
    totalCents: number
    tussCodeId: string | null
    vigente: boolean
  }
  const built: BuiltLine[] = lines.map((l, idx) => {
    const code = l.procedures?.tuss_code ?? ''
    const tuss = code ? tussByCode.get(code) : undefined
    const qty = l.quantity || 1
    return {
      sequence: l.sequence || idx + 1,
      tussTable: tuss?.table ?? '22',
      code,
      description: tuss?.description ?? l.procedures?.display_name ?? 'Procedimento',
      quantity: qty,
      unitCents: l.line_amount_cents,
      totalCents: l.line_amount_cents * qty,
      tussCodeId: tuss?.id ?? null,
      vigente: tuss?.vigente ?? true,
    }
  })
  const totalCents = built.reduce((s, b) => s + b.totalCents, 0)
  const tussVersionId =
    codes.map((c) => tussByCode.get(c)?.versionId).find((v) => v) ?? null

  const conselhoCode = conselhoToCode(doctor.council_name)
  const ufCode = ufToIbgeCode(doctor.council_state)

  const draftProcs: DraftProcedimento[] = built.map((b) => ({
    tabela: b.tussTable,
    codigo: b.code || null,
    valorCents: b.totalCents,
    tussVigente: b.vigente,
  }))
  const draft: GuiaSpSadtDraft = {
    registroANS: config.ans_registration,
    numeroGuiaPrestador: 'pendente',
    numeroCarteira: card?.cardNumber ?? null,
    atendimentoRN: 'N',
    contractedCode: config.contracted_code,
    nomeContratado,
    cnes: config.contracted_cnes ?? '9999999',
    contratadoIsPJ: true,
    profissional: {
      nome: doctor.full_name ?? null,
      conselhoCodigo: conselhoCode,
      conselhoRaw: doctor.council_name,
      numeroConselho: doctor.council_number ?? null,
      ufCodigo: ufCode,
      ufRaw: doctor.council_state,
      cbo: doctor.cbo,
    },
    indicacaoAcidente: SPSADT_DEFAULTS.indicacaoAcidente,
    regimeAtendimento: SPSADT_DEFAULTS.regimeAtendimento,
    caraterAtendimento: SPSADT_DEFAULTS.caraterAtendimento,
    tipoAtendimento: SPSADT_DEFAULTS.tipoAtendimento,
    procedimentos: draftProcs,
  }
  const validationErrors = validateSpSadtContent(draft)
  const status: 'rascunho' | 'pronta' = validationErrors.length === 0 ? 'pronta' : 'rascunho'

  const { count } = await supabase
    .from('tiss_guias')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  const guiaNumber = String((count ?? 0) + 1).padStart(6, '0')

  const beneficiarySnapshotEnc = await encText(
    supabase,
    JSON.stringify({ nome: patient.fullName, carteira: card?.cardNumber ?? null }),
  )
  // Snapshot do executante + extras SP/SADT (reproduz o XML no lote).
  const executanteSnapshot = {
    nome: doctor.full_name,
    conselho: conselhoCode,
    numeroConselho: doctor.council_number,
    uf: ufCode,
    cbo: doctor.cbo,
    spSadt: {
      nomeContratado,
      caraterAtendimento: SPSADT_DEFAULTS.caraterAtendimento,
      tipoAtendimento: SPSADT_DEFAULTS.tipoAtendimento,
      regimeAtendimento: SPSADT_DEFAULTS.regimeAtendimento,
      indicacaoAcidente: SPSADT_DEFAULTS.indicacaoAcidente,
    },
  }

  const { data: guiaRow, error: guiaErr } = await supabase
    .from('tiss_guias')
    .insert({
      tenant_id: tenantId,
      health_plan_id: appt.plan_id,
      appointment_id: appointmentId,
      guia_type: 'sp_sadt',
      guia_number_prestador: guiaNumber,
      beneficiary_snapshot_enc: beneficiarySnapshotEnc as unknown as string,
      executante_snapshot: executanteSnapshot as unknown as Json,
      frozen_amount_cents: totalCents,
      tuss_catalog_version_id: tussVersionId,
      status,
      validation_errors: validationErrors as unknown as Json,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (guiaErr) throw new Error(`generateSpSadtGuia insert guia: ${guiaErr.message}`)

  const lineRows = built.map((b) => ({
    tenant_id: tenantId,
    guia_id: guiaRow.id,
    sequence: b.sequence,
    tuss_table: b.tussTable,
    procedure_code: b.code,
    description: b.description,
    quantity: b.quantity,
    unit_amount_cents: b.unitCents,
    total_amount_cents: b.totalCents,
    tuss_code_id: b.tussCodeId,
  }))
  const { error: lineErr } = await supabase.from('tiss_guia_procedures').insert(lineRows)
  if (lineErr) throw new Error(`generateSpSadtGuia insert procedures: ${lineErr.message}`)

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tiss_guias',
    entityId: guiaRow.id,
    field: 'tiss.guia.generate',
    detail: { appointment_id: appointmentId, status, guia_number: guiaNumber, type: 'sp_sadt', lines: built.length },
    reason: `geração de guia SP/SADT (${status})`,
    ip: args.ip,
    userAgent: args.userAgent,
  })

  return { guiaId: guiaRow.id, guiaNumber, status, validationErrors }
}

function encKey(): string {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set')
  return key
}

async function encText(supabase: Client, plain: string): Promise<string> {
  const { data, error } = await supabase.rpc('enc_text_with_key', { plain, key: encKey() })
  if (error) throw new Error(`enc_text_with_key failed: ${error.message}`)
  return data as unknown as string
}
