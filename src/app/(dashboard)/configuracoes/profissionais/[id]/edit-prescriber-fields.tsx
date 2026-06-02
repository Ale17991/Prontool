'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { UF_CODES } from '@/lib/core/clinic-profile/types'

/**
 * Edita os campos do prescritor exigidos pela integração de prescrição
 * digital (Memed): CPF, UF do conselho e data de nascimento. Admin-only
 * (a página só renderiza quando `doctor.write`). Permite preencher esses
 * dados em profissionais cadastrados antes da migration 0107.
 */
export function EditPrescriberFields({
  doctorId,
  currentCpf,
  currentCouncilState,
  currentBirthDate,
}: {
  doctorId: string
  currentCpf: string | null
  currentCouncilState: string | null
  currentBirthDate: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [cpf, setCpf] = useState(currentCpf ?? '')
  const [councilState, setCouncilState] = useState(currentCouncilState ?? '')
  const [birthDate, setBirthDate] = useState(currentBirthDate ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const complete = Boolean(currentCpf && currentCouncilState && currentBirthDate)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    const cpfDigits = cpf.replace(/\D/g, '')
    if (cpfDigits.length > 0 && cpfDigits.length !== 11) {
      setError('CPF deve ter 11 dígitos quando preenchido (ou deixe em branco).')
      return
    }

    setPending(true)
    try {
      const res = await fetch(`/api/medicos/${doctorId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cpf: cpfDigits || null,
          council_state: councilState || null,
          birth_date: birthDate || null,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      setEditing(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  if (!editing) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Field label="CPF" value={formatCpf(currentCpf)} />
          <Field label="UF do conselho" value={currentCouncilState ?? '—'} />
          <Field label="Nascimento" value={formatBirthDate(currentBirthDate)} />
        </div>
        {!complete ? (
          <p className="text-[11px] text-amber-600">
            Dados incompletos para prescrição digital (Memed). Preencha CPF, UF do
            conselho e data de nascimento.
          </p>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditing(true)}
          className="border-slate-200"
        >
          <Pencil className="mr-1 h-3 w-3" />
          Editar dados de prescrição
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="presc-cpf" className="text-xs">
            CPF
          </Label>
          <Input
            id="presc-cpf"
            inputMode="numeric"
            maxLength={14}
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="presc-uf" className="text-xs">
            UF do conselho
          </Label>
          <select
            id="presc-uf"
            value={councilState}
            onChange={(e) => setCouncilState(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">—</option>
            {UF_CODES.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="presc-birth" className="text-xs">
            Data de nascimento
          </Label>
          <Input
            id="presc-birth"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setEditing(false)
            setCpf(currentCpf ?? '')
            setCouncilState(currentCouncilState ?? '')
            setBirthDate(currentBirthDate ?? '')
            setError(null)
          }}
        >
          Cancelar
        </Button>
      </div>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </form>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
        {label}
      </p>
      <p className="font-medium text-slate-800">{value}</p>
    </div>
  )
}

function formatCpf(value: string | null): string {
  if (!value) return '—'
  const d = value.replace(/\D/g, '')
  if (d.length !== 11) return value
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
}

function formatBirthDate(value: string | null): string {
  if (!value) return '—'
  const [y, m, d] = value.split('-')
  if (!y || !m || !d) return value
  return `${d}/${m}/${y}`
}
