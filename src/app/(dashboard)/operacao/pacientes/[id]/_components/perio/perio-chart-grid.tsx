'use client'

import { cn } from '@/lib/utils'
import { quadrantLayout, type Dentition } from '@/lib/core/dental/teeth'
import {
  BUCCAL_SITES,
  LINGUAL_SITES,
  calcCal,
  siteLabel,
  type PerioSite,
} from '@/lib/core/dental/perio/sites'

export interface SiteCell {
  probingDepthMm: number | null
  recessionMm: number | null
  bleeding: boolean
  suppuration: boolean
  plaque: boolean
}

export interface ToothFinding {
  mobility: number | null
  furcation: number | null
  isMissing: boolean
  isImplant: boolean
}

interface Props {
  dentition: Dentition
  /** Medições por chave `tooth:site`. */
  measurements: Record<string, SiteCell>
  /** Achados por dente (chave = tooth_fdi). */
  findings: Record<number, ToothFinding>
  readOnly: boolean
  onSite: (toothFdi: number, site: PerioSite, patch: Partial<SiteCell>) => void
  onFinding: (toothFdi: number, patch: Partial<ToothFinding>) => void
}

export function siteKey(toothFdi: number, site: PerioSite): string {
  return `${toothFdi}:${site}`
}

const EMPTY_CELL: SiteCell = {
  probingDepthMm: null,
  recessionMm: null,
  bleeding: false,
  suppuration: false,
  plaque: false,
}

export function PerioChartGrid({
  dentition,
  measurements,
  findings,
  readOnly,
  onSite,
  onFinding,
}: Props) {
  const quadrants = quadrantLayout(dentition)
  // Arcadas: superior (quadrantes 1,2) e inferior (4,3) — ordem de quadrantLayout.
  const upper = quadrants.filter(
    (q) => q.quadrant === 1 || q.quadrant === 2 || q.quadrant === 5 || q.quadrant === 6,
  )
  const lower = quadrants.filter(
    (q) => q.quadrant === 3 || q.quadrant === 4 || q.quadrant === 7 || q.quadrant === 8,
  )

  return (
    <div className="space-y-4">
      <Arch
        label="Arcada superior"
        quadrants={upper}
        {...{ measurements, findings, readOnly, onSite, onFinding }}
      />
      <Arch
        label="Arcada inferior"
        quadrants={lower}
        {...{ measurements, findings, readOnly, onSite, onFinding }}
      />
    </div>
  )
}

function Arch({
  label,
  quadrants,
  measurements,
  findings,
  readOnly,
  onSite,
  onFinding,
}: {
  label: string
  quadrants: ReadonlyArray<{ quadrant: number; teeth: number[] }>
} & Omit<Props, 'dentition'>) {
  const teeth = quadrants.flatMap((q) => q.teeth)
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</h4>
      <div className="flex flex-wrap gap-2">
        {teeth.map((t) => (
          <ToothCard
            key={t}
            toothFdi={t}
            finding={
              findings[t] ?? { mobility: null, furcation: null, isMissing: false, isImplant: false }
            }
            measurements={measurements}
            readOnly={readOnly}
            onSite={onSite}
            onFinding={onFinding}
          />
        ))}
      </div>
    </div>
  )
}

function ToothCard({
  toothFdi,
  finding,
  measurements,
  readOnly,
  onSite,
  onFinding,
}: {
  toothFdi: number
  finding: ToothFinding
} & Omit<Props, 'dentition' | 'findings'>) {
  const disabled = readOnly || finding.isMissing
  return (
    <div
      className={cn(
        'w-[148px] rounded-lg border border-slate-200 p-2',
        finding.isMissing && 'bg-slate-50 opacity-70',
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-bold text-slate-800">{toothFdi}</span>
        <div className="flex gap-1 text-[10px]">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onFinding(toothFdi, { isMissing: !finding.isMissing })}
            className={cn(
              'rounded px-1 py-0.5',
              finding.isMissing ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-500',
            )}
            title="Ausente"
          >
            Aus
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => onFinding(toothFdi, { isImplant: !finding.isImplant })}
            className={cn(
              'rounded px-1 py-0.5',
              finding.isImplant ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-500',
            )}
            title="Implante"
          >
            Impl
          </button>
        </div>
      </div>

      <SiteRow label="V" sites={BUCCAL_SITES} {...{ toothFdi, measurements, disabled, onSite }} />
      <SiteRow label="L" sites={LINGUAL_SITES} {...{ toothFdi, measurements, disabled, onSite }} />

      <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
        <label className="flex items-center gap-0.5">
          Mob
          <select
            value={finding.mobility ?? ''}
            disabled={readOnly || finding.isMissing}
            onChange={(e) =>
              onFinding(toothFdi, {
                mobility: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className="rounded border px-0.5"
          >
            <option value="">–</option>
            {[0, 1, 2, 3].map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-0.5">
          Furca
          <select
            value={finding.furcation ?? ''}
            disabled={readOnly || finding.isMissing}
            onChange={(e) =>
              onFinding(toothFdi, {
                furcation: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className="rounded border px-0.5"
          >
            <option value="">–</option>
            <option value={1}>I</option>
            <option value={2}>II</option>
            <option value={3}>III</option>
          </select>
        </label>
      </div>
    </div>
  )
}

function SiteRow({
  label,
  sites,
  toothFdi,
  measurements,
  disabled,
  onSite,
}: {
  label: string
  sites: readonly PerioSite[]
  toothFdi: number
  measurements: Record<string, SiteCell>
  disabled: boolean
  onSite: (toothFdi: number, site: PerioSite, patch: Partial<SiteCell>) => void
}) {
  return (
    <div className="mb-1">
      <div className="grid grid-cols-[14px_repeat(3,1fr)] items-center gap-0.5">
        <span className="text-[9px] font-semibold text-slate-400">{label}</span>
        {sites.map((s) => {
          const cell = measurements[siteKey(toothFdi, s)] ?? EMPTY_CELL
          const cal = calcCal(cell.probingDepthMm, cell.recessionMm)
          return (
            <div
              key={s}
              className="flex flex-col items-center gap-0.5"
              title={`${siteLabel(s)}${cal !== null ? ` · CAL ${cal}` : ''}`}
            >
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={15}
                disabled={disabled}
                value={cell.probingDepthMm ?? ''}
                onChange={(e) =>
                  onSite(toothFdi, s, {
                    probingDepthMm: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className="w-9 rounded border border-slate-200 px-0.5 py-0.5 text-center text-[11px]"
                placeholder="PS"
              />
              <input
                type="number"
                inputMode="numeric"
                min={-5}
                max={15}
                disabled={disabled}
                value={cell.recessionMm ?? ''}
                onChange={(e) =>
                  onSite(toothFdi, s, {
                    recessionMm: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
                className="w-9 rounded border border-slate-200 px-0.5 py-0.5 text-center text-[11px] text-slate-500"
                placeholder="Rec"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSite(toothFdi, s, { bleeding: !cell.bleeding })}
                className={cn('h-3 w-9 rounded', cell.bleeding ? 'bg-red-500' : 'bg-slate-200')}
                title="Sangramento"
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
