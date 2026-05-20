'use client'

import { useState } from 'react'
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  FileText,
  Heart,
  NotebookPen,
  Paperclip,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn, formatCurrency, formatDateTime, formatFileSize } from '@/lib/utils'
import type {
  AnamneseEvent,
  AppointmentEvent,
  ArquivoEvent,
  EvolucaoEvent,
  PaymentEvent,
  TextoEvent,
  TimelineEvent,
  VitalEvent,
} from '@/lib/core/patient-timeline'

interface Props {
  event: TimelineEvent
  authorDisplay: string
}

export function TimelineEventItem({ event, authorDisplay }: Props) {
  const [expanded, setExpanded] = useState(false)
  const meta = META_BY_KIND[event.kind]

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-3 text-left"
        aria-expanded={expanded}
      >
        <span className="shrink-0 pt-0.5 text-slate-400">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            meta.iconWrapClass,
          )}
        >
          <meta.Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-900">
              {titleFor(event)}
            </p>
            <Badge variant={meta.badgeVariant} className="h-5 px-1.5 text-[10px]">
              {meta.label}
            </Badge>
          </div>
          <p className="text-[10px] font-medium uppercase tracking-widest text-slate-400">
            {formatDateTime(event.occurredAt)}
            {authorDisplay ? ` · por ${authorDisplay}` : ''}
          </p>
        </div>
      </button>

      {expanded ? (
        <div className="mt-3 pl-11">{renderExpanded(event)}</div>
      ) : null}
    </article>
  )
}

function titleFor(event: TimelineEvent): string {
  switch (event.kind) {
    case 'anamnese':
    case 'evolucao':
    case 'texto':
    case 'arquivo':
      return event.source.title || META_BY_KIND[event.kind].label
    case 'vital':
      return 'Sinais vitais'
    case 'appointment': {
      const proc = event.source.procedureName ?? 'Atendimento'
      return proc
    }
    case 'payment':
      return formatCurrency(event.source.totalAmountCents) + ' · pagamento'
  }
}

function renderExpanded(event: TimelineEvent) {
  switch (event.kind) {
    case 'evolucao':
      return <SoapBlock event={event} />
    case 'anamnese':
      return <AnamneseBlock event={event} />
    case 'texto':
      return <TextBlock event={event} />
    case 'arquivo':
      return <FileBlock event={event} />
    case 'vital':
      return <VitalBlock event={event} />
    case 'appointment':
      return <AppointmentBlock event={event} />
    case 'payment':
      return <PaymentBlock event={event} />
  }
}

function SoapBlock({ event }: { event: EvolucaoEvent }) {
  const soap = event.source.soapData
  if (!soap) return null
  const sections = [
    { letter: 'S', label: 'Subjetivo', val: soap.subjective },
    { letter: 'O', label: 'Objetivo', val: soap.objective },
    { letter: 'A', label: 'Avaliação', val: soap.assessment },
    { letter: 'P', label: 'Plano', val: soap.plan },
  ]
  return (
    <div className="space-y-2 rounded-lg bg-blue-50/40 p-3 text-sm">
      {sections.map((s) =>
        s.val && s.val.trim() ? (
          <div key={s.letter}>
            <p className="text-[10px] font-black uppercase tracking-widest text-primary">
              <span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded bg-primary text-[9px] text-primary-foreground">
                {s.letter}
              </span>
              {s.label}
            </p>
            <p className="mt-1 whitespace-pre-wrap text-slate-700">{s.val}</p>
          </div>
        ) : null,
      )}
      {soap.assessment_cids && soap.assessment_cids.length > 0 ? (
        <div className="flex flex-wrap gap-1 pt-1">
          {soap.assessment_cids.map((c) => (
            <span
              key={c.code}
              className="inline-flex items-center gap-1 rounded-md bg-blue-100 px-2 py-0.5 text-[10px] text-blue-800"
            >
              <span className="font-mono font-bold">{c.code}</span>
              <span>{c.description}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function AnamneseBlock({ event }: { event: AnamneseEvent }) {
  const snap = event.source.anamnesisData
  if (!snap) return null
  const fields = (snap.fields ?? []).filter((f) => !f.is_default)
  const responses = snap.responses ?? {}
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
        Modelo: {snap.template_title} · v{snap.template_version}
      </p>
      {fields.length === 0 ? (
        <p className="text-xs text-slate-500">
          Apenas campos padrão preenchidos.
        </p>
      ) : (
        <dl className="space-y-1.5">
          {fields.map((f) => {
            const v = responses[f.id]
            const display =
              v === undefined || v === null || v === ''
                ? '—'
                : Array.isArray(v)
                  ? v.map(String).join(', ')
                  : String(v)
            return (
              <div key={f.id} className="grid grid-cols-[1fr_2fr] gap-3">
                <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {f.label}
                </dt>
                <dd className="text-slate-700">{display}</dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}

function TextBlock({ event }: { event: TextoEvent }) {
  return (
    <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
      {event.source.content || '(vazio)'}
    </p>
  )
}

function FileBlock({ event }: { event: ArquivoEvent }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
      <Paperclip className="h-3 w-3 text-slate-400" />
      <span className="truncate font-mono">
        {event.source.fileName ?? 'sem nome'}
      </span>
      {event.source.fileSizeBytes ? (
        <span className="ml-auto text-slate-400">
          {formatFileSize(event.source.fileSizeBytes)}
        </span>
      ) : null}
    </div>
  )
}

function VitalBlock({ event }: { event: VitalEvent }) {
  const v = event.source
  const peso = v.weightGrams !== null ? (v.weightGrams / 1000).toFixed(1) + 'kg' : '—'
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs md:grid-cols-3">
      <KV k="PA" val={v.systolicBp && v.diastolicBp ? `${v.systolicBp}/${v.diastolicBp} mmHg` : '—'} />
      <KV k="FC" val={v.heartRate ? `${v.heartRate} bpm` : '—'} />
      <KV k="FR" val={v.respiratoryRate ? `${v.respiratoryRate} irpm` : '—'} />
      <KV k="Temp" val={v.temperatureCelsius ? `${v.temperatureCelsius.toFixed(1)}°C` : '—'} />
      <KV k="SpO₂" val={v.oxygenSaturation ? `${v.oxygenSaturation}%` : '—'} />
      <KV k="Peso" val={peso} />
      <KV k="Altura" val={v.heightCm ? `${v.heightCm}cm` : '—'} />
      <KV k="IMC" val={v.bmi ? v.bmi.toFixed(1) : '—'} />
      {v.notes ? <div className="col-span-full text-slate-600">{v.notes}</div> : null}
    </div>
  )
}

function AppointmentBlock({ event }: { event: AppointmentEvent }) {
  const a = event.source
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs md:grid-cols-3">
      <KV k="Procedimento" val={a.procedureName ?? '—'} />
      <KV k="Código" val={a.tussCode ?? '—'} />
      <KV k="Médico" val={a.doctorName ?? '—'} />
      <KV k="Plano" val={a.planName ?? 'Particular'} />
      <KV k="Status" val={a.effectiveStatus ?? '—'} />
      <KV k="Valor líquido" val={formatCurrency(a.netAmountCents)} />
    </div>
  )
}

function PaymentBlock({ event }: { event: PaymentEvent }) {
  const p = event.source
  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs md:grid-cols-3">
      <KV k="Total" val={formatCurrency(p.totalAmountCents)} />
      <KV k="Pago" val={formatCurrency(p.paidAmountCents)} />
      <KV k="Pendente" val={formatCurrency(p.pendingAmountCents)} />
      <KV k="Método" val={p.paymentMethod || '—'} />
      <KV k="Status" val={p.paymentStatus || '—'} />
      {p.notes ? <div className="col-span-full text-slate-600">{p.notes}</div> : null}
    </div>
  )
}

function KV({ k, val }: { k: string; val: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
        {k}
      </p>
      <p className="font-semibold text-slate-700">{val}</p>
    </div>
  )
}

interface KindMeta {
  label: string
  Icon: typeof FileText
  iconWrapClass: string
  badgeVariant: 'default' | 'success' | 'info' | 'warning' | 'secondary'
}

const META_BY_KIND: Record<TimelineEvent['kind'], KindMeta> = {
  anamnese: {
    label: 'Anamnese',
    Icon: ClipboardCheck,
    iconWrapClass: 'bg-success-bg text-success-strong',
    badgeVariant: 'success',
  },
  evolucao: {
    label: 'Evolução SOAP',
    Icon: NotebookPen,
    iconWrapClass: 'bg-info-bg text-info-text',
    badgeVariant: 'info',
  },
  texto: {
    label: 'Nota',
    Icon: FileText,
    iconWrapClass: 'bg-indigo-50 text-indigo-600',
    badgeVariant: 'secondary',
  },
  arquivo: {
    label: 'Arquivo',
    Icon: Paperclip,
    iconWrapClass: 'bg-rose-50 text-rose-600',
    badgeVariant: 'secondary',
  },
  vital: {
    label: 'Sinais vitais',
    Icon: Heart,
    iconWrapClass: 'bg-rose-50 text-rose-600',
    badgeVariant: 'warning',
  },
  appointment: {
    label: 'Atendimento',
    Icon: Calendar,
    iconWrapClass: 'bg-blue-50 text-blue-600',
    badgeVariant: 'default',
  },
  payment: {
    label: 'Pagamento',
    Icon: CreditCard,
    iconWrapClass: 'bg-emerald-50 text-emerald-700',
    badgeVariant: 'success',
  },
}
