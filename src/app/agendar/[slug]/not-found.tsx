import Link from 'next/link'

export default function AgendarNotFound() {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Página não encontrada</h1>
      <p className="text-sm text-slate-600">
        Esta clínica não possui agendamento público ativo, ou o link está incorreto.
      </p>
      <Link
        href="/"
        className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Voltar ao início
      </Link>
    </div>
  )
}
