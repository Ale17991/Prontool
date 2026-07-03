'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { percentToBps } from '@/lib/validation/rate-bps'

interface EditTaxFormProps {
  id: string
  name: string
  initialRatePercent: string
  initialDescription: string | null
  onClose: () => void
}

export function EditTaxForm(props: EditTaxFormProps) {
  const router = useRouter()
  const [ratePercent, setRatePercent] = useState(props.initialRatePercent)
  const [description, setDescription] = useState(props.initialDescription ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)

    let rateBps: number
    try {
      rateBps = percentToBps(ratePercent)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Alíquota inválida.')
      return
    }

    setPending(true)
    try {
      const res = await fetch(`/api/impostos/${props.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          rate_bps: rateBps,
          description: description.trim() || null,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      router.refresh()
      props.onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? props.onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar imposto</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome (imutável)</Label>
            <Input value={props.name} disabled readOnly />
            <p className="text-[10px] text-slate-500">
              Nome e categoria não podem ser alterados (integridade da auditoria). Para corrigir o
              nome, desative este imposto e cadastre outro.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-tax-rate" className="text-xs">
              Alíquota (%)
            </Label>
            <Input
              id="edit-tax-rate"
              required
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              placeholder="Ex.: 5,50"
              inputMode="decimal"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-tax-desc" className="text-xs">
              Descrição
            </Label>
            <Textarea
              id="edit-tax-desc"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={props.onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || ratePercent.trim().length === 0}>
              {pending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>

          {error ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  )
}
