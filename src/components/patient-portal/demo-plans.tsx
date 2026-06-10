import { Dumbbell, UtensilsCrossed, Info } from 'lucide-react'

/**
 * Feature 032 — conteúdo ILUSTRATIVO de Rotina de treino e Plano alimentar.
 * Mostra como as seções aparecerão; o cadastro real (por profissional) virá
 * depois. Nota discreta deixa claro que é exemplo.
 */

function DemoNote() {
  return (
    <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
      <Info className="h-3.5 w-3.5 shrink-0 text-slate-400" />
      Plano ilustrativo — em breve seu profissional cadastra o seu.
    </p>
  )
}

const TREINO: Array<{ dia: string; foco: string; exercicios: Array<{ nome: string; series: string }> }> = [
  {
    dia: 'Segunda',
    foco: 'Peito e tríceps',
    exercicios: [
      { nome: 'Supino reto', series: '4 × 10' },
      { nome: 'Supino inclinado com halteres', series: '3 × 12' },
      { nome: 'Crucifixo', series: '3 × 15' },
      { nome: 'Tríceps na corda', series: '3 × 15' },
    ],
  },
  {
    dia: 'Quarta',
    foco: 'Costas e bíceps',
    exercicios: [
      { nome: 'Puxada frontal', series: '4 × 10' },
      { nome: 'Remada curvada', series: '3 × 12' },
      { nome: 'Rosca direta', series: '3 × 12' },
    ],
  },
  {
    dia: 'Sexta',
    foco: 'Pernas',
    exercicios: [
      { nome: 'Agachamento livre', series: '4 × 10' },
      { nome: 'Leg press', series: '3 × 12' },
      { nome: 'Cadeira extensora', series: '3 × 15' },
      { nome: 'Panturrilha em pé', series: '4 × 20' },
    ],
  },
]

const DIETA: Array<{ refeicao: string; hora: string; itens: string[] }> = [
  { refeicao: 'Café da manhã', hora: '07:00', itens: ['2 ovos mexidos', '1 fatia de pão integral', '1 fruta', 'Café sem açúcar'] },
  { refeicao: 'Lanche da manhã', hora: '10:00', itens: ['Iogurte natural', '1 punhado de castanhas'] },
  { refeicao: 'Almoço', hora: '12:30', itens: ['Arroz integral', 'Feijão', 'Filé de frango grelhado', 'Salada à vontade'] },
  { refeicao: 'Lanche da tarde', hora: '16:00', itens: ['Fruta', 'Chá ou café sem açúcar'] },
  { refeicao: 'Jantar', hora: '19:30', itens: ['Omelete de legumes', 'Salada verde'] },
]

export function TreinoDemoCard() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2.5 text-sm font-bold text-slate-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
          <Dumbbell className="h-4 w-4" />
        </span>
        Rotina de treino
      </h2>
      <DemoNote />
      <div className="space-y-3">
        {TREINO.map((d) => (
          <div key={d.dia} className="rounded-xl border border-slate-100 p-3">
            <p className="text-sm font-semibold text-slate-800">
              {d.dia} <span className="font-normal text-slate-400">· {d.foco}</span>
            </p>
            <ul className="mt-1.5 space-y-1">
              {d.exercicios.map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-slate-600">{e.nome}</span>
                  <span className="shrink-0 font-medium tabular-nums text-slate-500">{e.series}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

export function DietaDemoCard() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2.5 text-sm font-bold text-slate-700">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-lime-100 text-lime-700">
          <UtensilsCrossed className="h-4 w-4" />
        </span>
        Plano alimentar
      </h2>
      <DemoNote />
      <div className="space-y-3">
        {DIETA.map((m) => (
          <div key={m.refeicao} className="rounded-xl border border-slate-100 p-3">
            <p className="flex items-baseline justify-between text-sm font-semibold text-slate-800">
              {m.refeicao}
              <span className="text-xs font-normal text-slate-400">{m.hora}</span>
            </p>
            <p className="mt-1 text-sm text-slate-600">{m.itens.join(' · ')}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
