import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LoadingSpinnerProps {
  /** Texto exibido abaixo do spinner. Use null para ocultar. Default: "Carregando...". */
  label?: string | null
  /** Tamanho do ícone em px. Default: 32. */
  size?: number
  /** Classe extra no wrapper (ex.: altura mínima diferente). */
  className?: string
}

export function LoadingSpinner({
  label = 'Carregando...',
  size = 32,
  className,
}: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // Token, não `slate-500`: o mesmo spinner atende o portal do paciente,
        // onde a paleta é da clínica (058). Cor fixa em classe é invisível para
        // qualquer tema, e a espera reapresentaria o cinza do produto dentro do
        // portal temado.
        'flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 text-muted-foreground',
        className,
      )}
    >
      <Loader2 className="animate-spin" style={{ width: size, height: size }} aria-hidden />
      {label ? <p className="text-sm font-medium">{label}</p> : null}
      <span className="sr-only">{label ?? 'Carregando'}</span>
    </div>
  )
}
