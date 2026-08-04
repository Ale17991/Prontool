'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Activity, FlaskConical, Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PatientTypeahead, type PatientTypeaheadValue } from '@/components/patients/patient-typeahead'
import { MetricEvolutionChart } from '@/components/patient-portal/evolution-chart'
import type { MeasurementDTO } from '@/lib/core/patient-portal/measurements'
import type { PatientMetricType } from '@/lib/core/patient-portal/metric-types'
import { GoalsEditor } from '../pacientes/[id]/goals-editor'
import {
  computeComposition,
  computeEnergy,
  compositionAdvisories,
  energyAdvisories,
  type Advisory,
  ACTIVITY_FACTORS,
  INJURY_FACTORS,
  DOBRA_PROTOCOLS,
  TMB_EQUATIONS,
  type CompositionResult,
  type DobraProtocol,
  type EnergyResult,
  type Sex,
  type SkinfoldSite,
  type TmbEquation,
} from '@/lib/core/nutrition'

const SKINFOLD_LABEL: Record<SkinfoldSite, string> = {
  triceps: 'Tríceps',
  biceps: 'Bíceps',
  subescapular: 'Subescapular',
  suprailiaca: 'Supra-ilíaca',
  peitoral: 'Peitoral',
  axilar_media: 'Axilar média',
  abdominal: 'Abdominal',
  coxa: 'Coxa',
  panturrilha: 'Panturrilha',
}

/** Níveis de atividade do EER (IOM 2005 / NASEM 2023) — o PA sai da tabela
 *  oficial por sexo e faixa etária no motor; aqui escolhe-se só o nível. */
const EER_ACTIVITY_LEVELS = [
  { value: '1', label: 'Sedentário / inativo' },
  { value: '2', label: 'Pouco ativo' },
  { value: '3', label: 'Ativo' },
  { value: '4', label: 'Muito ativo' },
]

function num(s: string): number | undefined {
  if (s.trim() === '') return undefined
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}

/** Idade em anos a partir da data de nascimento (ISO). */
function ageFromBirth(iso: string): number | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const now = new Date()
  let a = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--
  return a >= 0 && a < 130 ? a : null
}

interface AssessmentSummary {
  id: string
  assessedAt: string
  dobraProtocol: string | null
  tmbEquation: string | null
  fatPct: number | null
  imc: number | null
  tmbKcal: number | null
  getKcal: number | null
  targetKcal: number | null
}

export function NutritionAssessmentClient({
  canWrite,
  metricTypes,
}: {
  canWrite: boolean
  metricTypes: PatientMetricType[]
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [patient, setPatient] = useState<PatientTypeaheadValue | null>(null)
  const [assessedAt, setAssessedAt] = useState(today)
  const [sex, setSex] = useState<Sex>('M')
  const [age, setAge] = useState('')
  const [weight, setWeight] = useState('')
  const [height, setHeight] = useState('')

  // Composição
  const [protocol, setProtocol] = useState<DobraProtocol | ''>('')
  const [skinfolds, setSkinfolds] = useState<Record<string, string>>({})
  const [cintura, setCintura] = useState('')
  const [quadril, setQuadril] = useState('')
  const [abdomen, setAbdomen] = useState('')
  const [fatPctInput, setFatPctInput] = useState('')

  // Energia
  const [equation, setEquation] = useState<TmbEquation | ''>('')
  const [activity, setActivity] = useState('1.55')
  // Fator de injúria: existia no motor e na rota desde a 046, mas nunca teve
  // campo — o catálogo inteiro ficava inacessível. Default 1 = sem injúria.
  const [injury, setInjury] = useState('1')
  const [eerCategory, setEerCategory] = useState('1')
  const [objectiveDelta, setObjectiveDelta] = useState('0')
  const [protPct, setProtPct] = useState('30')
  const [carbPct, setCarbPct] = useState('40')
  const [lipPct, setLipPct] = useState('30')
  // Prescrição por quilo de peso: fixa proteína e gordura, o carboidrato
  // fecha o VET. É como a conta é feita na clínica.
  const [macroMode, setMacroMode] = useState<'percent' | 'gkg'>('percent')
  const [protGkg, setProtGkg] = useState('1.8')
  const [lipGkg, setLipGkg] = useState('1')

  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<AssessmentSummary[]>([])
  const [measurements, setMeasurements] = useState<Record<string, MeasurementDTO[]>>({})

  const protoMeta = protocol ? DOBRA_PROTOCOLS[protocol] : null
  const eqMeta = equation ? TMB_EQUATIONS[equation] : null

  async function loadPatientData(patientId: string) {
    const [assessRes, measRes] = await Promise.all([
      fetch(`/api/pacientes/${patientId}/avaliacao-nutricional`),
      fetch(`/api/pacientes/${patientId}/medicoes`),
    ])
    setHistory(
      assessRes.ok
        ? ((await assessRes.json()) as { assessments: AssessmentSummary[] }).assessments
        : [],
    )
    setMeasurements(
      measRes.ok
        ? ((await measRes.json()) as { measurements: Record<string, MeasurementDTO[]> }).measurements
        : {},
    )
  }

  // Reaproveita o que já está no cadastro: idade (da data de nascimento) e sexo.
  async function prefillFromPatient(patientId: string) {
    const res = await fetch(`/api/pacientes/${patientId}`)
    if (!res.ok) return
    const { patient: p } = (await res.json()) as {
      patient: { birthDate: string | null; sex: string | null } | null
    }
    if (!p) return
    if (p.birthDate) {
      const a = ageFromBirth(p.birthDate)
      if (a !== null) setAge(String(a))
    }
    if (p.sex === 'masculino') setSex('M')
    else if (p.sex === 'feminino') setSex('F')
  }

  useEffect(() => {
    if (patient) {
      void loadPatientData(patient.id)
      void prefillFromPatient(patient.id)
    } else {
      setHistory([])
      setMeasurements({})
    }
  }, [patient])

  // Cálculo ao vivo (motor puro no cliente).
  const live = useMemo((): {
    composition: CompositionResult | null
    compositionError: string | null
    energy: EnergyResult | null
    energyError: string | null
  } => {
    const ageN = num(age)
    const weightN = num(weight)
    const heightN = num(height)
    let composition: CompositionResult | null = null
    let compositionError: string | null = null
    let energy: EnergyResult | null = null
    let energyError: string | null = null

    if (protocol && ageN !== undefined && weightN !== undefined) {
      try {
        composition = computeComposition({
          sex,
          ageYears: ageN,
          weightKg: weightN,
          heightCm: heightN ?? null,
          protocol,
          skinfolds: Object.fromEntries(
            Object.entries(skinfolds).map(([k, v]) => [k, num(v)]),
          ) as Partial<Record<SkinfoldSite, number>>,
          circumferences: {
            cintura: num(cintura),
            quadril: num(quadril),
            abdomen: num(abdomen),
          },
          fatPctInput: num(fatPctInput) ?? null,
        })
      } catch (e) {
        compositionError = (e as Error).message
      }
    }

    if (equation && ageN !== undefined && weightN !== undefined) {
      try {
        energy = computeEnergy({
          sex,
          ageYears: ageN,
          weightKg: weightN,
          heightCm: heightN ?? null,
          leanMassKg: composition?.leanMassKg ?? null,
          equation,
          activityFactor: num(activity) ?? null,
          injuryFactor: num(injury) ?? null,
          eerCategory: (Number(eerCategory) as 1 | 2 | 3 | 4) ?? 1,
          objective: 'manutencao',
          objectiveDeltaKcal: num(objectiveDelta) ?? 0,
          macros: macroMode === 'gkg'
            ? { protGkg: num(protGkg) ?? 0, lipGkg: num(lipGkg) ?? 0 }
            : { protPct: num(protPct), carbPct: num(carbPct), lipPct: num(lipPct) },
        })
      } catch (e) {
        energyError = (e as Error).message
      }
    }
    return { composition, compositionError, energy, energyError }
  }, [
    sex, age, weight, height, protocol, skinfolds, cintura, quadril, abdomen, fatPctInput,
    equation, activity, injury, eerCategory, objectiveDelta, protPct, carbPct, lipPct,
    macroMode, protGkg, lipGkg,
  ])

  // Avisos de domínio de validação — não bloqueiam nada, só informam.
  const advisories = useMemo(() => {
    const ageN = num(age)
    if (ageN === undefined) return []
    return [
      ...(protocol
        ? compositionAdvisories({
            protocol,
            sex,
            ageYears: ageN,
          })
        : []),
      ...(equation ? energyAdvisories({ equation, ageYears: ageN }) : []),
    ]
  }, [protocol, equation, sex, age])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (!patient) return setError('Selecione um paciente.')
    const ageN = num(age)
    const weightN = num(weight)
    if (ageN === undefined || weightN === undefined) return setError('Preencha idade e peso.')
    if (!protocol && !equation) return setError('Preencha composição corporal ou gasto energético.')

    setPending(true)
    try {
      const body: Record<string, unknown> = {
        assessed_at: assessedAt,
        sex,
        age_years: ageN,
        weight_kg: weightN,
        height_cm: num(height) ?? null,
        notes: notes.trim() || null,
      }
      if (protocol) {
        body.dobra_protocol = protocol
        body.skinfolds = Object.fromEntries(
          Object.entries(skinfolds)
            .map(([k, v]) => [k, num(v)])
            .filter(([, v]) => v !== undefined),
        )
        body.circumferences = Object.fromEntries(
          [
            ['cintura', num(cintura)],
            ['quadril', num(quadril)],
            ['abdomen', num(abdomen)],
          ].filter(([, v]) => v !== undefined),
        )
        if (protocol === 'bioimpedancia') body.fat_pct_input = num(fatPctInput) ?? null
      }
      if (equation) {
        body.tmb_equation = equation
        if (!TMB_EQUATIONS[equation].eer) body.activity_factor = num(activity) ?? null
        else body.eer_category = Number(eerCategory)
        body.injury_factor = num(injury) ?? null
        body.objective_delta_kcal = num(objectiveDelta) ?? 0
        body.macros = macroMode === 'gkg'
            ? { protGkg: num(protGkg) ?? 0, lipGkg: num(lipGkg) ?? 0 }
            : { protPct: num(protPct), carbPct: num(carbPct), lipPct: num(lipPct) }
      }
      const res = await fetch(`/api/pacientes/${patient.id}/avaliacao-nutricional`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao salvar a avaliação.')
        return
      }
      await loadPatientData(patient.id)
      setError(null)
    } finally {
      setPending(false)
    }
  }

  const latest = history[0] ?? null

  return (
    <div className="space-y-6">
    <div className="grid gap-6 lg:grid-cols-3">
      <form onSubmit={onSubmit} className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Paciente e dados base</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="col-span-2 md:col-span-4">
              <Label>Paciente</Label>
              <PatientTypeahead value={patient?.id ?? null} onChange={setPatient} allowCreate />
              {patient ? (
                <p className="mt-1 text-[11px] text-slate-400">
                  Sexo e idade vêm do cadastro do paciente (idade calculada da data de nascimento) —
                  ajuste se necessário.
                </p>
              ) : null}
            </div>
            <div>
              <Label htmlFor="na_date">Data</Label>
              <Input id="na_date" type="date" max={today} value={assessedAt} onChange={(e) => setAssessedAt(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="na_sex">Sexo</Label>
              <select id="na_sex" className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={sex} onChange={(e) => setSex(e.target.value as Sex)}>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
              </select>
            </div>
            <div>
              <Label htmlFor="na_age">Idade (anos)</Label>
              <Input id="na_age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="na_weight">Peso (kg)</Label>
              <Input id="na_weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="na_height">Altura (cm)</Label>
              <Input id="na_height" inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Activity className="h-4 w-4 text-primary" /> Composição corporal
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="na_proto">Protocolo</Label>
              <select id="na_proto" className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={protocol} onChange={(e) => setProtocol(e.target.value as DobraProtocol | '')}>
                <option value="">— não avaliar —</option>
                {Object.values(DOBRA_PROTOCOLS).map((p) => (
                  <option key={p.slug} value={p.slug}>{p.label}</option>
                ))}
              </select>
            </div>
            {protoMeta && protocol !== 'bioimpedancia' ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {protoMeta.sites[sex].map((s) => (
                  <div key={s}>
                    <Label htmlFor={`sf_${s}`}>{SKINFOLD_LABEL[s]} (mm)</Label>
                    <Input id={`sf_${s}`} inputMode="decimal" value={skinfolds[s] ?? ''} onChange={(e) => setSkinfolds((v) => ({ ...v, [s]: e.target.value }))} />
                  </div>
                ))}
                {/* Weltman pede UMA circunferência abdominal, como no documento
                    de base. O segundo campo saiu em 2026-08-03. */}
                {protocol === 'weltman' ? (
                  <div>
                    <Label htmlFor="c_abd">Circ. abdominal (cm)</Label>
                    <Input id="c_abd" inputMode="decimal" value={abdomen} onChange={(e) => setAbdomen(e.target.value)} />
                  </div>
                ) : null}
              </div>
            ) : null}
            {protocol === 'bioimpedancia' ? (
              <div className="max-w-[200px]">
                <Label htmlFor="bia_fat">% de gordura (aparelho)</Label>
                <Input id="bia_fat" inputMode="decimal" value={fatPctInput} onChange={(e) => setFatPctInput(e.target.value)} />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <Label htmlFor="c_cint">Cintura (cm)</Label>
                <Input id="c_cint" inputMode="decimal" value={cintura} onChange={(e) => setCintura(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="c_quad">Quadril (cm)</Label>
                <Input id="c_quad" inputMode="decimal" value={quadril} onChange={(e) => setQuadril(e.target.value)} />
              </div>
            </div>
            {live.compositionError ? <p className="text-xs text-amber-600">{live.compositionError}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <FlaskConical className="h-4 w-4 text-primary" /> Gasto energético
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div className="col-span-2 md:col-span-1">
                <Label htmlFor="na_eq">Equação de TMB</Label>
                <select id="na_eq" className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={equation} onChange={(e) => setEquation(e.target.value as TmbEquation | '')}>
                  <option value="">— não avaliar —</option>
                  {Object.values(TMB_EQUATIONS).map((q) => (
                    <option key={q.slug} value={q.slug}>{q.label}</option>
                  ))}
                </select>
              </div>
              {eqMeta && !eqMeta.eer ? (
                <div>
                  <Label htmlFor="na_act">Fator de atividade</Label>
                  <select id="na_act" className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={activity} onChange={(e) => setActivity(e.target.value)}>
                    {ACTIVITY_FACTORS.map((a) => (
                      <option key={a.value} value={a.value}>{a.value} — {a.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <Label htmlFor="na_inj">Fator de injúria</Label>
                <select
                  id="na_inj"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={injury}
                  onChange={(e) => setInjury(e.target.value)}
                >
                  {INJURY_FACTORS.map((f, i) => (
                    <option key={`${f.value}-${i}`} value={String(f.value)}>
                      {f.value} · {f.label}
                      {f.range ? ` (faixa ${f.range})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {eqMeta?.eer === 'category' || eqMeta?.eer === 'pa' ? (
                <div>
                  <Label htmlFor="na_cat">Nível de atividade</Label>
                  <select id="na_cat" className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={eerCategory} onChange={(e) => setEerCategory(e.target.value)}>
                    {EER_ACTIVITY_LEVELS.map((a) => (
                      <option key={a.value} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div>
                <Label htmlFor="na_delta">Ajuste do objetivo (kcal)</Label>
                <Input id="na_delta" inputMode="numeric" value={objectiveDelta} onChange={(e) => setObjectiveDelta(e.target.value)} />
              </div>
            </div>
            <div>
              <Label htmlFor="m_mode">Prescrição dos macros</Label>
              <select
                id="m_mode"
                className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                value={macroMode}
                onChange={(e) => setMacroMode(e.target.value as 'percent' | 'gkg')}
              >
                <option value="percent">Por percentual do VET</option>
                <option value="gkg">Por g/kg de peso (carboidrato fecha o VET)</option>
              </select>
            </div>
            {macroMode === 'gkg' ? (
              <div className="grid grid-cols-2 gap-3">
                <div><Label htmlFor="m_pk">Proteína g/kg</Label><Input id="m_pk" inputMode="decimal" value={protGkg} onChange={(e) => setProtGkg(e.target.value)} /></div>
                <div><Label htmlFor="m_lk">Lipídio g/kg</Label><Input id="m_lk" inputMode="decimal" value={lipGkg} onChange={(e) => setLipGkg(e.target.value)} /></div>
                <p className="col-span-2 text-[11px] text-slate-400">
                  O carboidrato completa o valor energético — não precisa informar.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div><Label htmlFor="m_p">Proteína %</Label><Input id="m_p" inputMode="numeric" value={protPct} onChange={(e) => setProtPct(e.target.value)} /></div>
                <div><Label htmlFor="m_c">Carboidrato %</Label><Input id="m_c" inputMode="numeric" value={carbPct} onChange={(e) => setCarbPct(e.target.value)} /></div>
                <div><Label htmlFor="m_l">Lipídio %</Label><Input id="m_l" inputMode="numeric" value={lipPct} onChange={(e) => setLipPct(e.target.value)} /></div>
              </div>
            )}
            {live.energyError ? <p className="text-xs text-amber-600">{live.energyError}</p> : null}
          </CardContent>
        </Card>

        <div>
          <Label htmlFor="na_notes">Observações</Label>
          <Input id="na_notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</p>
        ) : null}

        {canWrite ? (
          <Button type="submit" disabled={pending || !patient} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar avaliação
          </Button>
        ) : null}
      </form>

      <div className="space-y-4">
        <ResultPanel
          composition={live.composition}
          energy={live.energy}
          advisories={advisories}
          sources={[protoMeta?.source, eqMeta?.source].filter((s): s is string => !!s)}
        />
        <HistoryPanel history={history} hasPatient={!!patient} />
      </div>
    </div>

      {patient ? (
        <EvolutionSection
          patientId={patient.id}
          metricTypes={metricTypes}
          measurements={measurements}
          latest={latest}
          canWrite={canWrite}
        />
      ) : null}
    </div>
  )
}

/** T033/T034/T035 — evolução dos derivados + metas do paciente + VET da última avaliação. */
function EvolutionSection({
  patientId,
  metricTypes,
  measurements,
  latest,
  canWrite,
}: {
  patientId: string
  metricTypes: PatientMetricType[]
  measurements: Record<string, MeasurementDTO[]>
  latest: AssessmentSummary | null
  canWrite: boolean
}) {
  const chartsWithData = metricTypes.filter((t) => (measurements[t.metricType] ?? []).length >= 1)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Metas e evolução</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {latest && (latest.targetKcal !== null || latest.getKcal !== null) ? (
            <div className="rounded-md border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-sm">
              <span className="text-slate-500">Meta da última avaliação ({latest.assessedAt}):</span>{' '}
              <span className="font-semibold text-slate-800">
                {latest.targetKcal !== null
                  ? `VET ${latest.targetKcal} kcal`
                  : `GET ${latest.getKcal} kcal`}
              </span>
            </div>
          ) : null}
          <GoalsEditor patientId={patientId} metricTypes={metricTypes} canWrite={canWrite} />
        </CardContent>
      </Card>

      {chartsWithData.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {chartsWithData.map((t) => (
            <MetricEvolutionChart
              key={t.metricType}
              label={t.label}
              unit={t.unit}
              points={(measurements[t.metricType] ?? []).map((m) => ({
                date: m.measuredAt,
                value: m.value,
              }))}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          Sem medições ainda — salve uma avaliação para ver a evolução.
        </p>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold tabular-nums text-slate-800">{value}</span>
    </div>
  )
}

function ResultPanel({
  composition,
  energy,
  advisories,
  sources,
}: {
  composition: CompositionResult | null
  energy: EnergyResult | null
  advisories: Advisory[]
  sources: string[]
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Resultado</CardTitle></CardHeader>
      <CardContent className="space-y-1.5">
        {composition ? (
          <>
            <Row label="% de gordura" value={`${composition.fatPct}%`} />
            <Row label="Massa gorda" value={`${composition.fatMassKg} kg`} />
            <Row label="Massa magra" value={`${composition.leanMassKg} kg`} />
            {composition.imc !== null ? <Row label="IMC" value={`${composition.imc} (${composition.imcClass})`} /> : null}
            {composition.waistHipRatio !== null ? <Row label="RCQ" value={`${composition.waistHipRatio}${composition.waistHipClass ? ` (${composition.waistHipClass})` : ''}`} /> : null}
          </>
        ) : null}
        {energy ? (
          <>
            <Row label="TMB" value={`${energy.tmbKcal} kcal`} />
            <Row label="Gasto total (GET)" value={`${energy.getKcal} kcal`} />
            {energy.targetKcal !== null ? <Row label="Meta (VET)" value={`${energy.targetKcal} kcal`} /> : null}
            {energy.macros ? <Row label="Macros" value={`P ${energy.macros.protG}g · C ${energy.macros.carbG}g · L ${energy.macros.lipG}g`} /> : null}
          </>
        ) : null}
        {!composition && !energy ? <p className="text-xs text-slate-400">Preencha o formulário para ver o resultado.</p> : null}

        {advisories.length > 0 ? (
          <div className="space-y-1.5 border-t border-slate-100 pt-2">
            {advisories.map((a) => (
              <p key={a.code} className="text-[11px] leading-snug text-amber-700">
                {a.message}
              </p>
            ))}
          </div>
        ) : null}

        {sources.length > 0 ? (
          <div className="space-y-0.5 border-t border-slate-100 pt-2">
            {sources.map((s) => (
              <p key={s} className="text-[10px] leading-snug text-slate-400">
                {s}
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function HistoryPanel({ history, hasPatient }: { history: AssessmentSummary[]; hasPatient: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">Histórico</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {!hasPatient ? (
          <p className="text-xs text-slate-400">Selecione um paciente.</p>
        ) : history.length === 0 ? (
          <p className="text-xs text-slate-400">Nenhuma avaliação registrada.</p>
        ) : (
          history.map((h) => (
            <div key={h.id} className="rounded-md border border-slate-200 p-2 text-xs">
              <div className="font-semibold text-slate-700">{h.assessedAt}</div>
              <div className="text-slate-500">
                {h.fatPct !== null ? `Gordura ${h.fatPct}% · ` : ''}
                {h.imc !== null ? `IMC ${h.imc} · ` : ''}
                {h.getKcal !== null ? `GET ${h.getKcal} kcal` : ''}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
