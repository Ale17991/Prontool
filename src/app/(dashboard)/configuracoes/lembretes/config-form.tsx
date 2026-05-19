'use client'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import { saveReminderConfig } from './actions'
import type { ReminderConfig } from '@/lib/core/reminders/types'

interface ConfigFormProps {
  initial: ReminderConfig
}

const PLACEHOLDER_HINTS = [
  ['{{paciente}}', 'Nome do paciente'],
  ['{{medico}}', 'Nome do profissional'],
  ['{{procedimento}}', 'Nome do procedimento'],
  ['{{horario}}', 'Data e hora (hor. de Brasília)'],
  ['{{clinica}}', 'Nome da clínica'],
] as const

export function ConfigForm({ initial }: ConfigFormProps) {
  const [pending, startTransition] = useTransition()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [offsets, setOffsets] = useState<number[]>(initial.offsetsHours)
  const [offsetInput, setOffsetInput] = useState('')
  const [sendWeekends, setSendWeekends] = useState(initial.sendWeekends)
  const [windowStart, setWindowStart] = useState(initial.windowStart)
  const [windowEnd, setWindowEnd] = useState(initial.windowEnd)
  const [templateSubject, setTemplateSubject] = useState(initial.templateSubject ?? '')
  const [templateBody, setTemplateBody] = useState(initial.templateBody ?? '')
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function addOffset() {
    const n = parseInt(offsetInput, 10)
    if (!Number.isFinite(n) || n < 0 || n > 168) {
      setFeedback({ type: 'error', msg: 'Antecedência deve estar entre 0 e 168 horas.' })
      return
    }
    if (offsets.includes(n)) {
      setOffsetInput('')
      return
    }
    if (offsets.length >= 5) {
      setFeedback({ type: 'error', msg: 'Máximo 5 antecedências.' })
      return
    }
    setOffsets([...offsets, n].sort((a, b) => b - a))
    setOffsetInput('')
    setFeedback(null)
  }

  function removeOffset(h: number) {
    setOffsets(offsets.filter((o) => o !== h))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (offsets.length === 0 && enabled) {
      setFeedback({ type: 'error', msg: 'Para habilitar, defina ao menos uma antecedência.' })
      return
    }
    if (windowEnd <= windowStart) {
      setFeedback({ type: 'error', msg: 'Hora final deve ser maior que hora inicial.' })
      return
    }
    setFeedback(null)
    startTransition(async () => {
      const result = await saveReminderConfig({
        enabled,
        offsetsHours: offsets,
        sendWeekends,
        windowStart,
        windowEnd,
        templateSubject: templateSubject.trim() ? templateSubject.trim() : null,
        templateBody: templateBody.trim() ? templateBody.trim() : null,
      })
      if (result.ok) {
        setFeedback({ type: 'success', msg: 'Configuração salva.' })
      } else {
        const detail =
          result.details && result.details.length > 0
            ? ` (${result.details.map((d) => `${d.field}: ${d.message}`).join('; ')})`
            : ''
        setFeedback({
          type: 'error',
          msg: `Erro ao salvar (${result.error})${detail}`,
        })
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Toggle */}
      <section className="rounded-lg border border-border bg-card p-5">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-input text-primary focus:ring-primary"
          />
          <div>
            <div className="font-semibold text-slate-900">
              Habilitar lembretes automáticos
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Quando habilitado, pacientes recebem email antes de cada consulta.
            </p>
            {initial.lastRunAt && (
              <p className="mt-2 text-xs text-slate-400">
                Último ciclo do motor:{' '}
                {new Intl.DateTimeFormat('pt-BR', {
                  timeZone: 'America/Sao_Paulo',
                  dateStyle: 'short',
                  timeStyle: 'short',
                }).format(new Date(initial.lastRunAt))}
              </p>
            )}
          </div>
        </label>
      </section>

      {/* Antecedências */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Antecedências</h2>
        <p className="mt-1 text-xs text-slate-500">
          Quantas horas antes da consulta o lembrete deve ser enviado. Você pode
          adicionar até 5 antecedências (ex.: 48h e 2h antes).
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {offsets.map((h) => (
            <span
              key={h}
              className="inline-flex items-center gap-1 rounded-full bg-info-bg px-3 py-1 text-xs font-medium text-info-text"
            >
              {h}h
              <button
                type="button"
                onClick={() => removeOffset(h)}
                aria-label={`Remover ${h}h`}
                className="rounded-full hover:bg-info-text/10"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="number"
            min={0}
            max={168}
            value={offsetInput}
            onChange={(e) => setOffsetInput(e.target.value)}
            placeholder="ex.: 24"
            className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={addOffset}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Adicionar
          </button>
        </div>
      </section>

      {/* Janela de envio */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Janela de envio</h2>
        <p className="mt-1 text-xs text-slate-500">
          Lembretes só são enviados dentro desta janela (horário de Brasília). Evita
          madrugada.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-700">Início</label>
            <input
              type="time"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">Fim</label>
            <input
              type="time"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sendWeekends}
            onChange={(e) => setSendWeekends(e.target.checked)}
            className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
          />
          Enviar lembretes em fins de semana
        </label>
      </section>

      {/* Template */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          Template do email (opcional)
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Deixe em branco para usar o template padrão. Placeholders disponíveis:
        </p>
        <ul className="mt-2 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
          {PLACEHOLDER_HINTS.map(([token, desc]) => (
            <li key={token}>
              <code className="rounded bg-muted px-1 py-0.5 font-mono">{token}</code> —{' '}
              {desc}
            </li>
          ))}
        </ul>

        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700">Assunto</label>
            <input
              type="text"
              maxLength={200}
              value={templateSubject}
              onChange={(e) => setTemplateSubject(e.target.value)}
              placeholder="ex.: Lembrete: consulta amanhã na {{clinica}}"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700">
              Corpo (HTML simples)
            </label>
            <textarea
              rows={6}
              maxLength={10000}
              value={templateBody}
              onChange={(e) => setTemplateBody(e.target.value)}
              placeholder="ex.: Olá {{paciente}}! Lembrando que você tem consulta com {{medico}} em {{horario}}."
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>
      </section>

      {feedback && (
        <div
          role="alert"
          className={
            feedback.type === 'success'
              ? 'rounded-md border border-success/30 bg-success-bg p-3 text-sm text-success-strong'
              : 'rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive'
          }
        >
          {feedback.msg}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Salvando...' : 'Salvar configuração'}
      </button>
    </form>
  )
}
