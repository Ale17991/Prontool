'use client'

import { useState } from 'react'
import { FileText, Loader2, Printer } from 'lucide-react'
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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function PrintChartButton({ patientId }: { patientId: string }) {
  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConfirm() {
    setError(null)
    if (from && !DATE_RE.test(from)) {
      setError('Data inicial inválida.')
      return
    }
    if (to && !DATE_RE.test(to)) {
      setError('Data final inválida.')
      return
    }
    if (from && to && from > to) {
      setError('Data inicial não pode ser maior que a final.')
      return
    }
    setPending(true)
    try {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const url = `/api/pacientes/${patientId}/prontuario/pdf${
        qs.toString() ? `?${qs.toString()}` : ''
      }`
      // Abre em nova aba — o PDF é forçado como attachment via header.
      window.open(url, '_blank')
      setOpen(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Printer className="h-3.5 w-3.5" />
          Imprimir prontuário
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Imprimir prontuário completo
          </DialogTitle>
          <DialogDescription>
            Gera PDF com dados do paciente, alergias, antecedentes, sinais vitais,
            diagnósticos, evoluções, anamneses, plano de tratamento e atendimentos.
            Filtro de período aplica-se às seções temporais.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pdf_from">De (opcional)</Label>
            <Input
              id="pdf_from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pdf_to">Até (opcional)</Label>
            <Input
              id="pdf_to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Sem datas → histórico completo. Alergias e antecedentes sempre aparecem.
        </p>
        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={() => void onConfirm()} disabled={pending} className="gap-2">
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Printer className="h-4 w-4" />
            )}
            Gerar PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
