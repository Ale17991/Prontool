import { redirect } from 'next/navigation'
import { Boxes } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { listMaterials } from '@/lib/core/materials-catalog'
import { MateriaisTable, type MaterialListItem } from './materiais-table'

/**
 * Feature 045 US4 — gestão do catálogo de insumos (admin/financeiro).
 * Lista inclusive inativos; permite criar, editar custo/nome e desativar.
 * Desativar preserva o histórico (usos passados mantêm o snapshot de custo).
 */
export const dynamic = 'force-dynamic'

export default async function MateriaisConfigPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'financeiro') {
    redirect('/configuracoes')
  }

  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const materials = await listMaterials(supabase, {
    tenantId: session.tenantId,
    includeInactive: true,
  })
  const items: MaterialListItem[] = materials.map((m) => ({
    id: m.id,
    name: m.name,
    unit_cost_cents: m.unitCostCents,
    tuss_code: m.tussCode,
    active: m.active,
  }))

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Boxes className="h-6 w-6 text-teal-600" />
          Materiais / Insumos
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Catálogo de insumos e seus custos. O custo entra no atendimento como referência e pode
          ser ajustado por lançamento — mudanças aqui não alteram atendimentos já registrados.
        </p>
      </div>

      <MateriaisTable initialItems={items} />
    </div>
  )
}
