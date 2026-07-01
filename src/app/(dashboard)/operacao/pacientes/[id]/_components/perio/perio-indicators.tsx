'use client'

import type { PerioIndicators } from '@/lib/core/dental/perio/sites'

/** Painel dos indicadores periodontais (BOP%, bolsas ≥4mm, CAL médio). */
export function PerioIndicatorsPanel({ indicators }: { indicators: PerioIndicators }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat
        label="Sangramento (BOP)"
        value={`${indicators.bopPct}%`}
        hint={`${indicators.sitesBleeding}/${indicators.sitesMeasured} sítios`}
      />
      <Stat
        label="Bolsas ≥4mm"
        value={String(indicators.pocketsGe4)}
        hint={`${indicators.pocketsGe4Pct}%`}
      />
      <Stat
        label="CAL médio"
        value={indicators.calAvgMm === null ? '—' : `${indicators.calAvgMm} mm`}
      />
      <Stat label="Sítios medidos" value={String(indicators.sitesMeasured)} />
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-lg font-bold text-slate-900">{value}</div>
      {hint ? <div className="text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  )
}
