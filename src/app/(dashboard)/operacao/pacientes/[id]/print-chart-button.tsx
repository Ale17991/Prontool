'use client'

import { useState } from 'react'
import { Download, Eye, FileText, Loader2, Printer } from 'lucide-react'
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
  // Backlog 1/7 — pré-visualização inline antes de baixar.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  function buildUrl(inline: boolean): string | null {
    if (from && !DATE_RE.test(from)) {
      setError('Data inicial inválida.')
      return null
    }
    if (to && !DATE_RE.test(to)) {
      setError('Data final inválida.')
      return null
    }
    if (from && to && from > to) {
      setError('Data inicial não pode ser maior que a final.')
      return null
    }
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    if (inline) qs.set('inline', '1')
    const q = qs.toString()
    return `/api/pacientes/${patientId}/prontuario/pdf${q ? `?${q}` : ''}`
  }

  function onPreview() {
    setError(null)
    const url = buildUrl(true)
    if (!url) return
    setPreviewUrl(url)
    setOpen(false)
  }

  function onDownload() {
    setError(null)
    const url = buildUrl(false)
    if (!url) return
    setPending(true)
    try {
      // PDF forçado como attachment via header (sem inline).
      window.open(url, '_blank')
      setOpen(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
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
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="outline" onClick={onPreview} disabled={pending} className="gap-2">
              <Eye className="h-4 w-4" />
              Pré-visualizar
            </Button>
            <Button onClick={onDownload} disabled={pending} className="gap-2">
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Baixar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backlog 1/7 — modal de pré-visualização (PDF inline). */}
      <Dialog open={previewUrl !== null} onOpenChange={(v) => !v && setPreviewUrl(null)}>
        <DialogContent className="h-[90vh] max-w-5xl gap-3 p-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-primary" />
              Pré-visualização do prontuário
            </DialogTitle>
          </DialogHeader>
          {previewUrl ? (
            <iframe
              src={previewUrl}
              title="Pré-visualização do prontuário"
              className="h-full w-full flex-1 rounded-md border border-slate-200"
            />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewUrl(null)}>
              Fechar
            </Button>
            <Button onClick={onDownload} className="gap-2">
              <Download className="h-4 w-4" />
              Baixar PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
