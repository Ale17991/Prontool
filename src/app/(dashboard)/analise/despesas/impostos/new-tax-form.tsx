'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { percentToBps } from '@/lib/validation/rate-bps'

type Category = 'municipal' | 'estadual' | 'federal' | 'outro'

export function NewTaxForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [ratePercent, setRatePercent] = useState('')
  const [category, setCategory] = useState<Category>('municipal')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    let rateBps: number
    try {
      rateBps = percentToBps(ratePercent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Alíquota inválida.')
      return
    }

    setPending(true)
    try {
      const res = await fetch('/api/impostos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          rate_bps: rateBps,
          category,
          description: description.trim() || null,
        }),
      })
      if (res.status === 409) {
        setError(`Já existe um imposto com o nome "${name.trim()}".`)
        return
      }
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      setSuccess(`Imposto "${name.trim()}" cadastrado.`)
      setName('')
      setRatePercent('')
      setCategory('municipal')
      setDescription('')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="tax-name" className="text-xs">
          Nome
        </Label>
        <Input
          id="tax-name"
          required
          minLength={1}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex.: ISS, IRPJ, CSLL"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tax-rate" className="text-xs">
          Alíquota (%)
        </Label>
        <Input
          id="tax-rate"
          required
          value={ratePercent}
          onChange={(e) => setRatePercent(e.target.value)}
          placeholder="Ex.: 5,00"
          inputMode="decimal"
        />
        <p className="text-[10px] text-slate-500">
          Use vírgula para decimal (ex.: 5,00). Máximo 100%.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tax-category" className="text-xs">
          Categoria
        </Label>
        <Select
          value={category}
          onValueChange={(v) => setCategory(v as Category)}
        >
          <SelectTrigger id="tax-category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="municipal">Municipal</SelectItem>
            <SelectItem value="estadual">Estadual</SelectItem>
            <SelectItem value="federal">Federal</SelectItem>
            <SelectItem value="outro">Outro</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tax-desc" className="text-xs">
          Descrição (opcional)
        </Label>
        <Textarea
          id="tax-desc"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Ex.: ISS de Curitiba, alíquota base"
        />
      </div>

      <Button
        type="submit"
        disabled={pending || name.trim().length === 0 || ratePercent.trim().length === 0}
        className="w-full"
      >
        {pending ? 'Salvando…' : 'Cadastrar imposto'}
      </Button>

      {error ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-success/30 bg-success-bg p-3 text-xs font-medium text-success-text">
          {success}
        </p>
      ) : null}
    </form>
  )
}
