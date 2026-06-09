/**
 * Feature 029 (US4/T040) — fechamento do lote: agrega guias `pronta` de UMA
 * operadora, renderiza a `mensagemTISS`, calcula o hash MD-5, assina (XMLDSig
 * A1), valida no XSD e persiste `tiss_lotes` vinculando as guias (status
 * `exportada`). Reconstrói cada guia a partir do que foi CONGELADO na geração
 * (snapshots), garantindo reprodutibilidade do XML/hash.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { recordTissAudit } from './audit'
import { getTissOperatorConfig } from './operator-config'
import { loadCertificateForSigning } from './signing/load-certificate'
import { signLoteXml } from './signing/sign-lote'
import { computeTissHashFromXml } from './xml/hash'
import { renderConsultaLoteXml, type ConsultaGuiaModel } from './xml/render-consulta'
import { validateTissXml } from './validate'

type Client = SupabaseClient<Database>

export interface CreateLoteArgs {
  supabase: Client
  tenantId: string
  healthPlanId: string
  guiaIds: string[]
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface CreateLoteResult {
  loteId: string
  loteNumber: string
  xmlHashMd5: string
  guiaCount: number
}

function encKey(): string {
  const key = process.env.PATIENT_DATA_ENCRYPTION_KEY
  if (!key) throw new Error('PATIENT_DATA_ENCRYPTION_KEY not set')
  return key
}
async function decText(supabase: Client, cipher: string): Promise<string> {
  const { data, error } = await supabase.rpc('dec_text_with_key', { cipher, key: encKey() })
  if (error) throw new Error(`dec_text_with_key failed: ${error.message}`)
  return (data as unknown as string) ?? ''
}

function toClinicDate(iso: string, tz = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}
function nowDateTime(tz = 'America/Sao_Paulo'): { date: string; time: string } {
  const now = new Date()
  const date = toClinicDate(now.toISOString(), tz)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now)
  return { date, time }
}

interface ExecutanteSnapshot {
  nome: string | null
  conselho: string | null
  numeroConselho: string | null
  uf: string | null
  cbo: string | null
}

export async function createLote(args: CreateLoteArgs): Promise<CreateLoteResult> {
  const { supabase, tenantId, healthPlanId, guiaIds } = args
  if (guiaIds.length === 0) {
    throw new ValidationError('Selecione ao menos uma guia para o lote.')
  }

  // 1. Guias selecionadas.
  const { data: guias, error: guiasErr } = await supabase
    .from('tiss_guias')
    .select(
      'id, health_plan_id, appointment_id, guia_type, guia_number_prestador, beneficiary_snapshot_enc, executante_snapshot, frozen_amount_cents, status, lote_id',
    )
    .eq('tenant_id', tenantId)
    .in('id', guiaIds)
  if (guiasErr) throw new Error(`createLote read guias: ${guiasErr.message}`)
  if (!guias || guias.length !== guiaIds.length) {
    throw new NotFoundError('tiss_guia', guiaIds.join(','))
  }
  for (const g of guias) {
    if (g.health_plan_id !== healthPlanId) {
      throw new ConflictError('TISS_LOTE_MIXED_OPERATOR', 'Um lote só pode conter guias de uma única operadora.')
    }
    if (g.status !== 'pronta') {
      throw new ValidationError(`Guia ${g.guia_number_prestador} não está pronta (status ${g.status}).`)
    }
    if (g.lote_id) {
      throw new ConflictError('TISS_GUIA_ALREADY_IN_LOTE', `Guia ${g.guia_number_prestador} já está em um lote.`)
    }
    if (g.guia_type !== 'consulta') {
      throw new ValidationError(`Tipo de guia ${g.guia_type} ainda não suportado no lote (apenas consulta no MVP).`)
    }
  }

  // 2. Config da operadora + certificado A1 ativo.
  const config = await getTissOperatorConfig(supabase, tenantId, healthPlanId)
  if (!config || !config.active) {
    throw new ValidationError('Operadora não está configurada para faturamento TISS.')
  }
  const { data: cert, error: certErr } = await supabase
    .from('tenant_tiss_certificates')
    .select('id, pfx_enc, password_enc')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .maybeSingle()
  if (certErr) throw new Error(`createLote read certificate: ${certErr.message}`)
  if (!cert) {
    throw new ValidationError('Nenhum certificado ICP-Brasil A1 ativo — cadastre um para assinar o lote.')
  }
  const [pfxBase64, pfxPassword] = await Promise.all([
    decText(supabase, cert.pfx_enc as unknown as string),
    decText(supabase, cert.password_enc as unknown as string),
  ])
  const signingCert = loadCertificateForSigning(pfxBase64, pfxPassword)

  // 3. Reconstrói o modelo de cada guia (dados congelados).
  const cnes = config.contracted_cnes ?? '9999999'
  const models: ConsultaGuiaModel[] = []
  for (const g of guias) {
    const benef = JSON.parse(await decText(supabase, g.beneficiary_snapshot_enc as unknown as string)) as {
      nome: string | null
      carteira: string | null
    }
    const exec = (g.executante_snapshot ?? {}) as unknown as ExecutanteSnapshot
    const { data: line } = await supabase
      .from('tiss_guia_procedures')
      .select('tuss_table, procedure_code, total_amount_cents')
      .eq('guia_id', g.id)
      .order('sequence', { ascending: true })
      .limit(1)
      .maybeSingle()
    const { data: appt } = await supabase
      .from('appointments')
      .select('appointment_at')
      .eq('tenant_id', tenantId)
      .eq('id', g.appointment_id)
      .maybeSingle()
    models.push({
      registroANS: config.ans_registration,
      numeroGuiaPrestador: g.guia_number_prestador,
      beneficiario: { numeroCarteira: benef.carteira ?? '', atendimentoRN: 'N' },
      contratadoExecutante: { codigoPrestadorNaOperadora: config.contracted_code, cnes },
      profissionalExecutante: {
        nome: exec.nome,
        conselho: exec.conselho ?? '',
        numeroConselho: exec.numeroConselho ?? '',
        uf: exec.uf ?? '',
        cbo: exec.cbo ?? '',
      },
      indicacaoAcidente: '9',
      atendimento: {
        regimeAtendimento: '01',
        dataAtendimento: appt?.appointment_at ? toClinicDate(appt.appointment_at) : toClinicDate(new Date().toISOString()),
        tipoConsulta: '1',
        procedimento: {
          codigoTabela: line?.tuss_table ?? '22',
          codigoProcedimento: line?.procedure_code ?? '',
          valorCents: line?.total_amount_cents ?? g.frozen_amount_cents,
        },
      },
    })
  }

  // 4. Número do lote (sequencial por tenant×operadora).
  const { count } = await supabase
    .from('tiss_lotes')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('health_plan_id', healthPlanId)
  const loteNumber = String((count ?? 0) + 1)

  // 5. Render → hash → render com hash → assina → valida XSD.
  const { date, time } = nowDateTime()
  const baseModel = {
    sequencialTransacao: loteNumber,
    dataRegistro: date,
    horaRegistro: time,
    origemCnpj: config.contracted_cnpj,
    destinoRegistroANS: config.ans_registration,
    numeroLote: loteNumber,
    guias: models,
  }
  const xmlNoHash = renderConsultaLoteXml({ ...baseModel, hash: '' })
  const hash = computeTissHashFromXml(xmlNoHash)
  const xmlWithHash = renderConsultaLoteXml({ ...baseModel, hash })
  const signedXml = signLoteXml(xmlWithHash, signingCert)

  const validation = await validateTissXml(signedXml)
  if (!validation.valid) {
    throw new ValidationError(
      `XML do lote inválido no XSD: ${validation.errors.map((e) => e.message).join('; ')}`,
      { errors: validation.errors },
    )
  }

  // 6. Persiste o lote + vincula guias (status exportada).
  const { data: loteRow, error: loteErr } = await supabase
    .from('tiss_lotes')
    .insert({
      tenant_id: tenantId,
      health_plan_id: healthPlanId,
      lote_number: loteNumber,
      status: 'fechado',
      xml_content: signedXml,
      xml_hash_md5: hash,
      signed_at: new Date().toISOString(),
      certificate_id: cert.id,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (loteErr) throw new Error(`createLote insert lote: ${loteErr.message}`)

  const exportedAt = new Date().toISOString()
  for (const g of guias) {
    const { error: updErr } = await supabase
      .from('tiss_guias')
      .update({ lote_id: loteRow.id, status: 'exportada', exported_at: exportedAt })
      .eq('tenant_id', tenantId)
      .eq('id', g.id)
    if (updErr) throw new Error(`createLote link guia ${g.id}: ${updErr.message}`)
  }

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tiss_lotes',
    entityId: loteRow.id,
    field: 'tiss.lote.close',
    detail: { lote_number: loteNumber, guia_count: guias.length, health_plan_id: healthPlanId },
    reason: 'fechamento e assinatura do lote TISS',
    ip: args.ip,
    userAgent: args.userAgent,
  })

  return { loteId: loteRow.id, loteNumber, xmlHashMd5: hash, guiaCount: guias.length }
}
