/* eslint-disable react/no-unknown-property */
import {
  Circle,
  Document,
  Line,
  Page,
  Polyline,
  Svg,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import { ClinicHeader } from '@/lib/pdf/clinic-header'
import type { ClinicProfile } from '@/lib/core/clinic-profile/types'
import type { GrowthCurve } from '@/lib/core/growth/read'
import type { PercentileRow } from '@/lib/core/growth/classify'
import {
  PrintFooter,
  brDate,
  dash,
  printStyles as s,
} from './shared'
import { PatientIdentityBlock } from '@/lib/pdf/patient-identity-block'
import type { PatientIdentity } from '@/lib/core/printouts/patient-identity'

/**
 * Feature 054 US5 — avaliação infantil.
 *
 * A curva é **desenhada**, não vira tabela (research D3): a leitura clínica aqui
 * é posicional — a mãe precisa ver o ponto do filho entre as linhas, e uma
 * tabela de percentis não comunica isso. `recharts` não serve porque é React
 * DOM; o desenho sai das primitivas SVG do próprio renderer de PDF.
 *
 * Como todos os impressos, este não classifica nada: percentil e classificação
 * chegam prontos de `buildGrowthReport`, o mesmo caminho da tela.
 */

export interface GrowthPdfInput {
  clinicProfile: ClinicProfile | null
  identity: PatientIdentity
  professionalName: string
  issuedAt: string
  curves: GrowthCurve[]
}

const CHART = { width: 480, height: 150, padLeft: 6, padRight: 6, padTop: 8, padBottom: 8 }

export interface ChartGeometry {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

/** Percentis desenhados. Os extremos (0,1 e 99,9) ficam de fora: comprimem o
 *  eixo e empurram as linhas que importam para o meio do gráfico. */
const DRAWN: Array<{ key: keyof PercentileRow; label: string; strong: boolean }> = [
  { key: 'p3', label: 'P3', strong: true },
  { key: 'p15', label: 'P15', strong: false },
  { key: 'p50', label: 'P50', strong: true },
  { key: 'p85', label: 'P85', strong: false },
  { key: 'p97', label: 'P97', strong: true },
]

/**
 * Limites do gráfico: cobrem as bandas desenhadas **e** os pontos do paciente.
 *
 * O ponto entra no cálculo de propósito. Uma criança fora do percentil 97 é
 * exatamente o caso em que a curva precisa ser lida, e cortá-la na borda a
 * esconderia justamente ali.
 */
export function buildGeometry(curve: GrowthCurve): ChartGeometry | null {
  if (curve.bands.length === 0) return null
  const ages = curve.bands.map((b) => b.ageMonths)
  const values: number[] = []
  for (const b of curve.bands) for (const d of DRAWN) values.push(b[d.key] as number)
  for (const p of curve.points) {
    ages.push(p.ageMonths)
    values.push(p.value)
  }
  const xMin = Math.min(...ages)
  const xMax = Math.max(...ages)
  const yMin = Math.min(...values)
  const yMax = Math.max(...values)
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return null
  // Eixo degenerado (uma aferição só, banda plana) receberia divisão por zero.
  return {
    xMin,
    xMax: xMax > xMin ? xMax : xMin + 1,
    yMin,
    yMax: yMax > yMin ? yMax : yMin + 1,
  }
}

/** Coordenada no desenho. Y é invertido: no SVG ele cresce para baixo. */
export function project(g: ChartGeometry, ageMonths: number, value: number): { x: number; y: number } {
  const w = CHART.width - CHART.padLeft - CHART.padRight
  const h = CHART.height - CHART.padTop - CHART.padBottom
  const x = CHART.padLeft + ((ageMonths - g.xMin) / (g.xMax - g.xMin)) * w
  const y = CHART.padTop + h - ((value - g.yMin) / (g.yMax - g.yMin)) * h
  return { x, y }
}

function polyline(g: ChartGeometry, pts: Array<{ ageMonths: number; value: number }>): string {
  return pts
    .map((p) => {
      const { x, y } = project(g, p.ageMonths, p.value)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function Chart({ curve }: { curve: GrowthCurve }) {
  const g = buildGeometry(curve)
  if (!g) return null

  return (
    <Svg width={CHART.width} height={CHART.height}>
      {/* Moldura: sem ela as linhas flutuam e não se percebe onde o eixo acaba. */}
      <Line
        x1={CHART.padLeft}
        y1={CHART.height - CHART.padBottom}
        x2={CHART.width - CHART.padRight}
        y2={CHART.height - CHART.padBottom}
        strokeWidth={0.5}
        stroke="#94a3b8"
      />
      <Line
        x1={CHART.padLeft}
        y1={CHART.padTop}
        x2={CHART.padLeft}
        y2={CHART.height - CHART.padBottom}
        strokeWidth={0.5}
        stroke="#94a3b8"
      />

      {DRAWN.map((d) => (
        <Polyline
          key={String(d.key)}
          points={polyline(
            g,
            curve.bands.map((b) => ({ ageMonths: b.ageMonths, value: b[d.key] as number })),
          )}
          fill="none"
          stroke={d.strong ? '#94a3b8' : '#cbd5e1'}
          strokeWidth={d.key === 'p50' ? 1 : 0.6}
        />
      ))}

      {curve.points.length > 1 ? (
        <Polyline points={polyline(g, curve.points)} fill="none" stroke="#0f172a" strokeWidth={1.2} />
      ) : null}

      {curve.points.map((p) => {
        const { x, y } = project(g, p.ageMonths, p.value)
        return <Circle key={p.measuredAt} cx={x} cy={y} r={2.2} fill="#0f172a" />
      })}
    </Svg>
  )
}

function CurveBlock({ curve }: { curve: GrowthCurve }) {
  const g = buildGeometry(curve)
  const last = curve.points[curve.points.length - 1]

  return (
    <View style={{ marginTop: 12 }} wrap={false}>
      <Text style={s.h2}>{curve.label}</Text>

      {last ? (
        <Text style={{ marginBottom: 2 }}>
          Última aferição: {dash(Math.round(last.value * 10) / 10)} {curve.unit} em{' '}
          {brDate(last.measuredAt)} · percentil {dash(Math.round(last.percentile))} ·{' '}
          <Text style={s.bold}>{last.label}</Text>
        </Text>
      ) : (
        <Text style={s.subtle}>Sem aferição registrada para este indicador.</Text>
      )}

      {g ? (
        <View style={{ flexDirection: 'row', alignItems: 'stretch' }}>
          {/* Escala do eixo Y ao lado do desenho: dentro do SVG dependeria de
              primitiva de texto, e fora dele o valor fica selecionável. */}
          <View
            style={{
              width: 26,
              paddingRight: 3,
              justifyContent: 'space-between',
              alignItems: 'flex-end',
            }}
          >
            <Text style={s.subtle}>{dash(Math.round(g.yMax * 10) / 10)}</Text>
            <Text style={s.subtle}>{dash(Math.round(g.yMin * 10) / 10)}</Text>
          </View>
          <Chart curve={curve} />
        </View>
      ) : null}

      {g ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginLeft: 26 }}>
          <Text style={s.subtle}>{Math.round(g.xMin)} meses</Text>
          <Text style={s.subtle}>{Math.round(g.xMax)} meses</Text>
        </View>
      ) : null}
    </View>
  )
}

export async function renderGrowthPdf(input: GrowthPdfInput): Promise<Buffer> {
  const { curves, identity } = input

  const doc = (
    <Document>
      <Page size="A4" style={s.page}>
        <ClinicHeader profile={input.clinicProfile} subtitle="Avaliação do crescimento" />
        <PatientIdentityBlock identity={identity} />

        <Text style={s.subtle}>
          As linhas cinzas são os percentis 3, 15, 50, 85 e 97 da população da mesma idade e sexo. O
          traço escuro é o percurso da criança.
        </Text>

        {curves.map((c) => (
          <CurveBlock key={c.indicator} curve={c} />
        ))}

        <Text style={[s.subtle, { marginTop: 12 }]}>
          A leitura é comparativa: um valor só se interpreta contra a idade e o sexo. Este impresso
          não substitui a avaliação do profissional.
        </Text>

        <PrintFooter
          professionalName={input.professionalName}
          issuedAt={input.issuedAt}
          patientName={identity.name}
        />
      </Page>
    </Document>
  )

  return renderToBuffer(doc)
}
