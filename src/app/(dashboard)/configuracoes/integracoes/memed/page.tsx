import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft, Stethoscope } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { getMemedConfigPublic } from '@/lib/core/integrations/memed/get-config-public'
import { isMemedProductionConfigured } from '@/lib/core/integrations/memed/credentials'
import type { Database } from '@/lib/db/types'
import { MemedConnectionForm } from './memed-connection-form'

/**
 * Feature 026 (US2/US5) — tela de conexão da Memed. Admin conecta/desconecta a
 * conta da clínica, alterna ambiente (homologação/produção) e registra o aceite
 * do termo. Nenhuma chave é renderizada — só estado público.
 */
export const dynamic = 'force-dynamic'

export default async function MemedIntegrationPage(): Promise<JSX.Element> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/configuracoes')

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const config = await getMemedConfigPublic(supabase, session.tenantId)
  const productionConfigured = isMemedProductionConfigured()

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/configuracoes/integracoes"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="h-3 w-3" /> Voltar às integrações
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Stethoscope className="h-6 w-6 text-primary" />
          Memed — Prescrição digital
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Conecte a conta Memed da clínica para emitir prescrições digitais. As chaves
          ficam cifradas no servidor e nunca trafegam para o navegador.
        </p>
      </div>

      <MemedConnectionForm initialConfig={config} productionConfigured={productionConfigured} />
    </div>
  )
}
