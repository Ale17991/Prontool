'use client'

import Link from 'next/link'

export default function AgendarError() {
  return (
    <div className="space-y-4 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Algo deu errado</h1>
      <p className="text-sm text-slate-600">
        Não foi possível carregar a página de agendamento. Tente novamente em alguns minutos.
      </p>
      <Link
        href="/"
        className="inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
      >
        Voltar
      </Link>
    </div>
  )
}
