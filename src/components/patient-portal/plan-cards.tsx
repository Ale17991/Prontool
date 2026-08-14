import { Dumbbell, UtensilsCrossed } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WorkoutPlan } from '@/lib/core/patient-portal/workout'
import type { PortalDietPlan, PortalNutrients } from '@/lib/core/patient-portal/diet'

/**
 * Feature 032 — render do plano de treino e do plano alimentar ATIVOS no portal
 * (dados reais, cadastrados pela equipe). Usados nas colunas laterais.
 */

export function WorkoutCard({ plan }: { plan: WorkoutPlan }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Dumbbell className="h-4 w-4 text-primary" />
          Rotina de treino
        </CardTitle>
        <p className="text-xs text-muted-foreground">{plan.title}</p>
        {plan.notes ? <p className="text-xs text-muted-foreground">{plan.notes}</p> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {plan.sessions.map((s, i) => (
          <div key={i} className="rounded-xl border border-border p-3">
            <p className="text-sm font-semibold text-foreground">
              {s.name}
              {s.focus ? (
                <span className="font-normal text-muted-foreground"> · {s.focus}</span>
              ) : null}
            </p>
            <ul className="mt-1.5 space-y-1">
              {s.exercises.map((e, k) => (
                <li key={k} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-muted-foreground">{e.name}</span>
                  <span className="shrink-0 font-medium tabular-nums text-muted-foreground">
                    {[
                      e.sets && e.reps
                        ? `${e.sets} × ${e.reps}`
                        : (e.reps ?? (e.sets ? `${e.sets}×` : '')),
                      e.loadKg ? `${e.loadKg}kg` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** kcal é inteiro; grama ganha uma casa só quando ela diz alguma coisa. */
function kcal(n: number): string {
  return `${Math.round(n)} kcal`
}
function grams(n: number): string {
  const r = Math.round(n * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)} g`
}

/**
 * Macros de uma linha. `null` NUNCA vira zero: plano legado (032) é texto livre
 * e não tem nutriente — imprimir "0 g de proteína" ali afirmaria sobre a comida
 * do paciente uma coisa que ninguém mediu.
 */
function Macros({ n, className = '' }: { n: PortalNutrients; className?: string }) {
  return (
    <span className={`tabular-nums ${className}`}>
      P {grams(n.proteinG)} · C {grams(n.carbG)} · G {grams(n.fatG)}
      {n.fiberG > 0 ? <> · Fibra {grams(n.fiberG)}</> : null}
    </span>
  )
}

/**
 * O plano alimentar como o paciente lê: o DIA dele, de cima para baixo.
 *
 * A versão anterior empilhava uma caixa igual por refeição, com nome, macros e
 * comida no mesmo peso e quase tudo em cinza de apoio. O efeito era um bloco
 * uniforme em que nada saltava — nem a hora de comer, nem o que comer. E são
 * essas duas perguntas que trazem o paciente aqui; os números são conferência.
 *
 * A hora virou o TRILHO à esquerda, com um ponto por refeição. É o formato de
 * linha do tempo, que é o que um plano alimentar de fato é: o dia em ordem.
 * Isso dá a âncora que faltava, torna a sequência legível de relance no celular
 * e devolve o alimento ao primeiro plano — ele é a única coisa em peso cheio.
 *
 * Refeição sem horário cadastrado não ganha rótulo inventado: o ponto continua
 * no trilho e a posição no dia segue sendo a ordem em que a equipe montou.
 */
export function DietCard({ plan }: { plan: PortalDietPlan }) {
  const t = plan.totals
  const target = plan.target

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <UtensilsCrossed className="h-4 w-4 text-primary" />
          Plano alimentar
        </CardTitle>
        <p className="text-xs text-muted-foreground">{plan.title}</p>
      </CardHeader>
      <CardContent>
        {/* Total do dia + meta. Sem meta cadastrada, mostra só o total: comparar
            com um alvo que não existe seria inventar referência. */}
        {t ? (
          <div className="rounded-xl border border-border bg-accent/50 px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-2xl font-black tabular-nums leading-none text-foreground">
                {Math.round(t.energyKcal).toLocaleString('pt-BR')}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">kcal por dia</span>
              {target ? (
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  meta {kcal(target.kcal)}
                </span>
              ) : null}
            </div>
            <MacroBar n={t} className="mt-2.5" />
            {target?.macros ? (
              <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
                Meta de macros: P {grams(target.macros.protG)} · C {grams(target.macros.carbG)} · G{' '}
                {grams(target.macros.fatG)}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* O trilho do dia. A borda esquerda liga uma refeição à seguinte; o
            ponto marca cada uma. */}
        <ol className="mt-4">
          {plan.meals.map((m, i) => (
            <li key={i} className="relative pb-5 pl-6 last:pb-0">
              {/* Linha vertical: para na última refeição, senão o dia pareceria
                  continuar depois do jantar. */}
              {i < plan.meals.length - 1 ? (
                <span aria-hidden className="absolute left-[5px] top-3 h-full w-px bg-border" />
              ) : null}
              <span
                aria-hidden
                className="absolute left-0 top-[5px] h-[11px] w-[11px] rounded-full border-2 border-primary bg-card"
              />

              <div className="flex flex-wrap items-baseline gap-x-2">
                {m.timeLabel ? (
                  <span className="text-xs font-black tabular-nums text-primary">
                    {m.timeLabel}
                  </span>
                ) : null}
                <h3 className="text-sm font-bold text-foreground">{m.name}</h3>
                {m.totals ? (
                  <span className="ml-auto shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
                    {kcal(m.totals.energyKcal)}
                  </span>
                ) : null}
              </div>
              {m.totals ? (
                <Macros n={m.totals} className="mt-1 block text-[11px] text-muted-foreground" />
              ) : null}

              <ul className="mt-2 space-y-1.5">
                {m.items.map((it, k) => (
                  <li key={k} className="text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      {/* O alimento é a informação: peso cheio, cor de texto.
                          A quantidade anda colada nele, não numa coluna à
                          parte — "2 fatias" só quer dizer algo junto do pão. */}
                      <span className="font-medium text-foreground">
                        {it.name}
                        {it.quantity ? (
                          <span className="font-normal text-muted-foreground">, {it.quantity}</span>
                        ) : null}
                      </span>
                      {it.nutrients ? (
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {kcal(it.nutrients.energyKcal)}
                        </span>
                      ) : null}
                    </div>
                    {it.nutrients ? (
                      <Macros
                        n={it.nutrients}
                        className="mt-0.5 block text-[11px] text-muted-foreground"
                      />
                    ) : null}

                    {/* Substitutos do grupo: é a razão de o grupo existir, então
                        vêm listados e com a quantidade de cada um — "ou: X · Y"
                        numa linha só escondia justamente o quanto comer. O filete
                        à esquerda mostra que pendem do alimento acima, sem a
                        caixa cinza dentro de caixa cinza que havia antes. */}
                    {it.options && it.options.length > 0 ? (
                      <div className="mt-1.5 border-l-2 border-primary/25 pl-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                          Pode trocar por
                        </p>
                        <ul className="mt-0.5 space-y-0.5">
                          {it.options.map((o, oi) => (
                            <li
                              key={oi}
                              className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground"
                            >
                              <span>{o.name}</span>
                              <span className="shrink-0 tabular-nums">{grams(o.grams)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>

        {plan.attribution ? (
          <p className="mt-4 border-t border-border pt-3 text-[10px] leading-snug text-muted-foreground opacity-70">
            Valores nutricionais: TACO (NEPA/UNICAMP, 2011) e IBGE/POF 2008-2009.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/**
 * Os macros do dia como PROPORÇÃO, não como três números soltos.
 *
 * "P 120 g · C 200 g · G 60 g" só diz alguma coisa para quem já sabe comparar
 * gramas de nutrientes diferentes — e o paciente é justamente quem não sabe. A
 * barra mostra a repartição da energia do dia, que é a leitura que ele consegue
 * fazer sozinha: o que ocupa mais do prato.
 *
 * A repartição é feita pelos fatores de Atwater (4/4/9 kcal por grama), que é
 * aritmética de apresentação sobre o total já calculado — não recálculo do
 * plano. Quando os macros somam zero (plano legado, que é texto livre e não tem
 * nutriente), não há barra: régua sem medida é pior que régua nenhuma.
 */
function MacroBar({ n, className = '' }: { n: PortalNutrients; className?: string }) {
  const parts = [
    { key: 'prot', label: 'Proteína', grams: n.proteinG, kcal: n.proteinG * 4, tone: 'bg-primary' },
    { key: 'carb', label: 'Carboidrato', grams: n.carbG, kcal: n.carbG * 4, tone: 'bg-primary/55' },
    { key: 'fat', label: 'Gordura', grams: n.fatG, kcal: n.fatG * 9, tone: 'bg-primary/25' },
  ]
  const total = parts.reduce((s, p) => s + p.kcal, 0)
  if (!(total > 0)) return null

  return (
    <div className={className}>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
        {parts.map((p) => (
          <span
            key={p.key}
            className={p.tone}
            style={{ width: `${(p.kcal / total) * 100}%` }}
            aria-hidden
          />
        ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={`h-2 w-2 shrink-0 rounded-full ${p.tone}`} aria-hidden />
            <span>
              {p.label} <span className="font-semibold tabular-nums">{grams(p.grams)}</span>
            </span>
          </li>
        ))}
        {n.fiberG > 0 ? (
          <li className="text-[11px] text-muted-foreground">
            Fibra <span className="font-semibold tabular-nums">{grams(n.fiberG)}</span>
          </li>
        ) : null}
      </ul>
    </div>
  )
}
