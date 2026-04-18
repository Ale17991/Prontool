'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function NewDoctorForm() {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [crm, setCrm] = useState('')
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
          crm: crm.trim(),
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
        setError(payload.error?.message ?? 'CRM já cadastrado neste tenant.')
        return
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      const created = (await res.json()) as { full_name: string }
      setSuccess(`Médico ${created.full_name} cadastrado.`)
      setFullName('')
      setCrm('')
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
          placeholder="Ex.: Dr. Silva Medeiros"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="crm" className="text-xs">
            CRM
          </Label>
          <Input
            id="crm"
            required
            minLength={1}
            maxLength={50}
            value={crm}
            onChange={(e) => setCrm(e.target.value)}
            placeholder="Ex.: 123456-SP"
          />
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
        {pending ? 'Salvando…' : 'Cadastrar médico'}
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
