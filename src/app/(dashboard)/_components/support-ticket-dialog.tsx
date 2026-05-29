'use client'

import { useState, type FormEvent } from 'react'
import { usePathname } from 'next/navigation'
import { Bug, Lightbulb, LifeBuoy, MessageSquarePlus } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

type Kind = 'bug' | 'suggestion' | 'support'

const KIND_OPTIONS: Array<{ value: Kind; label: string; icon: typeof Bug; hint: string }> = [
  { value: 'bug', label: 'Bug / Erro', icon: Bug, hint: 'Algo não está funcionando' },
  {
    value: 'suggestion',
    label: 'Sugestão',
    icon: Lightbulb,
    hint: 'Ideia para melhorar o sistema',
  },
  {
    value: 'support',
    label: 'Suporte',
    icon: LifeBuoy,
    hint: 'Preciso de ajuda para usar',
  },
]

export function SupportTicketDialog() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<Kind>('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(
    null,
  )

  const titleValid = title.trim().length >= 3 && title.trim().length <= 120
  const descriptionValid =
    description.trim().length >= 10 && description.trim().length <= 5000
  const canSubmit = titleValid && descriptionValid && !submitting

  function reset() {
    setKind('bug')
    setTitle('')
    setDescription('')
    setFeedback(null)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setFeedback(null)
    try {
      const res = await fetch('/api/support-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: title.trim(),
          description: description.trim(),
          pageUrl: pathname,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string }
        setFeedback({
          kind: 'error',
          message:
            body.message ?? 'Não foi possível enviar agora. Tente novamente em instantes.',
        })
        return
      }
      setFeedback({ kind: 'ok', message: 'Mensagem enviada. Obrigado pelo retorno!' })
      // Limpa form mas mantém o feedback visível por um momento.
      setTitle('')
      setDescription('')
      setTimeout(() => {
        setOpen(false)
        reset()
      }, 1400)
    } catch {
      setFeedback({ kind: 'error', message: 'Erro de rede. Tente novamente.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="ml-12 inline-flex items-center gap-1.5 self-start rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-sidebar-switch transition-colors hover:bg-sidebar-hover hover:opacity-80"
          title="Reportar bug, sugerir melhoria ou solicitar suporte"
        >
          <MessageSquarePlus className="h-3 w-3 shrink-0" />
          <span>Reportar / Suporte</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar mensagem para o Clinni</DialogTitle>
          <DialogDescription>
            Conte um bug que encontrou, sugira uma melhoria ou peça ajuda. Lemos tudo.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ticket-kind">Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger id="ticket-kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((opt) => {
                  const Icon = opt.icon
                  return (
                    <SelectItem key={opt.value} value={opt.value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span>{opt.label}</span>
                        <span className="text-[11px] text-slate-400">— {opt.hint}</span>
                      </div>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ticket-title">Título</Label>
            <Input
              id="ticket-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Resumo curto (3 a 120 caracteres)"
              maxLength={120}
              autoFocus
            />
            <p className="text-[11px] text-slate-500">{title.trim().length} / 120</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ticket-description">Descrição</Label>
            <Textarea
              id="ticket-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva com detalhes: o que aconteceu, o que esperava, como reproduzir, etc."
              rows={6}
              maxLength={5000}
            />
            <p className="text-[11px] text-slate-500">
              {description.trim().length} / 5000 (mínimo 10)
            </p>
          </div>
          {feedback ? (
            <div
              role="alert"
              className={cn(
                'rounded-md border p-2.5 text-xs font-medium',
                feedback.kind === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-destructive/30 bg-destructive/5 text-destructive',
              )}
            >
              {feedback.message}
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? 'Enviando…' : 'Enviar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
