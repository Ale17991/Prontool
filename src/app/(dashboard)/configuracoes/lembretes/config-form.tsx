'use client'

/**
 * Feature 018/051 — o que sobrou da configuração de lembrete.
 *
 * A tela tinha cinco blocos: ligar, por onde enviar, antecedências, janela de
 * horário e os textos das mensagens. Os dois últimos saíram quando a tela de
 * Automações passou a fazer a mesma coisa melhor — lá a clínica escreve o texto
 * que quiser e escolhe a antecedência em dias, horas ou minutos, com prévia de
 * quantos pacientes serão atingidos.
 *
 * O QUE FOI REMOVIDO É SÓ A INTERFACE. Os valores continuam no banco e continuam
 * sendo enviados a cada salvamento, intactos: o motor da 018 lê
 * `reminder_offsets_hours` e os templates para decidir quando e o que mandar, e
 * apagá-los junto com os campos teria desligado o lembrete de consulta de todas
 * as clínicas — que é exatamente o motor que voltou a funcionar em 11/08 depois
 * de meses parado.
 *
 * O interruptor geral fica. Ele não é "opção de notificação": é o liga-desliga
 * do motor, e sem ele uma clínica com o lembrete desligado não teria por onde
 * religar.
 */

import { useState, useTransition } from 'react'
import { saveReminderConfig } from './actions'
import type { ReminderConfig } from '@/lib/core/reminders/types'

type CanalOferecido = 'email' | 'whatsapp'

interface ConfigFormProps {
  initial: ReminderConfig
  /** FR-005 — a clínica tem número de WhatsApp conectado agora? */
  whatsappConnected: boolean
  /** O módulo de rollout está ligado para esta clínica? */
  whatsappModuleEnabled: boolean
}

export function ConfigForm({ initial, whatsappConnected, whatsappModuleEnabled }: ConfigFormProps) {
  const [pending, startTransition] = useTransition()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [sendWeekends, setSendWeekends] = useState(initial.sendWeekends)
  const [windowStart, setWindowStart] = useState(initial.windowStart)
  const [windowEnd, setWindowEnd] = useState(initial.windowEnd)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  /**
   * Preservados, não editados. A ação de salvar exige o objeto inteiro, e mandar
   * `null` no lugar do que a tela deixou de mostrar apagaria a antecedência e os
   * textos do lembrete — que continuam sendo o que o motor usa.
   */
  const offsets = initial.offsetsHours
  const templateSubject = initial.templateSubject ?? ''
  const templateBody = initial.templateBody ?? ''
  const templateWhatsApp = initial.templateWhatsApp ?? ''
  // Feature 051 — canais.
  // `sms` existe no tipo do motor mas não é oferecido: não há implementação.
  // Restringir aqui mantém o formulário alinhado com o schema Zod do save.
  const [channels, setChannels] = useState<CanalOferecido[]>(
    initial.channels.filter((c): c is CanalOferecido => c === 'email' || c === 'whatsapp'),
  )
  const [fallbackEmail, setFallbackEmail] = useState(initial.whatsappFallbackEmail)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    // Estado inalcançável pela tela (a antecedência deixou de ser editável aqui,
    // e toda clínica tem a de fábrica). Fica como rede: habilitar sem
    // antecedência produz um lembrete que nunca sai, e silêncio é o pior
    // desfecho possível para este motor.
    if (offsets.length === 0 && enabled) {
      setFeedback({
        type: 'error',
        msg: 'Esta clínica está sem antecedência configurada — o lembrete não sairia. Monte o aviso de consulta em Configurações → Automações.',
      })
      return
    }
    if (windowEnd <= windowStart) {
      setFeedback({ type: 'error', msg: 'Hora final deve ser maior que hora inicial.' })
      return
    }
    if (channels.length === 0) {
      setFeedback({ type: 'error', msg: 'Escolha ao menos um canal de envio.' })
      return
    }
    // FR-005 — sem número conectado o canal não funciona, e descobrir isso só
    // no dia seguinte (quando ninguém foi avisado) é o pior desfecho.
    if (channels.includes('whatsapp') && !whatsappConnected) {
      setFeedback({
        type: 'error',
        msg: 'Conecte o WhatsApp da clínica antes de habilitar esse canal — no painel "Número de WhatsApp", acima.',
      })
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
        channels,
        whatsappFallbackEmail: fallbackEmail,
        templateWhatsApp: templateWhatsApp.trim() ? templateWhatsApp.trim() : null,
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
            <div className="font-semibold text-slate-900">Habilitar lembretes automáticos</div>
            <p className="mt-0.5 text-xs text-slate-500">
              Quando habilitado, o paciente é avisado antes de cada consulta pelos canais marcados
              abaixo. Para escrever o texto da mensagem ou mudar a antecedência, use{' '}
              <a className="underline" href="/configuracoes/automacoes">
                Automações
              </a>
              .
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

      {/* Canais (feature 051) */}
      {whatsappModuleEnabled && (
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-slate-900">Por onde enviar</h2>
          <p className="mt-1 text-xs text-slate-500">
            O paciente lê WhatsApp muito mais que e-mail. Você pode usar os dois.
          </p>

          <div className="mt-3 space-y-2">
            {(['email', 'whatsapp'] as const).map((c) => {
              const marcado = channels.includes(c)
              const bloqueado = c === 'whatsapp' && !whatsappConnected
              return (
                <label
                  key={c}
                  className={`flex items-start gap-3 rounded-md border p-3 ${
                    bloqueado ? 'border-border bg-slate-50 opacity-70' : 'border-border'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={marcado}
                    disabled={bloqueado}
                    onChange={(e) =>
                      setChannels((prev) =>
                        e.target.checked ? [...prev, c] : prev.filter((x) => x !== c),
                      )
                    }
                  />
                  <span className="text-sm">
                    <span className="font-medium text-slate-900">
                      {c === 'email' ? 'E-mail' : 'WhatsApp'}
                    </span>
                    {bloqueado && (
                      <span className="mt-0.5 block text-xs text-amber-700">
                        Conecte o número da clínica no painel acima para liberar.
                      </span>
                    )}
                  </span>
                </label>
              )
            })}
          </div>

          {channels.includes('whatsapp') && (
            <label className="mt-4 flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={fallbackEmail}
                onChange={(e) => setFallbackEmail(e.target.checked)}
              />
              <span className="text-sm text-slate-700">
                Se o paciente não tiver telefone, avisar por e-mail
                <span className="mt-0.5 block text-xs text-slate-500">
                  Sem isso, quem não tem telefone simplesmente não é avisado.
                </span>
              </span>
            </label>
          )}
        </section>
      )}

      {/* Janela de envio */}
      <section className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-slate-900">Janela de envio</h2>
        <p className="mt-1 text-xs text-slate-500">
          Lembretes só são enviados dentro desta janela, no relógio da clínica. Vale para o lembrete
          de consulta — as automações têm janela própria, na tela delas, porque as duas mensagens
          não têm a mesma tolerância de horário.
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
        className="rounded-md bg-brand-strong px-4 py-2 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? 'Salvando...' : 'Salvar configuração'}
      </button>
    </form>
  )
}
