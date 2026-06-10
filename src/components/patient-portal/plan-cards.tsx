import { Dumbbell, UtensilsCrossed } from 'lucide-react'
import type { WorkoutPlan } from '@/lib/core/patient-portal/workout'
import type { DietPlan } from '@/lib/core/patient-portal/diet'

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
                    {[e.sets && e.reps ? `${e.sets} × ${e.reps}` : e.reps ?? (e.sets ? `${e.sets}×` : ''), e.loadKg ? `${e.loadKg}kg` : '']
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

export function DietCard({ plan }: { plan: DietPlan }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="flex items-center gap-2.5 text-sm font-bold text-slate-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-lime-100 text-lime-700">
          <UtensilsCrossed className="h-4 w-4" />
        </span>
        Plano alimentar
      </h2>
      <p className="mt-1 text-xs text-slate-400">{plan.title}</p>
      {plan.notes ? <p className="mt-1 text-xs text-slate-500">{plan.notes}</p> : null}
      <div className="mt-3 space-y-3">
        {plan.meals.map((m, i) => (
          <div key={i} className="rounded-xl border border-slate-100 p-3">
            <p className="flex items-baseline justify-between text-sm font-semibold text-slate-800">
              {m.name}
              {m.timeLabel ? <span className="text-xs font-normal text-slate-400">{m.timeLabel}</span> : null}
            </p>
            <ul className="mt-1 space-y-0.5">
              {m.items.map((it, k) => (
                <li key={k} className="text-sm text-slate-600">
                  {it.food}
                  {it.quantity ? <span className="text-slate-400"> — {it.quantity}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
