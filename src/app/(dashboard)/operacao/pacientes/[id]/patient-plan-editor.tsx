'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Pencil, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface HealthPlanOption {
  id: string
  name: string
}

interface Props {
  patientId: string
  currentPlanId: string | null
  currentPlanName: string | null
  healthPlans: HealthPlanOption[]
  canEdit: boolean
}

export function PatientPlanEditor({
  patientId,
  currentPlanId,
  currentPlanName,
  healthPlans,
  canEdit,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string>(currentPlanId ?? '')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    const res = await fetch(`/api/pacientes/${patientId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        plan_id: selected === '' || selected === '__none__' ? null : selected,
      }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      setError(body.error?.message ?? 'Falha ao atualizar plano.')
      return
    }
    setEditing(false)
    startTransition(() => router.refresh())
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        {currentPlanId ? (
          <Badge variant="secondary" className="text-xs">
            {currentPlanName ?? currentPlanId}
          </Badge>
        ) : (
          <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
            Sem plano
          </Badge>
        )}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700"
            title="Editar plano de saúde"
          >
            <Pencil className="h-3 w-3" /> Editar
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={selected || '__none__'} onValueChange={setSelected}>
        <SelectTrigger className="h-8 w-56 text-xs">
          <SelectValue placeholder="Selecione…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Sem plano (particular)</SelectItem>
          {healthPlans.map((hp) => (
            <SelectItem key={hp.id} value={hp.id}>
              {hp.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {healthPlans.length === 0 ? (
        <Link
          href="/configuracoes/convenios"
          className="text-[10px] font-semibold text-amber-700 underline"
        >
          Cadastrar plano
        </Link>
      ) : null}
      <button
        type="button"
        onClick={save}
        disabled={isPending}
        className="inline-flex h-8 items-center gap-1 rounded-md bg-slate-900 px-2 text-[11px] font-bold text-white hover:bg-slate-800 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        Salvar
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false)
          setSelected(currentPlanId ?? '')
          setError(null)
        }}
        className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
      >
        <X className="h-3 w-3" />
      </button>
      {error ? <p className="text-[11px] font-semibold text-rose-700">{error}</p> : null}
    </div>
  )
}
