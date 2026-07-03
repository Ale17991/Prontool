'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock, Loader2 } from 'lucide-react'
import type { AppointmentFlow, FlowStatus } from '@/lib/core/appointment-flow/crud'

export const FLOW_META: Record<FlowStatus, { label: string; pill: string; dot: string }> = {
  agendado: {
    label: 'Agendado',
    pill: 'bg-slate-100 text-slate-600 border-slate-200',
    dot: 'bg-slate-400',
  },
  aguardando: {
    label: 'Aguardando',
    pill: 'bg-amber-100 text-amber-700 border-amber-300',
    dot: 'bg-amber-500',
  },
  em_consulta: {
    label: 'Em consulta',
    pill: 'bg-blue-100 text-blue-700 border-blue-300',
    dot: 'bg-blue-500',
  },
  atendido: {
    label: 'Atendido',
    pill: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    dot: 'bg-emerald-500',
  },
  desmarcou: {
    label: 'Desmarcou',
    pill: 'bg-rose-100 text-rose-700 border-rose-300',
    dot: 'bg-rose-500',
  },
}

const ORDER: FlowStatus[] = ['agendado', 'aguardando', 'em_consulta', 'atendido', 'desmarcou']

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtDuration(fromIso: string | null, toMs: number): string {
  if (!fromIso) return '—'
  const from = new Date(fromIso).getTime()
  if (Number.isNaN(from)) return '—'
  const mins = Math.max(0, Math.round((toMs - from) / 60_000))
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')}`
}

/** Relógio que avança de minuto em minuto (para o cronômetro de espera ao vivo). */
function useMinuteTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/** Tempo de espera/permanência derivado do fluxo, formatado para exibição. */
function flowTimes(
  flow: AppointmentFlow,
  nowMs: number,
): { waiting: string | null; stay: string | null } {
  if (!flow.arrivedAt) return { waiting: null, stay: null }
  const waitEnd = flow.consultStartedAt
    ? new Date(flow.consultStartedAt).getTime()
    : flow.endedAt
      ? new Date(flow.endedAt).getTime()
      : nowMs
  const waiting = fmtDuration(flow.arrivedAt, waitEnd)
  const stayEnd = flow.endedAt ? new Date(flow.endedAt).getTime() : nowMs
  const stay = fmtDuration(flow.arrivedAt, stayEnd)
  return { waiting, stay }
}

async function postStatus(
  appointmentId: string,
  status: FlowStatus,
): Promise<AppointmentFlow | null> {
  const res = await fetch(`/api/atendimentos/${appointmentId}/fluxo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  if (!res.ok) return null
  const body = (await res.json()) as { flow: AppointmentFlow }
  return body.flow
}

/**
 * Controle completo do fluxo no detalhe do atendimento: status manual +
 * chegada/espera/permanência (consultados sob demanda). Self-contained: busca o
 * próprio estado via GET.
 */
export function AppointmentFlowControl({
  appointmentId,
  canManage,
}: {
  appointmentId: string
  canManage: boolean
}) {
  const [flow, setFlow] = useState<AppointmentFlow | null>(null)
  const [pending, setPending] = useState<FlowStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/atendimentos/${appointmentId}/fluxo`, { cache: 'no-store' })
      if (!res.ok || cancelled) return
      const body = (await res.json()) as { flow: AppointmentFlow }
      if (!cancelled) setFlow(body.flow)
    })()
    return () => {
      cancelled = true
    }
  }, [appointmentId])

  const live = flow?.status === 'aguardando' || flow?.status === 'em_consulta'
  const nowMs = useMinuteTick(live)

  async function change(status: FlowStatus) {
    if (!canManage || pending) return
    setPending(status)
    try {
      const updated = await postStatus(appointmentId, status)
      if (updated) setFlow(updated)
    } finally {
      setPending(null)
    }
  }

  if (!flow) {
    return <div className="h-9 animate-pulse rounded-md bg-slate-100" />
  }

  const { waiting, stay } = flowTimes(flow, nowMs)

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        Fluxo de atendimento
      </p>
      <div className="flex flex-wrap gap-1.5">
        {ORDER.map((s) => {
          const active = flow.status === s
          const meta = FLOW_META[s]
          return (
            <button
              key={s}
              type="button"
              disabled={!canManage || pending !== null}
              onClick={() => void change(s)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-all disabled:cursor-default ${
                active ? meta.pill : 'border-slate-200 bg-white text-slate-400 hover:text-slate-600'
              } ${canManage && !active ? 'hover:border-slate-300' : ''}`}
            >
              {pending === s ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span className={`h-2 w-2 rounded-full ${active ? meta.dot : 'bg-slate-300'}`} />
              )}
              {meta.label}
            </button>
          )
        })}
      </div>

      {flow.arrivedAt ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" /> Chegada {fmtTime(flow.arrivedAt)}
          </span>
          {flow.status === 'aguardando' ? (
            <span className="font-semibold text-amber-600">Esperando há {waiting}</span>
          ) : flow.consultStartedAt ? (
            <span>Espera {waiting}</span>
          ) : null}
          {flow.endedAt ? (
            <>
              <span>Saída {fmtTime(flow.endedAt)}</span>
              <span className="font-semibold text-slate-700">Permanência {stay}</span>
            </>
          ) : flow.status !== 'agendado' ? (
            <span className="font-semibold text-slate-700">Na clínica há {stay}</span>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-slate-400">
          Marque “Aguardando” quando o paciente chegar para registrar o horário.
        </p>
      )}
    </div>
  )
}

/**
 * Célula compacta para a lista da agenda: pílula de status + cronômetro de espera.
 * Editável inline (select) quando canManage. Recebe o estado inicial do servidor.
 */
export function FlowStatusCell({
  appointmentId,
  initial,
  canManage,
}: {
  appointmentId: string
  initial: AppointmentFlow
  canManage: boolean
}) {
  const [flow, setFlow] = useState<AppointmentFlow>(initial)
  const [pending, setPending] = useState(false)
  const selectRef = useRef<HTMLSelectElement | null>(null)

  const live = flow.status === 'aguardando'
  const nowMs = useMinuteTick(live)
  const meta = FLOW_META[flow.status]

  const onChange = useCallback(
    async (status: FlowStatus) => {
      setPending(true)
      try {
        const updated = await postStatus(appointmentId, status)
        if (updated) setFlow(updated)
      } finally {
        setPending(false)
      }
    },
    [appointmentId],
  )

  const { waiting } = flowTimes(flow, nowMs)

  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        className={`relative inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.pill}`}
      >
        {pending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
        )}
        {meta.label}
        {canManage ? (
          <select
            ref={selectRef}
            value={flow.status}
            onChange={(e) => void onChange(e.target.value as FlowStatus)}
            disabled={pending}
            aria-label="Alterar status do fluxo"
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            {ORDER.map((s) => (
              <option key={s} value={s}>
                {FLOW_META[s].label}
              </option>
            ))}
          </select>
        ) : null}
      </span>
      {flow.status === 'aguardando' && waiting ? (
        <span className="whitespace-nowrap text-[10px] font-semibold text-amber-600">
          {waiting}
        </span>
      ) : null}
    </div>
  )
}
