/**
 * Paleta fixa de cores para tags de paciente. Slugs alinhados ao Tailwind
 * para garantir consistência visual e bom contraste com o tema do app.
 *
 * A migration 0103 valida o slug via CHECK constraint — qualquer mudança
 * aqui exige migration nova.
 */
export const PATIENT_TAG_COLORS = [
  'slate',
  'red',
  'orange',
  'amber',
  'green',
  'sky',
  'violet',
  'pink',
] as const

export type PatientTagColor = (typeof PATIENT_TAG_COLORS)[number]

export function isPatientTagColor(value: unknown): value is PatientTagColor {
  return typeof value === 'string' && (PATIENT_TAG_COLORS as readonly string[]).includes(value)
}

/**
 * Classes Tailwind para cada slug. Mantidas como literal strings (não
 * concatenadas) para que o JIT do Tailwind detecte e gere o CSS.
 */
export const PATIENT_TAG_COLOR_CLASSES: Record<
  PatientTagColor,
  { badge: string; dot: string; swatch: string }
> = {
  slate: {
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
    dot: 'bg-slate-500',
    swatch: 'bg-slate-500',
  },
  red: {
    badge: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
    swatch: 'bg-red-500',
  },
  orange: {
    badge: 'bg-orange-50 text-orange-700 border-orange-200',
    dot: 'bg-orange-500',
    swatch: 'bg-orange-500',
  },
  amber: {
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
    swatch: 'bg-amber-500',
  },
  green: {
    badge: 'bg-green-50 text-green-700 border-green-200',
    dot: 'bg-green-500',
    swatch: 'bg-green-500',
  },
  sky: {
    badge: 'bg-sky-50 text-sky-700 border-sky-200',
    dot: 'bg-sky-500',
    swatch: 'bg-sky-500',
  },
  violet: {
    badge: 'bg-violet-50 text-violet-700 border-violet-200',
    dot: 'bg-violet-500',
    swatch: 'bg-violet-500',
  },
  pink: {
    badge: 'bg-pink-50 text-pink-700 border-pink-200',
    dot: 'bg-pink-500',
    swatch: 'bg-pink-500',
  },
}
