'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function NewCommissionForm({ doctorId }: { doctorId: string }) {
  const router = useRouter()
  const [percentStr, setPercentStr] = useState('')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const bps = toBps(percentStr)
    if (bps === null) {
      setError('Informe um percentual válido (0–100, ex.: 42,5).')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/medicos/${doctorId}/commission`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          percentage_bps: bps,
          valid_from: validFrom,
          reason: reason.trim(),
        }),
      })
      if (res.status === 409) {
        setError(
          `Já existe uma mudança de comissão registrada em ${validFrom}. Escolha outra data.`,
        )
        return
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      setPercentStr('')
      setReason('')
      setValidFrom(new Date().toISOString().slice(0, 10))
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="commission-percent" className="text-xs">
            Novo percentual (%)
          </Label>
          <Input
            id="commission-percent"
            required
            inputMode="decimal"
            placeholder="45"
            value={percentStr}
            onChange={(e) => setPercentStr(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="commission-valid-from" className="text-xs">
            Vigência a partir de
          </Label>
          <Input
            id="commission-valid-from"
            required
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="commission-reason" className="text-xs">
          Motivo
        </Label>
        <Textarea
          id="commission-reason"
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: Renegociação de contrato, reajuste anual, desligamento…"
          className="min-h-[80px]"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? 'Salvando…' : 'Registrar nova comissão'}
      </Button>

      {error ? (
        <p className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs font-medium text-rose-700">
          {error}
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
