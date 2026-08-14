'use client'

import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PieChart as PieIcon } from 'lucide-react'
import type { PortalCompositionView } from '@/lib/core/patient-portal/body-composition'
import type { PortalChartColors } from '@/lib/core/patient-portal/theme'
import { brDateOnly } from '@/lib/core/patient-portal/format'
import { formatDateLabel } from './evolution-chart'

/**
 * Feature 058 — a composição corporal do paciente.
 *
 * Mostra do que o peso é feito, na avaliação mais recente, e como isso vem
 * mudando. NENHUM número é calculado aqui: tudo chega pronto de
 * `getPortalBodyComposition`, que por sua vez lê o snapshot da avaliação.
 *
 * TRÊS COISAS QUE ESTA TELA NÃO FAZ, e cada uma é decisão, não omissão.
 *
 * Não classifica. Não existe "acima do ideal", "ótimo" ou faixa colorida
 * (FR-015): faixa de referência de percentual de gordura varia por sexo, idade,
 * protocolo e escola, e nada disso está cadastrado. Pintar uma banda diria ao
 * paciente que alguém afirmou normalidade onde ninguém afirmou — o mesmo motivo
 * pelo qual "Minha evolução" não desenha faixa com os limites anti-typo.
 *
 * Não transforma ausência em zero. Valor que a avaliação não apurou sai como
 * travessão, e a rosca só é desenhada quando as duas massas existem: uma rosca
 * com uma fatia zerada afirmaria "gordura: nenhuma".
 *
 * Não esconde a troca de método. Cada leitura carrega o protocolo que a gerou, e
 * a série avisa quando há mais de um. Dobras e bioimpedância medem coisas
 * diferentes; sem o aviso, trocar de aparelho pareceria emagrecer.
 *
 * As cores vêm da clínica (058): `palette` chega resolvida em hex porque o
 * recharts escreve `stroke`/`fill` como atributo de apresentação do SVG, e ali
 * `var(--token)` não resolve de forma confiável entre navegadores.
 */

const DEFAULT_PALETTE: PortalChartColors = {
  axis: '#58697E',
  grid: '#e2e8f0',
  accent: '#003883',
  neutral: '#cbd5e1',
  text: '#141D23',
}

/** Ausência é travessão, nunca zero. */
function dash(v: number | null, digits: number, unit: string): string {
  return v === null ? '—' : `${v.toFixed(digits).replace('.', ',')} ${unit}`
}

export function BodyCompositionCard({
  view,
  palette,
}: {
  view: PortalCompositionView
  palette?: PortalChartColors | null
}) {
  const c = palette ?? DEFAULT_PALETTE
  const { latest, points, methodLabels, hasTrend } = view
  if (!latest) return null

  // A rosca representa PROPORÇÃO, e proporção exige as duas partes. Com uma só,
  // a fatia que falta viraria vazio — que se lê como zero.
  const canDraw =
    latest.fatMassKg !== null &&
    latest.leanMassKg !== null &&
    latest.fatMassKg + latest.leanMassKg > 0
  const slices = canDraw
    ? [
        { name: 'Massa gorda', value: latest.fatMassKg!, tone: c.accent },
        { name: 'Massa magra', value: latest.leanMassKg!, tone: c.neutral },
      ]
    : []

  // O percentual de massa magra sai das massas GRAVADAS, não de "100 menos a
  // gordura". Dá no mesmo número — as duas somam o peso por construção — mas
  // vem do dado em vez de uma identidade aritmética que deixaria de valer se um
  // dia a avaliação passasse a gravar um terceiro compartimento.
  const totalKg = canDraw ? latest.fatMassKg! + latest.leanMassKg! : null
  const leanPct = totalKg ? (latest.leanMassKg! / totalKg) * 100 : null

  const trend = points
    .filter((p) => p.fatPct !== null)
    .map((p) => ({ date: formatDateLabel(p.assessedAt), valor: p.fatPct as number }))

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <PieIcon className="h-4 w-4 text-primary" />
          Composição corporal
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Avaliação de {brDateOnly(latest.assessedAt)}
          {latest.methodLabel ? ` · ${latest.methodLabel}` : ''}
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {canDraw ? (
            <div className="relative mx-auto h-40 w-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={slices}
                    dataKey="value"
                    nameKey="name"
                    innerRadius="66%"
                    outerRadius="100%"
                    startAngle={90}
                    endAngle={-270}
                    paddingAngle={1.5}
                    stroke="none"
                    isAnimationActive={false}
                  >
                    {slices.map((s) => (
                      <Cell key={s.name} fill={s.tone} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {/* O número no miolo é o que a pessoa veio ver. Fica fora do SVG
                  para herdar a tipografia e os tokens do resto do portal. */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black tabular-nums leading-none text-foreground">
                  {latest.fatPct === null ? '—' : `${latest.fatPct.toFixed(1).replace('.', ',')}%`}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  de gordura
                </span>
              </div>
            </div>
          ) : null}

          <dl className="min-w-0 flex-1 space-y-2">
            <Row
              tone={canDraw ? c.accent : null}
              label="Massa gorda"
              value={dash(latest.fatMassKg, 1, 'kg')}
              hint={
                latest.fatPct === null ? null : `${latest.fatPct.toFixed(1).replace('.', ',')}%`
              }
            />
            <Row
              tone={canDraw ? c.neutral : null}
              label="Massa magra"
              value={dash(latest.leanMassKg, 1, 'kg')}
              hint={leanPct === null ? null : `${leanPct.toFixed(1).replace('.', ',')}%`}
            />
            <Row tone={null} label="Peso" value={dash(latest.weightKg, 1, 'kg')} hint={null} />
          </dl>
        </div>

        {hasTrend && trend.length >= 2 ? (
          <div>
            <p className="mb-1 text-xs font-bold text-foreground">Evolução do % de gordura</p>
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: c.axis }}
                    stroke={c.grid}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: c.axis }}
                    stroke={c.grid}
                    tickLine={false}
                    width={34}
                    unit="%"
                    domain={['dataMin - 2', 'dataMax + 2']}
                  />
                  <Line
                    type="monotone"
                    dataKey="valor"
                    stroke={c.accent}
                    strokeWidth={2}
                    dot={{ r: 3, fill: c.accent, stroke: c.accent }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Esta é a sua primeira avaliação com composição corporal. A linha de evolução aparece a
            partir da segunda.
          </p>
        )}

        {methodLabels.length > 1 ? (
          <p className="rounded-lg border border-border bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Suas avaliações foram feitas por métodos diferentes ({methodLabels.join(', ')}). Cada
            método mede de um jeito, então a comparação direta entre elas não é exata.
          </p>
        ) : null}

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Estes números descrevem a sua composição corporal; eles não dizem sozinhos se algo está
          bom ou ruim. Quem interpreta é a equipe da clínica, na sua consulta.
        </p>
      </CardContent>
    </Card>
  )
}

function Row({
  tone,
  label,
  value,
  hint,
}: {
  tone: string | null
  label: string
  value: string
  hint: string | null
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0">
      <dt className="flex items-center gap-2 text-sm text-muted-foreground">
        {tone ? (
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: tone }}
          />
        ) : (
          <span aria-hidden className="h-2.5 w-2.5 shrink-0" />
        )}
        {label}
      </dt>
      <dd className="shrink-0 text-sm font-bold tabular-nums text-foreground">
        {value}
        {hint ? <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span> : null}
      </dd>
    </div>
  )
}
