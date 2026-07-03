'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  Droplet,
  Heart,
  Loader2,
  Plus,
  Ruler,
  Scale,
  Thermometer,
  Wind,
  X,
} from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn, formatDateTime } from '@/lib/utils'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'

interface Props {
  patientId: string
  initial: VitalSignsDTO[]
  canWrite: boolean
  defaultShowForm?: boolean
  onSaved?: () => void
}

function bmiClassification(bmi: number | null): {
  label: string
  className: string
} | null {
  if (bmi === null) return null
  if (bmi < 18.5) return { label: 'Abaixo do peso', className: 'bg-info-bg text-info-text' }
  if (bmi < 25) return { label: 'Normal', className: 'bg-success-bg text-success-text' }
  if (bmi < 30)
    return {
      label: 'Sobrepeso',
      className: 'bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]',
    }
  return {
    label: 'Obeso',
    className: 'bg-[hsl(var(--alert)/0.15)] text-[hsl(var(--alert))]',
  }
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
}

export function VitalSignsSection({
  patientId,
  initial,
  canWrite,
  defaultShowForm = false,
  onSaved,
}: Props) {
  const router = useRouter()
  const [items, setItems] = useState(initial)
  const [showForm, setShowForm] = useState(defaultShowForm)

  async function refresh() {
    const res = await fetch(`/api/pacientes/${patientId}/sinais-vitais`)
    if (res.ok) setItems((await res.json()) as VitalSignsDTO[])
    router.refresh()
  }

  const last = items[0] ?? null
  const lastTen = items.slice(0, 10)

  // Série pra chart: ordem cronológica ascendente, últimos 30.
  const chartData = items
    .slice(0, 30)
    .reverse()
    .map((i) => ({
      date: fmtDate(i.measuredAt),
      pesoKg: i.weightGrams !== null ? i.weightGrams / 1000 : null,
      sistolica: i.systolicBp,
      diastolica: i.diastolicBp,
    }))

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-primary" />
          Sinais Vitais
        </CardTitle>
        {canWrite && !defaultShowForm ? (
          <Button
            size="sm"
            variant={showForm ? 'outline' : 'default'}
            onClick={() => setShowForm((v) => !v)}
            className="gap-1.5"
          >
            {showForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showForm ? 'Cancelar' : 'Novo registro'}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {showForm && canWrite ? (
          <NewVitalSignsForm
            patientId={patientId}
            onCreated={async () => {
              setShowForm(false)
              await refresh()
              onSaved?.()
            }}
          />
        ) : null}

        {last ? (
          <>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Último registro · {formatDateTime(last.measuredAt)}
            </p>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <VitalCard
                icon={Heart}
                label="Pressão"
                value={
                  last.systolicBp && last.diastolicBp
                    ? `${last.systolicBp}/${last.diastolicBp}`
                    : '—'
                }
                unit="mmHg"
              />
              <VitalCard
                icon={Activity}
                label="FC"
                value={last.heartRate?.toString() ?? '—'}
                unit="bpm"
              />
              <VitalCard
                icon={Wind}
                label="FR"
                value={last.respiratoryRate?.toString() ?? '—'}
                unit="irpm"
              />
              <VitalCard
                icon={Thermometer}
                label="Temp"
                value={last.temperatureCelsius !== null ? last.temperatureCelsius.toFixed(1) : '—'}
                unit="°C"
              />
              <VitalCard
                icon={Droplet}
                label="SpO₂"
                value={last.oxygenSaturation?.toString() ?? '—'}
                unit="%"
              />
              <VitalCard
                icon={Scale}
                label="Peso"
                value={last.weightGrams !== null ? (last.weightGrams / 1000).toFixed(1) : '—'}
                unit="kg"
              />
              <VitalCard
                icon={Ruler}
                label="Altura"
                value={last.heightCm?.toString() ?? '—'}
                unit="cm"
              />
              <BmiCard bmi={last.bmi} />
            </div>

            {chartData.length >= 2 ? (
              <div className="h-56 pt-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Evolução
                </p>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
                    <YAxis
                      yAxisId="kg"
                      orientation="left"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      width={36}
                    />
                    <YAxis
                      yAxisId="bp"
                      orientation="right"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      width={36}
                    />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line
                      yAxisId="kg"
                      type="monotone"
                      dataKey="pesoKg"
                      name="Peso (kg)"
                      stroke="#10b981"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                    <Line
                      yAxisId="bp"
                      type="monotone"
                      dataKey="sistolica"
                      name="Sistólica"
                      stroke="#dc2626"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                    <Line
                      yAxisId="bp"
                      type="monotone"
                      dataKey="diastolica"
                      name="Diastólica"
                      stroke="#1C4F71"
                      strokeWidth={2}
                      dot={{ r: 2 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : null}

            {lastTen.length > 1 ? (
              <div className="pt-2">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  Histórico (últimos 10)
                </p>
                <div className="overflow-x-auto rounded-md border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>PA</TableHead>
                        <TableHead>FC</TableHead>
                        <TableHead>Temp</TableHead>
                        <TableHead>SpO₂</TableHead>
                        <TableHead>Peso</TableHead>
                        <TableHead>IMC</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lastTen.map((v) => (
                        <TableRow key={v.id}>
                          <TableCell className="text-[11px] text-slate-600">
                            {formatDateTime(v.measuredAt)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {v.systolicBp && v.diastolicBp
                              ? `${v.systolicBp}/${v.diastolicBp}`
                              : '—'}
                          </TableCell>
                          <TableCell className="text-xs">{v.heartRate ?? '—'}</TableCell>
                          <TableCell className="text-xs">
                            {v.temperatureCelsius?.toFixed(1) ?? '—'}
                          </TableCell>
                          <TableCell className="text-xs">{v.oxygenSaturation ?? '—'}</TableCell>
                          <TableCell className="text-xs">
                            {v.weightGrams !== null ? (v.weightGrams / 1000).toFixed(1) : '—'}
                          </TableCell>
                          <TableCell className="text-xs">{v.bmi?.toFixed(1) ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-slate-500">Nenhum registro de sinais vitais ainda.</p>
        )}
      </CardContent>
    </Card>
  )
}

function VitalCard({
  icon: Icon,
  label,
  value,
  unit,
}: {
  icon: typeof Activity
  label: string
  value: string
  unit: string
}) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
      </div>
      <p className="mt-1 text-lg font-black tabular-nums text-slate-900">
        {value} <span className="text-[10px] font-normal text-slate-500">{unit}</span>
      </p>
    </div>
  )
}

function BmiCard({ bmi }: { bmi: number | null }) {
  const cls = bmiClassification(bmi)
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">IMC</p>
      <p className="mt-1 text-lg font-black tabular-nums text-slate-900">
        {bmi?.toFixed(1) ?? '—'}
      </p>
      {cls ? (
        <Badge variant="secondary" className={cn('mt-1 h-5 px-2 text-[10px]', cls.className)}>
          {cls.label}
        </Badge>
      ) : null}
    </div>
  )
}

function NewVitalSignsForm({
  patientId,
  onCreated,
}: {
  patientId: string
  onCreated: () => Promise<void>
}) {
  const [systolicBp, setSystolicBp] = useState('')
  const [diastolicBp, setDiastolicBp] = useState('')
  const [heartRate, setHeartRate] = useState('')
  const [respiratoryRate, setRespiratoryRate] = useState('')
  const [temperature, setTemperature] = useState('')
  const [spo2, setSpo2] = useState('')
  const [weightKg, setWeightKg] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    const intOrNull = (s: string): number | null => {
      const v = Number(s)
      return s.trim() === '' || !Number.isFinite(v) ? null : Math.round(v)
    }
    const numOrNull = (s: string): number | null => {
      const v = Number(s.replace(',', '.'))
      return s.trim() === '' || !Number.isFinite(v) ? null : v
    }
    const weightGrams =
      weightKg.trim() === '' ? null : Math.round(Number(weightKg.replace(',', '.')) * 1000)

    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/sinais-vitais`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          systolic_bp: intOrNull(systolicBp),
          diastolic_bp: intOrNull(diastolicBp),
          heart_rate: intOrNull(heartRate),
          respiratory_rate: intOrNull(respiratoryRate),
          temperature_celsius: numOrNull(temperature),
          oxygen_saturation: intOrNull(spo2),
          weight_grams: weightGrams,
          height_cm: intOrNull(heightCm),
          notes: notes.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao registrar.')
        return
      }
      setSystolicBp('')
      setDiastolicBp('')
      setHeartRate('')
      setRespiratoryRate('')
      setTemperature('')
      setSpo2('')
      setWeightKg('')
      setHeightCm('')
      setNotes('')
      await onCreated()
    } finally {
      setPending(false)
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-2 gap-3 rounded-md border border-slate-200 bg-slate-50/50 p-3 md:grid-cols-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="vs_sis">PA Sistólica (mmHg)</Label>
        <Input
          id="vs_sis"
          inputMode="numeric"
          value={systolicBp}
          onChange={(e) => setSystolicBp(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vs_dia">PA Diastólica (mmHg)</Label>
        <Input
          id="vs_dia"
          inputMode="numeric"
          value={diastolicBp}
          onChange={(e) => setDiastolicBp(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vs_fc">FC (bpm)</Label>
        <Input
          id="vs_fc"
          inputMode="numeric"
          value={heartRate}
          onChange={(e) => setHeartRate(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vs_fr">FR (irpm)</Label>
        <Input
          id="vs_fr"
          inputMode="numeric"
          value={respiratoryRate}
          onChange={(e) => setRespiratoryRate(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vs_temp">Temp (°C)</Label>
        <Input
          id="vs_temp"
          inputMode="decimal"
          value={temperature}
          onChange={(e) => setTemperature(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vs_spo2">SpO₂ (%)</Label>
        <Input
          id="vs_spo2"
          inputMode="numeric"
          value={spo2}
          onChange={(e) => setSpo2(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vs_weight">Peso (kg)</Label>
        <Input
          id="vs_weight"
          inputMode="decimal"
          value={weightKg}
          onChange={(e) => setWeightKg(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="vs_height">Altura (cm)</Label>
        <Input
          id="vs_height"
          inputMode="numeric"
          value={heightCm}
          onChange={(e) => setHeightCm(e.target.value)}
        />
      </div>
      <div className="col-span-2 md:col-span-4 space-y-1.5">
        <Label htmlFor="vs_notes">Observações</Label>
        <Textarea
          id="vs_notes"
          className="min-h-[60px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      {error ? (
        <p className="col-span-2 md:col-span-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : null}
      <div className="col-span-2 md:col-span-4 flex justify-end">
        <Button type="submit" size="sm" disabled={pending} className="gap-2">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Salvar
        </Button>
      </div>
    </form>
  )
}
