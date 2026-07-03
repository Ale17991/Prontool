/**
 * Feature 029 (US5/T049) — registro de glosa (Tabela 38) e reapresentação.
 *
 * - registerGlosa: grava `tiss_glosas` (motivo Tabela 38 + valor glosado) e
 *   atualiza o status da guia para `glosada` (glosa total) ou `parcial`
 *   (glosa < valor da guia). Append-only: correção = nova linha.
 * - reapresentarGuia: cria uma NOVA guia clonando os snapshots/linhas da guia
 *   glosada, com `supersedes_guia_id` apontando para a original — pronta para
 *   entrar num novo lote.
 *
 * Tabela 38 (motivos de glosa) NÃO está no XSD — quando o domínio 38 estiver
 * semeado em `tiss_domain_tables`, a validação exige pertinência; enquanto
 * vazio, valida apenas o formato. A faixa 9901–9999 é reservada a motivos
 * próprios da operadora (sempre aceita).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/db/types'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/observability/errors'
import { recordTissAudit } from './audit'
import { listDomain } from './domains'

type Client = SupabaseClient<Database>

export interface RegisterGlosaArgs {
  supabase: Client
  tenantId: string
  guiaId: string
  /** Linha específica glosada (opcional — glosa da guia inteira se ausente). */
  guiaProcedureId?: string | null
  motivoCode: string
  motivoText: string
  glosadoAmountCents: number
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface RegisterGlosaResult {
  glosaId: string
  guiaStatus: 'glosada' | 'parcial'
  totalGlosadoCents: number
}

function isOperatorRange(code: string): boolean {
  const n = Number(code)
  return Number.isInteger(n) && n >= 9901 && n <= 9999
}

async function validateMotivo(supabase: Client, code: string): Promise<void> {
  if (!/^\d{1,4}$/.test(code)) {
    throw new ValidationError('Motivo de glosa deve ser numérico (Tabela 38).')
  }
  if (isOperatorRange(code)) return // motivo próprio da operadora
  const known = await listDomain(supabase, '38')
  if (known.length > 0 && !known.some((k) => k.code === code)) {
    throw new ValidationError(`Motivo ${code} não pertence à Tabela 38 (TISS).`)
  }
}

export async function registerGlosa(args: RegisterGlosaArgs): Promise<RegisterGlosaResult> {
  const { supabase, tenantId, guiaId } = args
  if (args.glosadoAmountCents < 0) {
    throw new ValidationError('Valor glosado inválido.')
  }
  if (!args.motivoText.trim()) {
    throw new ValidationError('Descrição do motivo da glosa é obrigatória.')
  }
  await validateMotivo(supabase, args.motivoCode.trim())

  // Guia precisa já ter sido enviada (exportada) para ser glosada.
  const { data: guia, error: guiaErr } = await supabase
    .from('tiss_guias')
    .select('id, status, frozen_amount_cents')
    .eq('tenant_id', tenantId)
    .eq('id', guiaId)
    .maybeSingle()
  if (guiaErr) throw new Error(`registerGlosa read guia: ${guiaErr.message}`)
  if (!guia) throw new NotFoundError('tiss_guia', guiaId)
  if (!['exportada', 'paga', 'glosada', 'parcial'].includes(guia.status)) {
    throw new ConflictError(
      'TISS_GUIA_NOT_SUBMITTED',
      `Só é possível glosar uma guia enviada (status atual: ${guia.status}).`,
    )
  }

  const { data: glosaRow, error: glosaErr } = await supabase
    .from('tiss_glosas')
    .insert({
      tenant_id: tenantId,
      guia_id: guiaId,
      guia_procedure_id: args.guiaProcedureId ?? null,
      motivo_code: args.motivoCode.trim(),
      motivo_text: args.motivoText.trim(),
      glosado_amount_cents: args.glosadoAmountCents,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (glosaErr) throw new Error(`registerGlosa insert: ${glosaErr.message}`)

  // Soma de todas as glosas da guia → glosada (total) ou parcial.
  const { data: allGlosas } = await supabase
    .from('tiss_glosas')
    .select('glosado_amount_cents')
    .eq('tenant_id', tenantId)
    .eq('guia_id', guiaId)
  const totalGlosado = (allGlosas ?? []).reduce(
    (s, g) => s + Number(g.glosado_amount_cents ?? 0),
    0,
  )
  const guiaStatus: 'glosada' | 'parcial' =
    totalGlosado >= Number(guia.frozen_amount_cents) ? 'glosada' : 'parcial'

  const { error: updErr } = await supabase
    .from('tiss_guias')
    .update({ status: guiaStatus })
    .eq('tenant_id', tenantId)
    .eq('id', guiaId)
  if (updErr) throw new Error(`registerGlosa update guia status: ${updErr.message}`)

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tiss_glosas',
    entityId: glosaRow.id,
    field: 'tiss.glosa.register',
    detail: {
      guia_id: guiaId,
      motivo_code: args.motivoCode.trim(),
      glosado_cents: args.glosadoAmountCents,
      guia_status: guiaStatus,
    },
    reason: 'registro de glosa',
    ip: args.ip,
    userAgent: args.userAgent,
  })

  return { glosaId: glosaRow.id, guiaStatus, totalGlosadoCents: totalGlosado }
}

export interface ReapresentarArgs {
  supabase: Client
  tenantId: string
  guiaId: string
  actorUserId: string
  actorLabel: string
  ip?: string | null
  userAgent?: string | null
}

export interface ReapresentarResult {
  guiaId: string
  guiaNumber: string
}

/**
 * Cria uma nova guia (reapresentação) clonando a guia glosada/parcial. Mantém
 * o vínculo via `supersedes_guia_id` e volta ao fluxo de lote como `pronta`.
 */
export async function reapresentarGuia(args: ReapresentarArgs): Promise<ReapresentarResult> {
  const { supabase, tenantId, guiaId } = args

  const { data: orig, error: origErr } = await supabase
    .from('tiss_guias')
    .select(
      'id, status, health_plan_id, appointment_id, guia_type, beneficiary_snapshot_enc, executante_snapshot, frozen_amount_cents, tuss_catalog_version_id',
    )
    .eq('tenant_id', tenantId)
    .eq('id', guiaId)
    .maybeSingle()
  if (origErr) throw new Error(`reapresentarGuia read: ${origErr.message}`)
  if (!orig) throw new NotFoundError('tiss_guia', guiaId)
  if (orig.status !== 'glosada' && orig.status !== 'parcial') {
    throw new ConflictError(
      'TISS_GUIA_NOT_GLOSADA',
      `Só guias glosadas podem ser reapresentadas (status atual: ${orig.status}).`,
    )
  }

  const { count } = await supabase
    .from('tiss_guias')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
  const guiaNumber = String((count ?? 0) + 1).padStart(6, '0')

  const { data: novaGuia, error: insErr } = await supabase
    .from('tiss_guias')
    .insert({
      tenant_id: tenantId,
      health_plan_id: orig.health_plan_id,
      appointment_id: orig.appointment_id,
      guia_type: orig.guia_type,
      guia_number_prestador: guiaNumber,
      beneficiary_snapshot_enc: orig.beneficiary_snapshot_enc as unknown as string,
      executante_snapshot: orig.executante_snapshot as unknown as Json,
      frozen_amount_cents: orig.frozen_amount_cents,
      tuss_catalog_version_id: orig.tuss_catalog_version_id,
      status: 'pronta',
      validation_errors: [] as unknown as Json,
      supersedes_guia_id: orig.id,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (insErr) throw new Error(`reapresentarGuia insert: ${insErr.message}`)

  // Clona as linhas de procedimento.
  const { data: lines } = await supabase
    .from('tiss_guia_procedures')
    .select(
      'sequence, tuss_table, procedure_code, description, quantity, unit_amount_cents, total_amount_cents, tuss_code_id',
    )
    .eq('guia_id', orig.id)
    .order('sequence', { ascending: true })
  const rows = (lines ?? []).map((l) => ({
    tenant_id: tenantId,
    guia_id: novaGuia.id,
    sequence: l.sequence,
    tuss_table: l.tuss_table,
    procedure_code: l.procedure_code,
    description: l.description,
    quantity: l.quantity,
    unit_amount_cents: l.unit_amount_cents,
    total_amount_cents: l.total_amount_cents,
    tuss_code_id: l.tuss_code_id,
  }))
  if (rows.length > 0) {
    const { error: lineErr } = await supabase.from('tiss_guia_procedures').insert(rows)
    if (lineErr) throw new Error(`reapresentarGuia clone lines: ${lineErr.message}`)
  }

  await recordTissAudit(supabase, {
    tenantId,
    actorUserId: args.actorUserId,
    actorLabel: args.actorLabel,
    entity: 'tiss_guias',
    entityId: novaGuia.id,
    field: 'tiss.guia.reapresentar',
    detail: { supersedes: orig.id, guia_number: guiaNumber },
    reason: 'reapresentação de guia glosada',
    ip: args.ip,
    userAgent: args.userAgent,
  })

  return { guiaId: novaGuia.id, guiaNumber }
}
