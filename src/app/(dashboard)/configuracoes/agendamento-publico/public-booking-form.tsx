'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { PublicBookingConfigFull } from '@/lib/core/public-booking/config'
import {
  removeDoctorAction,
  removeProcedureAction,
  saveConfigAction,
  upsertDoctorAction,
  upsertProcedureAction,
} from './actions'

interface DoctorOption {
  id: string
  fullName: string
}
interface ProcedureOption {
  id: string
  name: string
}

interface Props {
  initial: PublicBookingConfigFull
  allDoctors: DoctorOption[]
  allProcedures: ProcedureOption[]
  baseUrl: string
}

const WEEKDAY_LABELS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
]

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,31}$/

export function PublicBookingForm({
  initial,
  allDoctors,
  allProcedures,
  baseUrl,
}: Props) {
  const [config, setConfig] = useState(initial.config)
  const [doctors, setDoctors] = useState(initial.doctors)
  const [procedures, setProcedures] = useState(initial.procedures)
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'error'; message: string } | null>(
    null,
  )
  const [pending, startTransition] = useTransition()

  const slugError = useMemo(() => {
    if (config.publicBookingSlug === null || config.publicBookingSlug === '') {
      return config.publicBookingEnabled
        ? 'Defina um slug para habilitar.'
        : null
    }
    return SLUG_REGEX.test(config.publicBookingSlug)
      ? null
      : 'Use 3-32 caracteres: letras minúsculas, dígitos e hífens. Comece com letra/dígito.'
  }, [config.publicBookingSlug, config.publicBookingEnabled])

  const publicUrl = config.publicBookingSlug
    ? `${baseUrl}/agendar/${config.publicBookingSlug}`
    : null

  const availableDoctors = allDoctors.filter(
    (d) => !doctors.some((pd) => pd.doctorId === d.id),
  )

  function saveConfig() {
    setFeedback(null)
    startTransition(async () => {
      const res = await saveConfigAction(config)
      if (res.ok) setFeedback({ kind: 'ok', message: 'Configuração salva.' })
      else setFeedback({ kind: 'error', message: res.error ?? 'Erro ao salvar.' })
    })
  }

  async function copyUrl() {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      setFeedback({ kind: 'ok', message: 'Link copiado.' })
    } catch {
      setFeedback({ kind: 'error', message: 'Falha ao copiar.' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Card 1: Configurações gerais */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configurações gerais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={config.publicBookingEnabled}
              onChange={(e) =>
                setConfig({ ...config, publicBookingEnabled: e.target.checked })
              }
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-primary/30"
            />
            <span>Habilitar link público de agendamento</span>
          </label>

          <div className="space-y-1.5">
            <Label htmlFor="slug">Endereço do link público</Label>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-500">
                {baseUrl}/agendar/
              </span>
              <Input
                id="slug"
                value={config.publicBookingSlug ?? ''}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    publicBookingSlug: e.target.value.trim().toLowerCase() || null,
                  })
                }
                placeholder="minha-clinica"
                className={cn('flex-1', slugError && 'border-destructive/60')}
                maxLength={32}
              />
            </div>
            {slugError ? (
              <p className="text-xs text-destructive">{slugError}</p>
            ) : null}
            {publicUrl ? (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyUrl}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Copy className="h-3 w-3" /> Copiar link
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-link hover:bg-slate-50 hover:text-link-hover"
                >
                  <ExternalLink className="h-3 w-3" /> Ver prévia
                </a>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="min_hours">Antecedência mínima (horas)</Label>
              <Input
                id="min_hours"
                type="number"
                min={0}
                max={168}
                value={config.publicBookingMinHoursAdvance}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    publicBookingMinHoursAdvance: Math.min(
                      168,
                      Math.max(0, Number(e.target.value) || 0),
                    ),
                  })
                }
              />
              <p className="text-[11px] text-slate-500">
                Paciente não pode agendar com menos antecedência que isto. Padrão: 24h.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max_days">Antecedência máxima (dias)</Label>
              <Input
                id="max_days"
                type="number"
                min={1}
                max={180}
                value={config.publicBookingMaxDaysAdvance}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    publicBookingMaxDaysAdvance: Math.min(
                      180,
                      Math.max(1, Number(e.target.value) || 30),
                    ),
                  })
                }
              />
              <p className="text-[11px] text-slate-500">
                Quanto à frente o paciente pode marcar. Padrão: 30 dias.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cancel_min">Cancelar até (horas antes)</Label>
              <Input
                id="cancel_min"
                type="number"
                min={0}
                max={168}
                value={config.publicBookingCancelMinHours}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    publicBookingCancelMinHours: Math.min(
                      168,
                      Math.max(0, Number(e.target.value) || 0),
                    ),
                  })
                }
              />
              <p className="text-[11px] text-slate-500">
                Janela para cancelamento online via email. Padrão: 6h.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              {feedback ? (
                <p
                  className={cn(
                    'text-xs font-medium',
                    feedback.kind === 'ok' ? 'text-success-strong' : 'text-destructive',
                  )}
                >
                  {feedback.message}
                </p>
              ) : null}
            </div>
            <Button onClick={saveConfig} disabled={pending || !!slugError}>
              {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
              Salvar configurações
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Card 2: Médicos publicados */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Profissionais publicados</CardTitle>
          {availableDoctors.length > 0 ? (
            <AddDoctorPicker
              available={availableDoctors}
              onAdd={(doctorId) =>
                startTransition(async () => {
                  const doctor = allDoctors.find((d) => d.id === doctorId)
                  if (!doctor) return
                  const res = await upsertDoctorAction({
                    doctorId,
                    displayOrder: doctors.length,
                    bio: null,
                    availableWeekdays: [1, 2, 3, 4, 5],
                    availableFrom: '08:00',
                    availableUntil: '18:00',
                    lunchBreakFrom: null,
                    lunchBreakUntil: null,
                  })
                  if (res.ok) {
                    setDoctors([
                      ...doctors,
                      {
                        doctorId,
                        doctorFullName: doctor.fullName,
                        displayOrder: doctors.length,
                        bio: null,
                        availableWeekdays: [1, 2, 3, 4, 5],
                        availableFrom: '08:00',
                        availableUntil: '18:00',
                        lunchBreakFrom: null,
                        lunchBreakUntil: null,
                      },
                    ])
                    setFeedback({ kind: 'ok', message: `${doctor.fullName} publicado.` })
                  } else {
                    setFeedback({ kind: 'error', message: res.error ?? 'Erro.' })
                  }
                })
              }
            />
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {doctors.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nenhum profissional publicado. Adicione um para começar.
            </p>
          ) : (
            doctors.map((d) => (
              <DoctorBlock
                key={d.doctorId}
                doctor={d}
                proceduresOfThisDoctor={procedures.filter(
                  (p) => p.doctorId === d.doctorId,
                )}
                allProcedures={allProcedures}
                onSave={(payload) =>
                  startTransition(async () => {
                    const res = await upsertDoctorAction(payload)
                    if (res.ok) {
                      setDoctors((prev) =>
                        prev.map((x) =>
                          x.doctorId === payload.doctorId
                            ? { ...x, ...payload, doctorFullName: x.doctorFullName }
                            : x,
                        ),
                      )
                      setFeedback({ kind: 'ok', message: 'Profissional atualizado.' })
                    } else {
                      setFeedback({ kind: 'error', message: res.error ?? 'Erro.' })
                    }
                  })
                }
                onRemove={() =>
                  startTransition(async () => {
                    const res = await removeDoctorAction(d.doctorId)
                    if (res.ok) {
                      setDoctors((prev) => prev.filter((x) => x.doctorId !== d.doctorId))
                      setProcedures((prev) =>
                        prev.filter((p) => p.doctorId !== d.doctorId),
                      )
                      setFeedback({ kind: 'ok', message: 'Profissional removido.' })
                    } else {
                      setFeedback({ kind: 'error', message: res.error ?? 'Erro.' })
                    }
                  })
                }
                onProcedureUpsert={(payload) =>
                  startTransition(async () => {
                    const res = await upsertProcedureAction(payload)
                    if (res.ok) {
                      setProcedures((prev) => {
                        const idx = prev.findIndex(
                          (p) =>
                            p.doctorId === payload.doctorId &&
                            p.procedureId === payload.procedureId,
                        )
                        const procName =
                          allProcedures.find((p) => p.id === payload.procedureId)?.name ?? '—'
                        const next = {
                          doctorId: payload.doctorId,
                          procedureId: payload.procedureId,
                          procedureName: procName,
                          displayName: payload.displayName,
                          durationMinutes: payload.durationMinutes,
                          displayOrder: payload.displayOrder,
                        }
                        if (idx === -1) return [...prev, next]
                        const copy = [...prev]
                        copy[idx] = next
                        return copy
                      })
                      setFeedback({ kind: 'ok', message: 'Procedimento atualizado.' })
                    } else {
                      setFeedback({ kind: 'error', message: res.error ?? 'Erro.' })
                    }
                  })
                }
                onProcedureRemove={(procedureId) =>
                  startTransition(async () => {
                    const res = await removeProcedureAction(d.doctorId, procedureId)
                    if (res.ok) {
                      setProcedures((prev) =>
                        prev.filter(
                          (p) =>
                            !(p.doctorId === d.doctorId && p.procedureId === procedureId),
                        ),
                      )
                      setFeedback({ kind: 'ok', message: 'Procedimento removido.' })
                    } else {
                      setFeedback({ kind: 'error', message: res.error ?? 'Erro.' })
                    }
                  })
                }
              />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function AddDoctorPicker({
  available,
  onAdd,
}: {
  available: DoctorOption[]
  onAdd: (doctorId: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="w-48 text-xs">
          <SelectValue placeholder="Selecionar profissional…" />
        </SelectTrigger>
        <SelectContent>
          {available.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.fullName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          if (value) {
            onAdd(value)
            setValue('')
          }
        }}
        disabled={!value}
      >
        <Plus className="mr-1 h-3 w-3" /> Adicionar
      </Button>
    </div>
  )
}

interface DoctorBlockProps {
  doctor: PublicBookingConfigFull['doctors'][number]
  proceduresOfThisDoctor: PublicBookingConfigFull['procedures']
  allProcedures: ProcedureOption[]
  onSave: (payload: {
    doctorId: string
    displayOrder: number
    bio: string | null
    availableWeekdays: number[]
    availableFrom: string
    availableUntil: string
    lunchBreakFrom: string | null
    lunchBreakUntil: string | null
  }) => void
  onRemove: () => void
  onProcedureUpsert: (payload: {
    doctorId: string
    procedureId: string
    displayName: string
    durationMinutes: number
    displayOrder: number
  }) => void
  onProcedureRemove: (procedureId: string) => void
}

function DoctorBlock({
  doctor,
  proceduresOfThisDoctor,
  allProcedures,
  onSave,
  onRemove,
  onProcedureUpsert,
  onProcedureRemove,
}: DoctorBlockProps) {
  const [bio, setBio] = useState(doctor.bio ?? '')
  const [weekdays, setWeekdays] = useState<number[]>(doctor.availableWeekdays)
  const [availableFrom, setAvailableFrom] = useState(doctor.availableFrom.slice(0, 5))
  const [availableUntil, setAvailableUntil] = useState(doctor.availableUntil.slice(0, 5))
  const [lunchFrom, setLunchFrom] = useState(doctor.lunchBreakFrom?.slice(0, 5) ?? '')
  const [lunchUntil, setLunchUntil] = useState(doctor.lunchBreakUntil?.slice(0, 5) ?? '')

  const availableProceduresForAdd = allProcedures.filter(
    (p) => !proceduresOfThisDoctor.some((pp) => pp.procedureId === p.id),
  )

  function toggleWeekday(day: number) {
    setWeekdays((cur) =>
      cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day],
    )
  }

  function save() {
    onSave({
      doctorId: doctor.doctorId,
      displayOrder: doctor.displayOrder,
      bio: bio.trim() || null,
      availableWeekdays: weekdays,
      availableFrom,
      availableUntil,
      lunchBreakFrom: lunchFrom || null,
      lunchBreakUntil: lunchUntil || null,
    })
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-900">{doctor.doctorFullName}</p>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1 text-[11px] text-destructive hover:underline"
        >
          <Trash2 className="h-3 w-3" /> Remover do link público
        </button>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`bio_${doctor.doctorId}`} className="text-[11px]">
            Bio (opcional, máx 500)
          </Label>
          <textarea
            id={`bio_${doctor.doctorId}`}
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 500))}
            placeholder="Ex.: Ortopedista com 15 anos de experiência…"
            rows={2}
            className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-primary/30 focus:ring-2 focus:ring-primary/10"
          />
        </div>

        <div>
          <Label className="text-[11px]">Dias da semana</Label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {WEEKDAY_LABELS.map((w) => (
              <button
                key={w.value}
                type="button"
                onClick={() => toggleWeekday(w.value)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors',
                  weekdays.includes(w.value)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-[11px]">Início</Label>
            <Input
              type="time"
              value={availableFrom}
              onChange={(e) => setAvailableFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Fim</Label>
            <Input
              type="time"
              value={availableUntil}
              onChange={(e) => setAvailableUntil(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Almoço início (opcional)</Label>
            <Input
              type="time"
              value={lunchFrom}
              onChange={(e) => setLunchFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Almoço fim (opcional)</Label>
            <Input
              type="time"
              value={lunchUntil}
              onChange={(e) => setLunchUntil(e.target.value)}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={save}>
            Salvar profissional
          </Button>
        </div>

        {/* Procedimentos publicados pra este médico */}
        <div className="mt-2 border-t border-slate-200 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
              Procedimentos oferecidos publicamente
            </p>
            {availableProceduresForAdd.length > 0 ? (
              <AddProcedureRow
                available={availableProceduresForAdd}
                onAdd={(procedureId, displayName) =>
                  onProcedureUpsert({
                    doctorId: doctor.doctorId,
                    procedureId,
                    displayName,
                    durationMinutes: 30,
                    displayOrder: proceduresOfThisDoctor.length,
                  })
                }
              />
            ) : null}
          </div>
          {proceduresOfThisDoctor.length === 0 ? (
            <p className="text-[11px] text-slate-500">
              Nenhum procedimento publicado. Adicione pelo menos um para o paciente poder agendar.
            </p>
          ) : (
            <ul className="space-y-2">
              {proceduresOfThisDoctor.map((p) => (
                <ProcedureRow
                  key={p.procedureId}
                  procedure={p}
                  onSave={(payload) =>
                    onProcedureUpsert({
                      doctorId: doctor.doctorId,
                      procedureId: p.procedureId,
                      ...payload,
                    })
                  }
                  onRemove={() => onProcedureRemove(p.procedureId)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function AddProcedureRow({
  available,
  onAdd,
}: {
  available: ProcedureOption[]
  onAdd: (procedureId: string, displayName: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <div className="flex items-center gap-1.5">
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="h-7 w-44 text-[11px]">
          <SelectValue placeholder="+ Adicionar procedimento" />
        </SelectTrigger>
        <SelectContent>
          {available.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-7 px-2 text-[11px]"
        onClick={() => {
          const proc = available.find((p) => p.id === value)
          if (proc) {
            onAdd(proc.id, proc.name)
            setValue('')
          }
        }}
        disabled={!value}
      >
        <Plus className="h-3 w-3" />
      </Button>
    </div>
  )
}

function ProcedureRow({
  procedure,
  onSave,
  onRemove,
}: {
  procedure: PublicBookingConfigFull['procedures'][number]
  onSave: (payload: {
    displayName: string
    durationMinutes: number
    displayOrder: number
  }) => void
  onRemove: () => void
}) {
  const [displayName, setDisplayName] = useState(procedure.displayName)
  const [duration, setDuration] = useState(procedure.durationMinutes)
  const dirty =
    displayName !== procedure.displayName || duration !== procedure.durationMinutes

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white p-2 text-[11px]">
      <span className="min-w-[120px] truncate text-slate-500">{procedure.procedureName}</span>
      <Input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Nome amigável"
        className="h-7 flex-1 min-w-[120px] text-[11px]"
        maxLength={100}
      />
      <Input
        type="number"
        min={5}
        max={480}
        value={duration}
        onChange={(e) => setDuration(Math.max(5, Math.min(480, Number(e.target.value) || 30)))}
        className="h-7 w-20 text-[11px]"
      />
      <span className="text-slate-500">min</span>
      {dirty ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2 text-[11px]"
          onClick={() =>
            onSave({
              displayName,
              durationMinutes: duration,
              displayOrder: procedure.displayOrder,
            })
          }
        >
          Salvar
        </Button>
      ) : null}
      <button
        type="button"
        onClick={onRemove}
        className="ml-auto inline-flex items-center text-destructive hover:text-destructive/80"
        aria-label="Remover procedimento"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </li>
  )
}
