import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { getPatient } from '@/lib/core/patients/get'
import type { ModuleId } from '@/lib/core/entitlements/plans'
import type { PatientDetail } from '@/lib/core/patients/get'

/**
 * Feature 054 — porta de entrada única de todo impresso.
 *
 * Toda rota de PDF repete as mesmas quatro regras. Espalhá-las por sete rotas
 * garante que a sétima esqueça uma — e a que costuma ser esquecida é a mais
 * cara. Concentrar aqui torna o esquecimento impossível: quem não chama o
 * guard não tem paciente para imprimir.
 */

export interface PrintoutContext {
  tenantId: string
  userId: string
  userName: string
  patient: PatientDetail
  supabase: ReturnType<typeof createSupabaseServiceClient>
}

/** Erro que a rota converte em resposta. Nunca vaza detalhe para o cliente. */
export class PrintoutDenied extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
  ) {
    super(code)
    this.name = 'PrintoutDenied'
  }
}

export function deniedResponse(err: PrintoutDenied): Response {
  return NextResponse.json(
    { error: { code: err.code, message: err.publicMessage } },
    { status: err.status },
  )
}

export async function openPrintout(args: {
  req: Request
  patientId: string
  route: string
  /** Módulo da funcionalidade que alimenta o documento. */
  module?: ModuleId
  entity: string
}): Promise<PrintoutContext> {
  const session = await requireRole(['admin', 'profissional_saude'], {
    entity: args.entity,
    entityId: args.patientId,
    route: args.route,
    request: args.req,
  })

  const supabase = createSupabaseServiceClient()

  if (args.module) {
    const ent = await getTenantEntitlements(supabase, session.tenantId)
    if (!ent.hasModule(args.module)) {
      // 404, e não 403: a convenção da vertical é não revelar que a
      // funcionalidade existe para quem não a contratou.
      throw new PrintoutDenied(404, 'MODULE_DISABLED', 'Módulo indisponível.')
    }
  }

  let patient: PatientDetail
  try {
    patient = (await getPatient(supabase, { tenantId: session.tenantId, patientId: args.patientId }))
      .patient
  } catch {
    // Paciente inexistente OU de outra clínica caem no MESMO 404. Um 403 aqui
    // confirmaria que o paciente existe em algum lugar do sistema, que é
    // exatamente o que o isolamento entre clínicas precisa esconder.
    throw new PrintoutDenied(404, 'NOT_FOUND', 'Não encontrado.')
  }

  if (patient.anonymizedAt) {
    // Não se emite documento identificado de quem foi anonimizado (FR-013):
    // seria desfazer na impressora o apagamento que a LGPD exigiu no banco.
    throw new PrintoutDenied(
      409,
      'PATIENT_ANONYMIZED',
      'Paciente anonimizado: não é possível emitir documento identificado.',
    )
  }

  return {
    tenantId: session.tenantId,
    userId: session.userId,
    userName: session.email ?? 'profissional',
    patient,
    supabase,
  }
}

/** Cabeçalhos de um PDF entregue ao paciente. */
export function pdfHeaders(filename: string): HeadersInit {
  return {
    'content-type': 'application/pdf',
    'content-disposition': `attachment; filename="${filename}"`,
    // O conteúdo tem PII; nenhum intermediário deve guardar cópia.
    'cache-control': 'no-store',
  }
}

/** Nome de arquivo legível e sem caractere problemático. */
export function printoutFilename(prefix: string, patientName: string, isoDate: string): string {
  const slug = patientName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 40)
  return `${prefix}-${slug || 'paciente'}-${isoDate}.pdf`
}

/** Registra a emissão na trilha de auditoria (Princípio II). */
export async function auditPrintout(
  ctx: PrintoutContext,
  documento: string,
): Promise<void> {
  await ctx.supabase.rpc(
    'log_audit_event' as never,
    {
      p_tenant_id: ctx.tenantId,
      p_entity: 'patient_printouts',
      p_entity_id: ctx.patient.id,
      p_field: 'emitido',
      p_old: null,
      p_new: documento,
      p_reason: `impresso ${documento} gerado`,
    } as never,
  )
}
