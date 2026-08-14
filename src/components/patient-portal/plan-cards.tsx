import { Dumbbell, UtensilsCrossed } from 'lucide-react'
import type { WorkoutPlan } from '@/lib/core/patient-portal/workout'
import type { PortalDietPlan, PortalNutrients } from '@/lib/core/patient-portal/diet'

/**
 * Feature 032 — render do plano de treino e do plano alimentar ATIVOS no portal
 * (dados reais, cadastrados pela equipe). Usados nas colunas laterais.
 */

export function WorkoutCard({ plan }: { plan: WorkoutPlan }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2.5 text-sm font-bold text-slate-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
          <Dumbbell className="h-4 w-4" />
        </span>
        Rotina de treino
      </h2>
      <p className="mt-1 text-xs text-slate-400">{plan.title}</p>
      {plan.notes ? <p className="mt-1 text-xs text-slate-500">{plan.notes}</p> : null}
      <div className="mt-3 space-y-3">
        {plan.sessions.map((s, i) => (
          <div key={i} className="rounded-xl border border-slate-100 p-3">
            <p className="text-sm font-semibold text-slate-800">
              {s.name}
              {s.focus ? <span className="font-normal text-slate-400"> · {s.focus}</span> : null}
            </p>
            <ul className="mt-1.5 space-y-1">
              {s.exercises.map((e, k) => (
                <li key={k} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-slate-600">{e.name}</span>
                  <span className="shrink-0 font-medium tabular-nums text-slate-500">
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
      </div>
    </section>
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

export function DietCard({ plan }: { plan: PortalDietPlan }) {
  const t = plan.totals
  const target = plan.target

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2.5 text-sm font-bold text-slate-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-lime-100 text-lime-700">
          <UtensilsCrossed className="h-4 w-4" />
        </span>
        Plano alimentar
      </h2>
      <p className="mt-1 text-xs text-slate-400">{plan.title}</p>

      {/* Total do dia + meta. Sem meta cadastrada, mostra só o total: comparar
          com um alvo que não existe seria inventar referência. */}
      {t ? (
        <div className="mt-3 rounded-xl border border-lime-100 bg-lime-50/40 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-bold text-slate-800">{kcal(t.energyKcal)} por dia</span>
            {target ? (
              <span className="text-[11px] text-slate-500">
                meta: {kcal(target.kcal)}
                {target.macros ? (
                  <>
                    {' '}
                    · P {grams(target.macros.protG)} · C {grams(target.macros.carbG)} · G{' '}
                    {grams(target.macros.fatG)}
                  </>
                ) : null}
              </span>
            ) : null}
          </div>
          <Macros n={t} className="mt-0.5 block text-xs font-medium text-slate-600" />
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {plan.meals.map((m, i) => (
          <div key={i} className="rounded-xl border border-slate-100 p-3">
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-semibold text-slate-800">
              <span>
                {m.name}
                {m.timeLabel ? (
                  <span className="ml-1.5 text-xs font-normal text-slate-400">{m.timeLabel}</span>
                ) : null}
              </span>
              {m.totals ? (
                <span className="text-xs font-normal tabular-nums text-slate-500">
                  {kcal(m.totals.energyKcal)}
                </span>
              ) : null}
            </p>
            {m.totals ? (
              <Macros n={m.totals} className="mt-0.5 block text-[11px] text-slate-400" />
            ) : null}

            <ul className="mt-2 space-y-2">
              {m.items.map((it, k) => (
                <li key={k} className="border-b border-slate-50 pb-2 text-sm last:border-0 last:pb-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="text-slate-700">
                      {it.name}
                      {it.quantity ? <span className="text-slate-400">, {it.quantity}</span> : null}
                    </span>
                    {it.nutrients ? (
                      <span className="shrink-0 text-xs tabular-nums text-slate-500">
                        {kcal(it.nutrients.energyKcal)}
                      </span>
                    ) : null}
                  </div>
                  {it.nutrients ? (
                    <Macros n={it.nutrients} className="mt-0.5 block text-[11px] text-slate-400" />
                  ) : null}

                  {/* Substitutos do grupo: é a razão de o grupo existir, então
                      vêm listados e com a quantidade de cada um — "ou: X · Y"
                      numa linha só escondia justamente o quanto comer. */}
                  {it.options && it.options.length > 0 ? (
                    <div className="mt-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        Pode trocar por
                      </p>
                      <ul className="mt-0.5 space-y-0.5">
                        {it.options.map((o, oi) => (
                          <li
                            key={oi}
                            className="flex items-baseline justify-between gap-2 text-xs text-slate-600"
                          >
                            <span>{o.name}</span>
                            <span className="shrink-0 tabular-nums text-slate-400">
                              {grams(o.grams)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {plan.attribution ? (
        <p className="mt-3 text-[10px] leading-snug text-slate-300">
          Valores nutricionais: TACO (NEPA/UNICAMP, 2011) e IBGE/POF 2008-2009.
        </p>
      ) : null}
    </section>
  )
}
