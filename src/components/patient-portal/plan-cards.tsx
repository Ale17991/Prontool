import { Dumbbell, UtensilsCrossed } from 'lucide-react'
import type { WorkoutPlan } from '@/lib/core/patient-portal/workout'
import type { PortalDietPlan } from '@/lib/core/patient-portal/diet'

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

export function DietCard({ plan }: { plan: PortalDietPlan }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2.5 text-sm font-bold text-slate-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-lime-100 text-lime-700">
          <UtensilsCrossed className="h-4 w-4" />
        </span>
        Plano alimentar
      </h2>
      <p className="mt-1 flex items-baseline justify-between text-xs text-slate-400">
        <span>{plan.title}</span>
        {plan.totalKcal !== null ? (
          <span className="font-semibold text-slate-500">{plan.totalKcal} kcal/dia</span>
        ) : null}
      </p>
      <div className="mt-3 space-y-3">
        {plan.meals.map((m, i) => (
          <div key={i} className="rounded-xl border border-slate-100 p-3">
            <p className="flex items-baseline justify-between text-sm font-semibold text-slate-800">
              <span>
                {m.name}
                {m.timeLabel ? (
                  <span className="ml-1.5 text-xs font-normal text-slate-400">{m.timeLabel}</span>
                ) : null}
              </span>
              {m.energyKcal !== null ? (
                <span className="text-xs font-normal tabular-nums text-slate-400">{m.energyKcal} kcal</span>
              ) : null}
            </p>
            <ul className="mt-1 space-y-0.5">
              {m.items.map((it, k) => (
                <li key={k} className="text-sm text-slate-600">
                  {it.name}
                  {it.quantity ? <span className="text-slate-400"> — {it.quantity}</span> : null}
                  {it.options && it.options.length > 0 ? (
                    <span className="block pl-3 text-xs text-slate-400">
                      ou: {it.options.map((o) => `${o.name} ${o.grams}g`).join(' · ')}
                    </span>
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
