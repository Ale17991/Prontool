'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Area,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Baby, Loader2 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Curvas de crescimento infantil no prontuário.
 *
 * O gráfico mostra as bandas de percentil da OMS ao fundo e os pontos do
 * paciente por cima — que é como a curva é lida na prática: interessa a
 * TRAJETÓRIA entre canais, não o valor isolado. Uma criança no percentil 10
 * estável está melhor que uma que caiu do 50 para o 15 em três meses.
 */

interface Band {
  ageMonths: number
  p01: number
  p3: number
  p5: number
  p10: number
  p15: number
  p50: number
  p85: number
  p97: number
  p999: number
}
interface Point {
  measuredAt: string
  ageMonths: number
  value: number
  percentile: number
  classification: string
  label: string
}
interface Curve {
  indicator: string
  label: string
  unit: string
  points: Point[]
  bands: Band[]
  latest: { percentile: number; label: string; classification: string } | null
}
interface Report {
  curves: Curve[]
  ageMonthsNow: number | null
  missing: { birthDate: boolean; sex: boolean }
  outOfRange: boolean
}

const CLASS_COLOR: Record<string, string> = {
  muito_baixo: 'text-red-600',
  baixo: 'text-amber-600',
  adequado: 'text-emerald-600',
  risco: 'text-amber-600',
  elevado: 'text-orange-600',
  muito_elevado: 'text-red-600',
}

function ageLabel(months: number): string {
  if (months < 24) return `${Math.round(months)}m`
  const y = Math.floor(months / 12)
  const m = Math.round(months - y * 12)
  return m === 0 ? `${y}a` : `${y}a${m}m`
}

export function GrowthSection({ patientId }: { patientId: string }) {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/pacientes/${patientId}/crescimento`)
      if (res.ok) setReport((await res.json()) as Report)
    } finally {
      setLoading(false)
    }
  }, [patientId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando curvas…
        </CardContent>
      </Card>
    )
  }
  if (!report) return null

  // Adulto não tem curva pediátrica — some em silêncio em vez de ocupar espaço
  // com um aviso que vale para a maioria dos pacientes da clínica.
  if (report.outOfRange) return null

  const faltando = report.missing.birthDate || report.missing.sex
  const semDados = !faltando && report.curves.every((c) => c.points.length === 0)
  if (semDados) return null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Baby className="h-4 w-4 text-primary" />
        <CardTitle className="text-sm">Curvas de crescimento</CardTitle>
        {report.ageMonthsNow !== null ? (
          <span className="ml-auto text-xs text-slate-400">
            {ageLabel(report.ageMonthsNow)}
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {faltando ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Para traçar as curvas é preciso{' '}
            {report.missing.birthDate && report.missing.sex
              ? 'a data de nascimento e o sexo'
              : report.missing.birthDate
                ? 'a data de nascimento'
                : 'o sexo'}{' '}
            no cadastro. A referência da OMS é por idade e sexo — sem isso não há com o que comparar.
          </p>
        ) : null}

        {report.curves.map((c) => {
          if (c.points.length === 0) return null
          // Uma série só: as bandas em cada mês e, no mês da aferição, o ponto.
          const data = c.bands.map((b) => {
            const p = c.points.find((x) => Math.abs(x.ageMonths - b.ageMonths) < 0.5)
            return {
              ageMonths: b.ageMonths,
              faixaBaixa: [b.p01, b.p3],
              faixaNormal: [b.p3, b.p85],
              faixaAlta: [b.p85, b.p999],
              p50: b.p50,
              paciente: p?.value ?? null,
            }
          })

          return (
            <div key={c.indicator}>
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-xs font-semibold text-slate-700">{c.label}</span>
                {c.latest ? (
                  <span className={`text-xs font-medium ${CLASS_COLOR[c.latest.classification] ?? ''}`}>
                    {c.latest.label} · percentil {Math.round(c.latest.percentile)}
                  </span>
                ) : null}
              </div>
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                    <XAxis
                      dataKey="ageMonths"
                      tickFormatter={(v: number) => ageLabel(Number(v))}
                      tick={{ fontSize: 10 }}
                      stroke="#cbd5e1"
                    />
                    <YAxis
                      tick={{ fontSize: 10 }}
                      stroke="#cbd5e1"
                      domain={['dataMin - 1', 'dataMax + 1']}
                    />
                    {/* Bandas ao fundo: fora do 3–85 chama atenção sem alarmar. */}
                    <Area
                      dataKey="faixaBaixa"
                      fill="#fef3c7"
                      stroke="none"
                      isAnimationActive={false}
                    />
                    <Area
                      dataKey="faixaNormal"
                      fill="#dcfce7"
                      stroke="none"
                      isAnimationActive={false}
                    />
                    <Area
                      dataKey="faixaAlta"
                      fill="#fef3c7"
                      stroke="none"
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="p50"
                      stroke="#94a3b8"
                      strokeDasharray="4 3"
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey="paciente"
                      stroke="#0f172a"
                      strokeWidth={2}
                      connectNulls
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                    <Scatter dataKey="paciente" fill="#0f172a" isAnimationActive={false} />
                    <Tooltip
                      formatter={(v, n) =>
                        String(n) === 'paciente'
                          ? [`${String(v)} ${c.unit}`, 'Paciente']
                          : [String(v), 'P50']
                      }
                      labelFormatter={(v) => ageLabel(Number(v))}
                      contentStyle={{ fontSize: 11 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          )
        })}

        <p className="text-[10px] text-slate-400">
          Referência OMS por idade e sexo. A faixa verde vai do percentil 3 ao 85. O que importa é a
          trajetória entre canais, não o ponto isolado.
        </p>
      </CardContent>
    </Card>
  )
}
