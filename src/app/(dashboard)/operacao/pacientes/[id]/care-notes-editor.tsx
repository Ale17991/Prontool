'use client'

import { useEffect, useState, useTransition } from 'react'
import { ClipboardList, Loader2, Printer, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { READY_MADE_CARE_NOTES } from '@/lib/core/care-notes/ready-made'

/**
 * Feature 032 — orientações ao paciente (autoria pela equipe).
 * Autossuficiente: busca/cria/remove via /api/pacientes/[id]/orientacoes.
 * Aparece no portal do paciente quando a seção "orientacoes" está habilitada.
 */

interface Note {
  id: string
  body: string
  createdAt: string
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

export function CareNotesEditor({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const base = `/api/pacientes/${patientId}/orientacoes`
  const [notes, setNotes] = useState<Note[]>([])
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(base)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { notes: Note[] }
        if (!cancelled) setNotes(data.notes)
      } catch {
        if (!cancelled) setError('Não foi possível carregar as orientações.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [base])

  function add() {
    const text = body.trim()
    if (!text) return
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: text }),
        })
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          throw new Error(b.error?.message ?? `HTTP ${res.status}`)
        }
        const { id } = (await res.json()) as { id: string }
        setNotes((prev) => [{ id, body: text, createdAt: new Date().toISOString() }, ...prev])
        setBody('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar.')
      }
    })
  }

  function remove(id: string) {
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(`${base}?noteId=${encodeURIComponent(id)}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setNotes((prev) => prev.filter((n) => n.id !== id))
      } catch {
        setError('Erro ao remover.')
      }
    })
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ClipboardList className="h-4 w-4 text-primary" />
          Orientações ao paciente
        </CardTitle>
        {/*
          Feature 054 US3 — o impresso fica onde o texto nasce. Só aparece com
          orientação registrada: um botão que sempre devolve "nada a imprimir"
          ensina a ignorá-lo.
        */}
        {notes.length > 0 ? (
          <Button variant="outline" size="sm" className="h-7 gap-1.5 px-2 text-[11px]" asChild>
            <a
              href={`/api/pacientes/${patientId}/orientacoes/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              <Printer className="h-3 w-3" /> PDF
            </a>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">
          Texto exibido ao paciente no portal (quando a seção “Orientações” está habilitada nas
          configurações do portal).
        </p>

        {canWrite ? (
          <div className="space-y-2">
            {/*
              Orientações prontas: inserir é uma CÓPIA para o campo abaixo. A
              profissional edita antes de salvar — o texto gravado é dela, e
              melhorar o catálogo depois não reescreve o que já foi entregue.
            */}
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-slate-400">Começar de um modelo:</span>
              {READY_MADE_CARE_NOTES.map((m) => (
                <button
                  key={m.slug}
                  type="button"
                  title={m.hint}
                  onClick={() => setBody((cur) => (cur.trim() ? `${cur}

${m.body}` : m.body))}
                  className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600 hover:border-primary hover:text-primary"
                >
                  {m.title}
                </button>
              ))}
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={5000}
              rows={body.length > 400 ? 10 : 3}
              placeholder="Ex.: Manter caminhada 30 min, 5x/semana. Retornar em 30 dias com exames."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              {error ? <span className="text-xs text-destructive">{error}</span> : <span />}
              <Button size="sm" onClick={add} disabled={pending || body.trim().length === 0}>
                {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                Adicionar orientação
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-400">Carregando…</p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma orientação registrada.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
                <p className="whitespace-pre-wrap text-sm text-slate-700">{n.body}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{fmt(n.createdAt)}</span>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => remove(n.id)}
                      disabled={pending}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" /> Remover
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
