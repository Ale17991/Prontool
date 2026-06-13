'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PatientQuickView } from './patient-quick-view'
import type {
  QuickViewSnapshot,
  SheetKind,
} from '@/lib/core/patient-timeline'

interface Props {
  patientId: string
  snapshot: QuickViewSnapshot
  onOpenSheet: (sheet: SheetKind) => void
  onSwitchToCadastro: () => void
  onPrint: () => void
  canViewFinancialValues: boolean
}

/**
 * Header compacto para viewports <md. Mostra avatar+nome+idade e um
 * indicador vermelho quando há alergia grave. Expande revelando a
 * <PatientQuickView /> completa inline.
 */
export function MobileQuickViewHeader({
  patientId,
  snapshot,
  onOpenSheet,
  onSwitchToCadastro,
  onPrint,
  canViewFinancialValues,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const { identity, allergies } = snapshot
  const hasGraveAllergy = allergies.some((a) => a.severity === 'grave')
  const initial = (identity.fullName || '?').charAt(0).toUpperCase()

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="mobile-quick-view-body"
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-card p-3 text-left shadow-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-base font-black text-white">
          {identity.isAnonymized ? <User className="h-4 w-4" /> : initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-black text-slate-900">
            {identity.isAnonymized ? '[anonimizado]' : identity.fullName || '—'}
          </p>
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
            {identity.ageYears !== null
              ? `${identity.ageYears} anos`
              : 'Detalhes do paciente'}
          </p>
        </div>
        {hasGraveAllergy && !identity.isAnonymized ? (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-[hsl(var(--alert)/0.15)] px-2 py-1 text-[10px] font-bold text-[hsl(var(--alert))]"
            role="status"
            aria-label="Atenção: paciente com alergia grave"
          >
            <AlertTriangle className="h-3 w-3" />
            Alergia grave
          </span>
        ) : null}
        <span className="shrink-0 text-slate-400">
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </span>
      </button>

      {expanded ? (
        <div id="mobile-quick-view-body" className="mt-3">
          <PatientQuickView
            patientId={patientId}
            snapshot={snapshot}
            onOpenSheet={(s) => {
              setExpanded(false)
              onOpenSheet(s)
            }}
            onSwitchToCadastro={() => {
              setExpanded(false)
              onSwitchToCadastro()
            }}
            onPrint={() => {
              setExpanded(false)
              onPrint()
            }}
            canViewFinancialValues={canViewFinancialValues}
          />
        </div>
      ) : null}
    </div>
  )
}
