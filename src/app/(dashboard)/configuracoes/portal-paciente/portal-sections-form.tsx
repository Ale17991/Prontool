'use client'

import { useState, useTransition } from 'react'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ResolvedSection } from '@/lib/core/patient-portal/sections'
import { setPortalSectionAction } from './actions'

interface Props {
  initialSections: ResolvedSection[]
}

const SENS_LABEL: Record<ResolvedSection['sensitivity'], { text: string; cls: string } | null> = {
  baixa: null,
  media: { text: 'Sensível', cls: 'bg-amber-50 text-amber-700' },
  alta: { text: 'Sensível — liberar com cautela', cls: 'bg-rose-50 text-rose-700' },
}

export function PortalSectionsForm({ initialSections }: Props) {
  const [sections, setSections] = useState(initialSections)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(key: string, next: boolean) {
    setSections((prev) =>
      prev.map((s) => (s.key === key ? { ...s, enabled: next, clinicOverride: next } : s)),
    )
    startTransition(async () => {
      const res = await setPortalSectionAction(key, next)
      if (!res.ok) {
        setSections((prev) =>
          prev.map((s) => (s.key === key ? { ...s, enabled: !next, clinicOverride: !next } : s)),
        )
        setFeedback({ kind: 'error', message: res.error ?? 'Erro ao atualizar seção.' })
      } else {
        setFeedback({ kind: 'ok', message: 'Seção atualizada.' })
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Seções exibidas ao paciente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-slate-500">
          Escolha o que o paciente vê no portal. Seções sensíveis vêm desligadas por padrão —
          ligue só o que for adequado divulgar. Algumas seções dependem de um módulo do seu plano.
        </p>
        <ul className="divide-y divide-slate-100">
          {sections.map((s) => {
            const sens = SENS_LABEL[s.sensitivity]
            const locked = !s.allowedByPlan
            return (
              <li key={s.key} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    {s.label}
                    {sens ? (
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', sens.cls)}>
                        {sens.text}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-[11px] text-slate-500">{s.description}</p>
                  {locked ? (
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                      Requer o módulo “{s.requiredModule}” no seu plano.
                    </p>
                  ) : null}
                </div>
                <label
                  className={cn(
                    'inline-flex shrink-0 items-center gap-2 text-xs font-medium',
                    locked ? 'cursor-not-allowed text-slate-300' : 'cursor-pointer text-slate-600',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    disabled={pending || locked}
                    onChange={(e) => toggle(s.key, e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-40"
                  />
                  {s.enabled ? 'Visível' : 'Oculta'}
                </label>
              </li>
            )
          })}
        </ul>
        {feedback ? (
          <p
            className={cn(
              'text-xs font-medium',
              feedback.kind === 'ok' ? 'text-success-strong' : 'text-destructive',
            )}
          >
            {feedback.message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
