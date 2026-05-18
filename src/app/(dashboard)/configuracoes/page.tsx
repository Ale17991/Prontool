import { redirect } from 'next/navigation'
import { Settings } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { listFeatureFlags } from '@/lib/feature-flags'
import { getVisibleHubCards } from './_cards'
import { HubCard } from './_components/hub-card'

/**
 * Feature 014 — US3 — hub central de configurações.
 *
 * Substitui o redirect role-based anterior (admin → clinica; outros →
 * perfil) por um grid de cards filtrados por RBAC + feature-flags. A
 * filtragem é feita no servidor: cards proibidos jamais chegam ao DOM
 * (FR-017, sem flash de UI sensível).
 *
 * Ordem dos cards é a do array HUB_CARDS em _cards.ts (Auditoria sempre
 * por último — FR-009).
 */

export const dynamic = 'force-dynamic'

export default async function ConfiguracoesPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const flags = listFeatureFlags()
  const cards = getVisibleHubCards({ role: session.role, flags })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <Settings className="h-6 w-6 text-primary" />
          Configurações
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          {cards.length} áre{cards.length === 1 ? 'a' : 'as'} disponíve
          {cards.length === 1 ? 'l' : 'is'} para você.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <HubCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  )
}
