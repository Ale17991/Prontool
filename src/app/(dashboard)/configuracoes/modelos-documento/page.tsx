import { redirect } from 'next/navigation'
import { FileText } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listTemplates } from '@/lib/core/document-templates/crud'
import { TemplatesManager, type TemplateDTO } from './templates-manager'

export const dynamic = 'force-dynamic'

export default async function ModelosDocumentoPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'profissional_saude') {
    redirect('/operacao/atendimentos')
  }

  const supabase = createSupabaseServiceClient()
  const templates = (await listTemplates(supabase, { tenantId: session.tenantId })) as TemplateDTO[]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <FileText className="h-6 w-6 text-primary" />
          Modelos de documento
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Modelos reutilizáveis (atestado, declaração, receita) com variáveis do paciente e
          parâmetros de impressão. Usados ao emitir documentos na ficha do paciente.
        </p>
      </div>
      <TemplatesManager initial={templates} />
    </div>
  )
}
