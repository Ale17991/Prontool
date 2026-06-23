'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { OdontogramTab } from './odontogram-tab'
import { PlanTab } from '../treatment-plan/plan-tab'

type OdontoSection = 'odontograma' | 'plano'

interface Props {
  patientId: string
  /** Permissão de escrita clínica (marcações no odontograma). */
  canWriteClinical: boolean
  /** Permissão de escrita no plano de tratamento / orçamentos. */
  canWriteTreatment: boolean
}

const SECTIONS: ReadonlyArray<{ key: OdontoSection; label: string }> = [
  { key: 'odontograma', label: 'Odontograma' },
  { key: 'plano', label: 'Plano de tratamento' },
]

/**
 * Odonto-Space — hub das funções exclusivas de odontologia no prontuário.
 * Agrupa o odontograma interativo (Fase 1) e o plano de tratamento +
 * orçamentos (Fase 2) numa única aba, com sub-navegação interna. Novas
 * funções odonto-exclusivas entram aqui como novas seções.
 */
export function OdontoSpace({ patientId, canWriteClinical, canWriteTreatment }: Props) {
  const [section, setSection] = useState<OdontoSection>('odontograma')

  return (
    <div className="space-y-4">
      <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 text-xs">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={cn(
              'px-4 py-1.5 font-medium transition',
              section === s.key
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'odontograma' ? (
        <OdontogramTab patientId={patientId} canWrite={canWriteClinical} />
      ) : (
        <PlanTab patientId={patientId} canWrite={canWriteTreatment} />
      )}
    </div>
  )
}
