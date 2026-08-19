import { redirect } from 'next/navigation'
import { Printer } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPrintoutConfig } from '@/lib/core/printouts/config'
import { PRINTOUT_DOCUMENTS, PRINTOUT_PATIENT_FIELDS } from '@/lib/core/printouts/fields'
import { PrintoutFieldsManager } from './printout-fields-manager'
import { BackLink } from '@/components/ui/back-link'

export const dynamic = 'force-dynamic'

export default async function ImpressosPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/operacao/atendimentos')

  const supabase = createSupabaseServiceClient()
  const config = await getPrintoutConfig(supabase, session.tenantId)

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/configuracoes" className="mb-2">
          Voltar às configurações
        </BackLink>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Printer className="h-6 w-6 text-primary" />
          Impressos
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Quais dados do paciente aparecem nos documentos que a clínica imprime. O nome sempre
          aparece. Cada campo a mais é um dado do paciente saindo em papel — vale ligar só o que o
          documento realmente precisa.
        </p>
      </div>
      <PrintoutFieldsManager
        initial={config}
        fields={[...PRINTOUT_PATIENT_FIELDS]}
        documents={[...PRINTOUT_DOCUMENTS]}
      />
    </div>
  )
}
