import { Plug } from 'lucide-react'

export interface SidebarIntegrationBadgeItem {
  provider: string
  label: string
}

/**
 * Renders zero-or-more connected integration pills at the sidebar footer.
 * Standalone tenants (empty array) render null — FR-003 (no integration
 * mention anywhere in standalone UI).
 */
export function SidebarIntegrationsBadge({
  integrations,
}: {
  integrations: SidebarIntegrationBadgeItem[]
}) {
  if (integrations.length === 0) return null

  if (integrations.length >= 4) {
    return (
      <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-[11px] font-semibold text-emerald-200">
        <Plug className="h-3 w-3" aria-hidden />
        <span>{integrations.length} integrações conectadas</span>
      </div>
    )
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {integrations.map((i) => (
        <span
          key={i.provider}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200"
          title={`${i.label} conectado`}
        >
          <Plug className="h-2.5 w-2.5" aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  )
}
