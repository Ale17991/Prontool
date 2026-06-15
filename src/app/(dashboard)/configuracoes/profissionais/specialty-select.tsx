'use client'

import { useEffect, useState } from 'react'

/**
 * Seletor de especialidade — fonte ÚNICA: catálogo PÚBLICO da Memed
 * (/api/integracoes/memed/especialidades). O valor é o NOME da especialidade
 * (gravado em doctors.specialty). Especialidade legada que não está no catálogo
 * é preservada como opção "(atual)" até ser reeditada.
 */
interface Spec {
  id: string
  nome: string
}

export function SpecialtySelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string
  value: string
  onChange: (nome: string) => void
  disabled?: boolean
}) {
  const [specs, setSpecs] = useState<Spec[]>([])

  useEffect(() => {
    let off = false
    fetch('/api/integracoes/memed/especialidades')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { especialidades?: Spec[] }) => {
        if (!off) setSpecs(d.especialidades ?? [])
      })
      .catch(() => {
        /* catálogo indisponível — segue só com o valor atual */
      })
    return () => {
      off = true
    }
  }, [])

  const legacyOutOfCatalog = value !== '' && !specs.some((s) => s.nome === value)

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      <option value="">— sem especialidade —</option>
      {legacyOutOfCatalog ? <option value={value}>{value} (atual)</option> : null}
      {specs.map((s) => (
        <option key={s.id} value={s.nome}>
          {s.nome}
        </option>
      ))}
    </select>
  )
}
