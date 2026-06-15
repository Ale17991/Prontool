'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { UF_CODES } from '@/lib/core/clinic-profile/types'

/**
 * LUGAR ÚNICO dos dados de conselho + prescritor do médico: tipo do conselho,
 * número, UF, CPF e nascimento. Fonte de verdade do cabeçalho E da prescrição
 * digital (Memed) — evita o desencontro entre o `crm` legado e os campos
 * estruturados. Admin-only (a página só renderiza com `doctor.write`).
 */

const COUNCIL_OPTIONS = ['CRM', 'CRO', 'CRF', 'CRN', 'CREFITO', 'CRP', 'CRBM', 'COREN', 'CRMV', 'CRFa'] as const

export function EditPrescriberFields({
  doctorId,
  currentCouncilName,
  currentCouncilNumber,
  currentCpf,
  currentCouncilState,
  currentBirthDate,
}: {
  doctorId: string
  currentCouncilName: string | null
  currentCouncilNumber: string | null
  currentCpf: string | null
  currentCouncilState: string | null
  currentBirthDate: string | null
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [councilName, setCouncilName] = useState(currentCouncilName ?? 'CRM')
  const [councilNumber, setCouncilNumber] = useState(currentCouncilNumber ?? '')
  const [cpf, setCpf] = useState(currentCpf ?? '')
  const [councilState, setCouncilState] = useState(currentCouncilState ?? '')
  const [birthDate, setBirthDate] = useState(currentBirthDate ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const complete = Boolean(
    currentCpf && currentCouncilName && currentCouncilNumber && currentCouncilState && currentBirthDate,
  )

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
          council_name: councilName.trim() || null,
          council_number: councilNumber.trim() || null,
          council_state: councilState || null,
          cpf: cpfDigits || null,
          birth_date: birthDate || null,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
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
    const conselho =
      currentCouncilName && currentCouncilNumber
        ? `${currentCouncilName}${currentCouncilState ? `/${currentCouncilState}` : ''} ${currentCouncilNumber}`
        : '—'
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Conselho" value={conselho} />
          <Field label="CPF" value={formatCpf(currentCpf)} />
          <Field label="UF do conselho" value={currentCouncilState ?? '—'} />
          <Field label="Nascimento" value={formatBirthDate(currentBirthDate)} />
        </div>
        {!complete ? (
          <p className="text-[11px] text-amber-600">
            Dados incompletos para prescrição digital. Preencha conselho (tipo + número), UF, CPF e
            data de nascimento.
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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="presc-council-name" className="text-xs">Conselho</Label>
          <select
            id="presc-council-name"
            value={councilName}
            onChange={(e) => setCouncilName(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {COUNCIL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="presc-council-number" className="text-xs">Número do conselho</Label>
          <Input
            id="presc-council-number"
            inputMode="numeric"
            maxLength={20}
            value={councilNumber}
            onChange={(e) => setCouncilNumber(e.target.value)}
            placeholder="Ex.: 456789"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="presc-uf" className="text-xs">UF do conselho</Label>
          <select
            id="presc-uf"
            value={councilState}
            onChange={(e) => setCouncilState(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">—</option>
            {UF_CODES.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="presc-cpf" className="text-xs">CPF</Label>
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
          <Label htmlFor="presc-birth" className="text-xs">Data de nascimento</Label>
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
            setCouncilName(currentCouncilName ?? 'CRM')
            setCouncilNumber(currentCouncilNumber ?? '')
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
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
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
