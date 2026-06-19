import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listAllStatuses } from '@/lib/core/dental/status-catalog/list'
import { StatusCatalogTable } from './status-table'

export const dynamic = 'force-dynamic'

/**
 * Feature 039 (US2) — gestão do catálogo GLOBAL de status do odontograma.
 * Só super-admin (gate no layout /admin). Mudanças valem para todas as clínicas.
 */
export default async function StatusOdontologicosPage() {
  const sb = createSupabaseServiceClient()
  const items = await listAllStatuses(sb)

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-black tracking-tight text-slate-900">
          Status odontológicos
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Catálogo global usado pelo odontograma de todas as clínicas. Defina rótulo, cor,
          escopo (dente ou face) e, opcionalmente, o código TUSS (tabela 22). Desativar um
          status o esconde de novas marcações sem afetar o histórico.
        </p>
      </div>
      <StatusCatalogTable items={items} />
    </div>
  )
}
