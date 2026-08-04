'use client'

import { useCallback, useEffect, useState } from 'react'
import { RuleForm, type FamilyOption } from './rule-form'
import { RuleList, type RuleRow } from './rule-list'

interface Payload {
  families: FamilyOption[]
  rules: RuleRow[]
}

/**
 * Feature 053 — casca cliente que recarrega a lista depois de cada mudança.
 *
 * Recarrega do servidor em vez de manipular o estado local: a validação e o
 * default do texto vivem no catálogo do servidor, e espelhá-los aqui criaria
 * dois lugares para divergir.
 */
export function RulesClient({ initial }: { initial: Payload }) {
  const [data, setData] = useState<Payload>(initial)

  const recarregar = useCallback(async () => {
    const res = await fetch('/api/notificacoes-automaticas')
    if (!res.ok) return
    setData((await res.json()) as Payload)
  }, [])

  useEffect(() => {
    setData(initial)
  }, [initial])

  return (
    <div className="space-y-6">
      <RuleForm families={data.families} onSaved={recarregar} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Notificações ligadas</h2>
        <RuleList rules={data.rules} families={data.families} onChanged={recarregar} />
      </section>
    </div>
  )
}
