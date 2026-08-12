'use client'

import { useState, useTransition } from 'react'
import { BellOff, BellRing } from 'lucide-react'
import {
  setPatientAutomationsOptInAction,
  setPatientReminderOptIn,
  setPatientWhatsAppReminderOptIn,
} from '@/app/(dashboard)/configuracoes/lembretes/actions'

interface RemindersOptInToggleProps {
  patientId: string
  initialOptIn: boolean
  /** Se o admin tem permissão para alternar; false = render read-only. */
  canEdit: boolean
  /** Feature 051 — recusa específica do WhatsApp. */
  initialWhatsAppOptIn?: boolean
  /** Só mostra o controle de canal se a clínica tiver o canal disponível. */
  whatsappDisponivel?: boolean
  /** Feature 056 — consentimento de automações, distinto do lembrete. */
  initialAutomationsOptIn?: boolean
  automacoesDisponivel?: boolean
}

export function RemindersOptInToggle({
  patientId,
  initialOptIn,
  canEdit,
  initialWhatsAppOptIn = true,
  whatsappDisponivel = false,
  initialAutomationsOptIn = false,
  automacoesDisponivel = false,
}: RemindersOptInToggleProps) {
  const [pending, startTransition] = useTransition()
  const [optIn, setOptIn] = useState(initialOptIn)
  const [waOptIn, setWaOptIn] = useState(initialWhatsAppOptIn)
  const [autoOptIn, setAutoOptIn] = useState(initialAutomationsOptIn)
  const [error, setError] = useState<string | null>(null)

  function toggleAutomacoes() {
    if (!canEdit || pending) return
    const next = !autoOptIn
    setError(null)
    setAutoOptIn(next)
    startTransition(async () => {
      const result = await setPatientAutomationsOptInAction(patientId, next)
      if (!result.ok) {
        setAutoOptIn(!next)
        setError(`Erro ao salvar (${result.error})`)
      }
    })
  }

  function toggleWhatsApp() {
    if (!canEdit || pending) return
    const next = !waOptIn
    setError(null)
    setWaOptIn(next) // otimista
    startTransition(async () => {
      const result = await setPatientWhatsAppReminderOptIn(patientId, next)
      if (!result.ok) {
        setWaOptIn(!next)
        setError(`Erro ao salvar (${result.error})`)
      }
    })
  }

  function toggle() {
    if (!canEdit || pending) return
    const next = !optIn
    setError(null)
    setOptIn(next) // optimistic
    startTransition(async () => {
      const result = await setPatientReminderOptIn(patientId, next)
      if (!result.ok) {
        setOptIn(!next) // revert
        setError(`Erro ao salvar (${result.error})`)
      }
    })
  }

  const Icon = optIn ? BellRing : BellOff
  const label = optIn ? 'Recebe lembretes' : 'Opt-out de lembretes'
  const hint = optIn
    ? 'Lembretes automáticos habilitados para este paciente.'
    : 'Paciente NÃO receberá lembretes automáticos (opt-out).'

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={
              optIn
                ? 'rounded-lg bg-success-bg p-2 text-success-strong'
                : 'rounded-lg bg-muted p-2 text-slate-500'
            }
          >
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">{label}</div>
            <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
          </div>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={toggle}
            disabled={pending}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? '...' : optIn ? 'Desabilitar' : 'Habilitar'}
          </button>
        ) : null}
      </div>
      {/*
        Feature 051 — recusa POR CANAL. Só aparece quando a clínica tem o canal
        disponível, e some quando o paciente já recusou tudo: oferecer "não
        quero WhatsApp" a quem não recebe nada seria confuso.
      */}
      {whatsappDisponivel && optIn && (
        <div className="mt-3 flex items-start justify-between gap-3 border-t border-border pt-3">
          <div>
            <div className="text-sm font-medium text-slate-900">
              {waOptIn ? 'Aceita WhatsApp' : 'Não quer WhatsApp'}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {waOptIn
                ? 'Recebe os lembretes também por WhatsApp.'
                : 'Continua recebendo por e-mail — a recusa vale só para o WhatsApp.'}
            </p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={toggleWhatsApp}
              disabled={pending}
              className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? '...' : waOptIn ? 'Não enviar' : 'Voltar a enviar'}
            </button>
          ) : null}
        </div>
      )}

      {/*
        Feature 056 — consentimento de AUTOMAÇÕES. Separado do lembrete de
        propósito: quem aceitou ser lembrado da consulta não aceitou receber
        mensagem sobre hábito ou aniversário. Nasce NEGADO, e por isso o texto
        padrão diz que o paciente não recebe — o contrário presumiria um
        consentimento que ninguém deu.
      */}
      {automacoesDisponivel && optIn && (
        <div className="mt-3 flex items-start justify-between gap-3 border-t border-border pt-3">
          <div>
            <div className="text-sm font-medium text-slate-900">
              {autoOptIn ? 'Aceita mensagens automáticas' : 'Não recebe mensagens automáticas'}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {autoOptIn
                ? 'Pode receber aniversário, acompanhamento de hábitos e retorno.'
                : 'Recebe apenas lembrete de consulta. Consentimento não presumido.'}
            </p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={toggleAutomacoes}
              disabled={pending}
              className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? '...' : autoOptIn ? 'Não enviar' : 'Autorizar'}
            </button>
          ) : null}
        </div>
      )}

      {error && (
        <div role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}
