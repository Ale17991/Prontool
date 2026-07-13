import Link from 'next/link'
import { CalendarX2 } from 'lucide-react'

export default function AgendarNotFound() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-12 text-center shadow-sm">
      <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <CalendarX2 className="h-8 w-8" />
      </span>
      <div className="space-y-1">
        <h1 className="text-xl font-black tracking-tight text-foreground">Link indisponível</h1>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Esta clínica não possui agendamento público ativo, ou o link está incorreto. Confira o
          endereço com a clínica.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
      >
        Voltar ao início
      </Link>
    </div>
  )
}
