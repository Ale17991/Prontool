'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Link2, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Vincula o profissional a uma conta de login (doctors.user_id) — é o que
 * permite o usuário operar/prescrever como este médico. Funciona depois de
 * criados (profissional e usuário). Um usuário só serve a UM profissional.
 */
export interface LinkUserOption {
  userId: string
  label: string
  email: string
  /** Nome do médico ao qual este usuário JÁ está vinculado (se outro). */
  linkedToOther: string | null
}

export function LinkUserPanel({
  doctorId,
  currentUserId,
  options,
}: {
  doctorId: string
  currentUserId: string | null
  options: LinkUserOption[]
}) {
  const router = useRouter()
  const [value, setValue] = useState(currentUserId ?? '')
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = (value || null) !== (currentUserId ?? null)

  function save() {
    setError(null)
    setSaved(false)
    start(async () => {
      try {
        const res = await fetch(`/api/medicos/${doctorId}/usuario`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ user_id: value || null }),
        })
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          setError(b.error?.message ?? 'Falha ao vincular.')
          return
        }
        setSaved(true)
        router.refresh()
      } catch {
        setError('Erro de rede.')
      }
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Vincule este profissional a uma conta de login para ele acessar o sistema e prescrever como
        este médico. Pode ser feito a qualquer momento.
      </p>
      {options.length === 0 ? (
        <p className="text-[11px] text-amber-600">
          Nenhum usuário na clínica ainda. Crie em Configurações → Usuários e volte aqui.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setSaved(false)
            }}
            className="h-9 min-w-[18rem] flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">— sem usuário vinculado —</option>
            {options.map((o) => {
              const blocked = Boolean(o.linkedToOther) && o.userId !== currentUserId
              return (
                <option key={o.userId} value={o.userId} disabled={blocked}>
                  {o.label} ({o.email})
                  {blocked ? ` — já vinculado a ${o.linkedToOther}` : ''}
                </option>
              )
            })}
          </select>
          <Button size="sm" onClick={save} disabled={pending || !dirty}>
            {pending ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : saved ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Link2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            {value ? 'Vincular' : 'Desvincular'}
          </Button>
        </div>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
