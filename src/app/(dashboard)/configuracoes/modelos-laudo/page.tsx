import { redirect } from 'next/navigation'
import { FileBarChart } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { listExamReportTemplates } from '@/lib/core/exam-report-templates/crud'
import { LaudoTemplatesManager, type LaudoTemplateDTO } from './laudo-templates-manager'

export const dynamic = 'force-dynamic'

export default async function ModelosLaudoPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'profissional_saude') {
    redirect('/operacao/atendimentos')
  }

  const supabase = createSupabaseServiceClient()

  // Modelos de laudo são oftalmológicos (exam_type='oftalmologico') — parte do
  // módulo Oftalmologia. Sem ele, a área não existe.
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (!ent.hasModule('oftalmo')) redirect('/configuracoes')

  const templates = (await listExamReportTemplates(supabase, {
    tenantId: session.tenantId,
  })) as LaudoTemplateDTO[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <FileBarChart className="h-6 w-6 text-primary" />
          Modelos de laudo
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Modelos pré-estabelecidos de laudo de exame (cabeçalho, conclusão e rodapé com variáveis
          do exame e do paciente). O modelo padrão é aplicado ao gerar o PDF do exame na ficha.
        </p>
      </div>
      <LaudoTemplatesManager initial={templates} />
    </div>
  )
}
