'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ROLE_OPTIONS = [
  'Médico',
  'Dentista',
  'Fisioterapeuta',
  'Psicólogo',
  'Nutricionista',
  'Fonoaudiólogo',
  'Terapeuta Ocupacional',
  'Enfermeiro',
  'Outro',
] as const

const COUNCIL_OPTIONS = [
  'CRM',
  'CRO',
  'CREFITO',
  'CFP',
  'CRN',
  'CRFa',
  'COREN',
  'Outro',
] as const

export function NewDoctorForm() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<(typeof ROLE_OPTIONS)[number]>('Médico')
  const [specialty, setSpecialty] = useState('')
  const [councilName, setCouncilName] = useState<(typeof COUNCIL_OPTIONS)[number]>('CRM')
  const [councilNumber, setCouncilNumber] = useState('')
  const [externalId, setExternalId] = useState('')
  const [percentStr, setPercentStr] = useState('')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('Comissão inicial')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    const bps = toBps(percentStr)
    if (bps === null) {
      setError('Comissão deve ser um percentual válido (ex.: 40 ou 37,5).')
      return
    }
    setPending(true)
    try {
      const res = await fetch('/api/medicos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          // Nº de Registro entra em ambas as colunas: crm (legado, usado pelo
          // webhook GHL e pela UNIQUE constraint por tenant) e council_number
          // (nova, canônica). Dual-write preserva backward-compat.
          crm: councilNumber.trim(),
          council_number: councilNumber.trim(),
          council_name: councilName,
          role,
          specialty: specialty.trim() || null,
          external_identifier: externalId.trim() || null,
          initial_percentage_bps: bps,
          initial_valid_from: validFrom,
          initial_reason: reason.trim(),
        }),
      })
      if (res.status === 409) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(payload.error?.message ?? 'Nº de registro já cadastrado neste tenant.')
        return
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      const created = (await res.json()) as { full_name: string }
      setSuccess(`Profissional ${created.full_name} cadastrado.`)
      setFullName('')
      setCouncilNumber('')
      setSpecialty('')
      setExternalId('')
      setPercentStr('')
      setReason('Comissão inicial')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="full-name" className="text-xs">
          Nome completo
        </Label>
        <Input
          id="full-name"
          required
          minLength={1}
          maxLength={200}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Ex.: Ana Silva"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="role" className="text-xs">
            Função
          </Label>
          <select
            id="role"
            required
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="specialty" className="text-xs">
            Especialidade <span className="text-slate-400">(opcional)</span>
          </Label>
          <Input
            id="specialty"
            maxLength={120}
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            placeholder="Ex.: Ortopedia, Endodontia"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="council-name" className="text-xs">
            Conselho
          </Label>
          <select
            id="council-name"
            required
            value={councilName}
            onChange={(e) => setCouncilName(e.target.value as typeof councilName)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {COUNCIL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="council-number" className="text-xs">
            Nº de Registro
          </Label>
          <Input
            id="council-number"
            required
            minLength={1}
            maxLength={50}
            value={councilNumber}
            onChange={(e) => setCouncilNumber(e.target.value)}
            placeholder="Ex.: 123456-SP"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="external-id" className="text-xs">
          Identificador externo <span className="text-slate-400">(GHL, opcional)</span>
        </Label>
        <Input
          id="external-id"
          maxLength={120}
          value={externalId}
          onChange={(e) => setExternalId(e.target.value)}
          placeholder="custom field do GHL"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="percent" className="text-xs">
            Comissão inicial (%)
          </Label>
          <Input
            id="percent"
            required
            inputMode="decimal"
            value={percentStr}
            onChange={(e) => setPercentStr(e.target.value)}
            placeholder="40"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="valid-from" className="text-xs">
            Vigência a partir de
          </Label>
          <Input
            id="valid-from"
            required
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="reason" className="text-xs">
          Motivo
        </Label>
        <Input
          id="reason"
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? 'Salvando…' : 'Cadastrar profissional'}
      </Button>

      {error ? (
        <p className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-xs font-medium text-emerald-700">
          {success}
        </p>
      ) : null}
    </form>
  )
}

function toBps(input: string): number | null {
  const cleaned = input.trim().replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (Number.isNaN(value) || value < 0 || value > 100) return null
  return Math.round(value * 100)
}
