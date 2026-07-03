'use client'

import { Heart, NotebookPen, Printer, Stethoscope } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuickViewPermissions, SheetKind } from '@/lib/core/patient-timeline'

interface Props {
  permissions: QuickViewPermissions
  onOpenSheet: (sheet: SheetKind) => void
  onPrint: () => void
}

/**
 * Barra fixa no rodapé para viewports <md. Botões respeitam RBAC do
 * usuário logado. Padding inferior usa safe-area-inset para iPhone com
 * home indicator.
 */
export function MobileActionBar({ permissions, onOpenSheet, onPrint }: Props) {
  const actions: Array<{ icon: typeof Heart; label: string; onClick: () => void; show: boolean }> =
    [
      {
        icon: NotebookPen,
        label: 'Evolução',
        onClick: () => onOpenSheet('new-evolution'),
        show: permissions.canCreateEvolution,
      },
      {
        icon: Stethoscope,
        label: 'Diagnóstico',
        onClick: () => onOpenSheet('new-diagnosis'),
        show: permissions.canCreateDiagnosis,
      },
      {
        icon: Heart,
        label: 'Vital',
        onClick: () => onOpenSheet('new-vital'),
        show: permissions.canCreateVital,
      },
      {
        icon: Printer,
        label: 'Imprimir',
        onClick: onPrint,
        show: permissions.canPrint,
      },
    ]

  const visible = actions.filter((a) => a.show)
  if (visible.length === 0) return null

  return (
    <div
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-card shadow-[0_-4px_12px_rgba(15,23,42,0.06)]',
        'md:hidden',
      )}
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="grid grid-flow-col auto-cols-fr">
        {visible.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={a.onClick}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-bold text-slate-700',
              'focus-visible:outline-none focus-visible:bg-slate-100',
              'active:bg-slate-100',
            )}
            aria-label={a.label}
          >
            <a.icon className="h-4 w-4" />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
