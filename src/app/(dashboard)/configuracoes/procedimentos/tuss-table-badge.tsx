import { cn } from '@/lib/utils'

export type TussTable = '22' | '19' | '20'

export interface TussTableOption {
  value: TussTable
  label: string
  short: string
  badgeClass: string
  selectedClass: string
}

/**
 * Classes Tailwind completas (sem concatenação dinâmica) para que o JIT
 * do Tailwind detecte todas as variações na compilação. Qualquer novo
 * valor de tuss_table precisa adicionar uma entrada aqui.
 */
export const TUSS_TABLES: readonly TussTableOption[] = [
  {
    value: '22',
    label: 'Procedimentos',
    short: 'Proc',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
    selectedClass: 'border-blue-300 bg-blue-50 ring-1 ring-blue-200',
  },
  {
    value: '19',
    label: 'Materiais',
    short: 'Mat',
    badgeClass: 'bg-success-bg text-success-text border-success/30',
    selectedClass: 'border-success/40 bg-success-bg ring-1 ring-success/30',
  },
  {
    value: '20',
    label: 'Medicamentos',
    short: 'Med',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200',
    selectedClass: 'border-orange-300 bg-orange-50 ring-1 ring-orange-200',
  },
] as const

export function TussTableBadge({ table, className }: { table: TussTable; className?: string }) {
  const opt = TUSS_TABLES.find((t) => t.value === table)
  if (!opt) return null
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider',
        opt.badgeClass,
        className,
      )}
      title={`${opt.label} (Tabela ${opt.value})`}
    >
      {opt.short}
    </span>
  )
}
