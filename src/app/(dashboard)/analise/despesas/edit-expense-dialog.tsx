'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface EditExpenseDialogProps {
  expense: {
    id: string
    category: string
    description: string
    supplier: string | null
    amount_cents: number
    competence_date: string
    recurring: boolean
    frequency: string | null
    /** Quando vinculada a imposto, categoria/valor seguem em 'impostos'. */
    isTaxLinked: boolean
  }
}

/**
 * Editar despesa (backlog 4). A despesa é imutável por trigger; o backend trata
 * a edição como CORREÇÃO (cria nova versão + soft-delete da antiga, comprovantes
 * re-vinculados, auditado). Aqui só coletamos os campos e fazemos PUT.
 */
export function EditExpenseDialog({ expense }: EditExpenseDialogProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState(expense.category)
  const [description, setDescription] = useState(expense.description)
  const [supplier, setSupplier] = useState(expense.supplier ?? '')
  const [amount, setAmount] = useState((expense.amount_cents / 100).toFixed(2).replace('.', ','))
  const [competenceDate, setCompetenceDate] = useState(expense.competence_date.slice(0, 10))
  const [recurring, setRecurring] = useState(expense.recurring)
  const [frequency, setFrequency] = useState(expense.frequency ?? 'mensal')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const cents = toCents(amount)
    if (cents === null) {
      setError('Informe um valor válido (ex.: 120,50).')
      return
    }
    if (description.trim().length < 2) {
      setError('Descreva a despesa em pelo menos 2 caracteres.')
      return
    }
    setPending(true)
    try {
      const res = await fetch(`/api/despesas/${expense.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          category: expense.isTaxLinked ? 'impostos' : category,
          description: description.trim(),
          supplier: supplier.trim() || null,
          amount_cents: cents,
          competence_date: competenceDate,
          recurring,
          frequency: recurring ? frequency : null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao salvar a edição.')
        return
      }
      setOpen(false)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-2" title="Editar despesa">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar despesa</DialogTitle>
          <DialogDescription>
            A despesa original é mantida (soft-delete) e uma versão corrigida é criada,
            preservando a trilha de auditoria. Comprovantes são transferidos.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          {!expense.isTaxLinked ? (
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Categoria</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="aluguel">Aluguel</SelectItem>
                  <SelectItem value="equipamentos">Equipamentos</SelectItem>
                  <SelectItem value="materiais">Materiais</SelectItem>
                  <SelectItem value="pessoal">Pessoal</SelectItem>
                  <SelectItem value="servicos">Serviços</SelectItem>
                  <SelectItem value="impostos">Impostos</SelectItem>
                  <SelectItem value="manutencao">Manutenção</SelectItem>
                  <SelectItem value="outros">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="rounded-md bg-[#FAF5FF] px-3 py-2 text-[11px] font-semibold text-[#6B21A8]">
              Despesa vinculada a imposto — categoria permanece &quot;Impostos&quot;.
            </p>
          )}

          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">Descrição</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} required />
          </div>
          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">Fornecedor (opcional)</Label>
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Valor (R$)</Label>
              <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Competência</Label>
              <Input type="date" value={competenceDate} onChange={(e) => setCompetenceDate(e.target.value)} required />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Despesa recorrente
          </label>
          {recurring ? (
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Frequência</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="semanal">Semanal</SelectItem>
                  <SelectItem value="mensal">Mensal</SelectItem>
                  <SelectItem value="anual">Anual</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="gap-2">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar correção
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function toCents(input: string): number | null {
  const trimmed = input.trim().replace(/\s/g, '')
  if (!trimmed) return null
  const normalized = trimmed.replace(/\./g, '').replace(',', '.')
  const value = Number(normalized)
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 100)
}
