import { redirect } from 'next/navigation'
import { Apple } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { listFoodGroups } from '@/lib/core/nutrition/foods/equivalence'
import { FoodsCatalogClient } from './foods-catalog-client'
import { EquivalenceListsClient } from './equivalence-lists-client'

/**
 * Feature 047 US1 — base de alimentos (gated por `dieta`).
 * Busca no catálogo global + cadastro dos alimentos próprios da clínica.
 */
export const dynamic = 'force-dynamic'

export default async function AlimentosConfigPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin' && session.role !== 'profissional_saude') {
    redirect('/configuracoes')
  }

  const supabase = createSupabaseServiceClient()
  const ent = await getTenantEntitlements(supabase, session.tenantId)
  if (!ent.hasModule('dieta')) redirect('/configuracoes')

  const groups = await listFoodGroups(supabase)

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Apple className="h-6 w-6 text-primary" /> Alimentos
        </h1>
        <p className="text-sm text-slate-500">
          Base de alimentos para montar os planos alimentares — consulte o catálogo e cadastre os
          alimentos próprios da clínica (marcas, porções, medidas caseiras).
        </p>
      </div>

      <FoodsCatalogClient groups={groups.map((g) => ({ slug: g.slug, label: g.label }))} />

      <EquivalenceListsClient groups={groups.map((g) => ({ slug: g.slug, label: g.label }))} />

      <p className="text-[11px] leading-snug text-slate-400">
        Fontes da base pronta: Tabela Brasileira de Composição de Alimentos — TACO, 4ª ed.,
        NEPA/UNICAMP, 2011; e IBGE, Pesquisa de Orçamentos Familiares (POF) 2008-2009.
      </p>
    </div>
  )
}
