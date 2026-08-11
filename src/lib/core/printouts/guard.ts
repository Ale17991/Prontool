import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/require-role'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { getPatient } from '@/lib/core/patients/get'
import type { ModuleId } from '@/lib/core/entitlements/plans'
import type { PatientDetail } from '@/lib/core/patients/get'
import { resolvePrintoutFields, type PrintoutDocumentId, type PrintoutFieldConfig } from './fields'
import { buildPatientIdentity, type PatientIdentity } from './patient-identity'

/**
 * Porta de entrada única de todo impresso.
 *
 * Nasceu na 054 dentro do módulo de nutrição, cobrindo sete documentos. Saiu de
 * lá porque a vertical não era o limite certo: pedido de exame, receita de
 * óculos, orçamento odontológico e laudo oftalmológico ficavam de fora e
 * repetiam — mal — as mesmas quatro regras. Toda rota de PDF de paciente passa
 * por aqui: RBAC, gate de módulo, 404 em vez de 403 para paciente de outra
 * clínica, 409 para anonimizado, e agora a identificação configurável (0195).
 *
 * Quem não chama o guard não tem paciente para imprimir — é o que torna o
 * esquecimento impossível em vez de improvável.
 */

export interface PrintoutContext {
  tenantId: string
  userId: string
  userName: string
  patient: PatientDetail
  /** Bloco de identificação já resolvido para ESTE documento. */
  identity: PatientIdentity
  documentId: PrintoutDocumentId
  /** Dia civil da clínica na emissão. */
  issuedOn: string
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

/** Dia civil da clínica — o mesmo critério usado nas rotas da vertical. */
export function todayInClinicTz(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.CLINIC_TIMEZONE || 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export async function openPrintout(args: {
  req: Request
  patientId: string
  route: string
  /** Módulo da funcionalidade que alimenta o documento. */
  module?: ModuleId
  entity: string
  /** Qual impresso é este — decide os campos e nomeia a auditoria. */
  document: PrintoutDocumentId
  /**
   * Papéis com acesso a ESTE documento.
   *
   * Parametrizado, e não fixo, porque os impressos não têm todos o mesmo
   * público: pedido de exame, receita de óculos e laudo passam pela recepção,
   * que entrega o papel; orçamento e prontuário incluem o financeiro. Unificar
   * num conjunto só era o caminho fácil e teria tirado acesso de quem trabalha
   * com o documento hoje. O guard existe para centralizar as REGRAS, não para
   * apagar diferenças legítimas entre documentos.
   */
  roles?: Parameters<typeof requireRole>[0]
  /** Entidade auditada, quando não é o próprio paciente (ex.: id do orçamento). */
  entityId?: string
}): Promise<PrintoutContext> {
  const session = await requireRole(args.roles ?? ['admin', 'profissional_saude'], {
    entity: args.entity,
    entityId: args.entityId ?? args.patientId,
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
    patient = (
      await getPatient(supabase, { tenantId: session.tenantId, patientId: args.patientId })
    ).patient
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

  const config = await readPrintoutFieldConfig(supabase, session.tenantId)
  const issuedOn = todayInClinicTz()

  return {
    tenantId: session.tenantId,
    userId: session.userId,
    userName: session.email ?? 'profissional',
    patient,
    identity: buildPatientIdentity(patient, resolvePrintoutFields(config, args.document), issuedOn),
    documentId: args.document,
    issuedOn,
    supabase,
  }
}

/**
 * Configuração de campos da clínica (0195).
 *
 * Falha de leitura NÃO derruba a emissão: cai no padrão do catálogo. Um erro na
 * tabela de configuração não é motivo para a profissional ficar sem o documento
 * na frente do paciente — no pior caso o impresso sai com a identificação
 * padrão, que é exatamente o que ele trazia antes desta feature existir.
 */
async function readPrintoutFieldConfig(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  tenantId: string,
): Promise<PrintoutFieldConfig | null> {
  const { data, error } = await supabase
    .from('tenant_clinic_profile')
    .select('printout_patient_fields, printout_patient_field_overrides')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error || !data) return null

  const row = data as unknown as {
    printout_patient_fields: string[] | null
    printout_patient_field_overrides: Record<string, string[]> | null
  }
  return {
    fields: row.printout_patient_fields ?? [],
    overrides: row.printout_patient_field_overrides ?? {},
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

/**
 * Registra a emissão na trilha de auditoria (Princípio II).
 *
 * O nome do documento vem do contexto, não de um argumento solto: era possível
 * auditar "plano-alimentar" numa rota que imprimia outra coisa, e a trilha de
 * quem viu PII de paciente não é lugar para divergência de digitação.
 */
export async function auditPrintout(ctx: PrintoutContext): Promise<void> {
  await ctx.supabase.rpc(
    'log_audit_event' as never,
    {
      p_tenant_id: ctx.tenantId,
      p_entity: 'patient_printouts',
      p_entity_id: ctx.patient.id,
      p_field: 'emitido',
      p_old: null,
      p_new: ctx.documentId,
      p_reason: `impresso ${ctx.documentId} gerado`,
    } as never,
  )
}
