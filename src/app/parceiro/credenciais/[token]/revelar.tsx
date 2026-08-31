'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, Check, Copy, Eye, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { revelarCredencialAction } from './actions'

const AVISO: Record<string, string> = {
  usado:
    'Este link já foi usado. Por segurança a credencial aparece uma única vez — peça uma nova à equipe Clinni.',
  expirado: 'Este link expirou. Peça um novo à equipe Clinni.',
  desconhecido: 'Link inválido. Confira se o endereço foi copiado por inteiro.',
}

export function Revelar({ token, parceiro }: { token: string; parceiro?: string }) {
  const [secret, setSecret] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [pendente, start] = useTransition()

  function revelar() {
    setErro(null)
    start(async () => {
      const res = await revelarCredencialAction(token)
      if (res.ok) setSecret(res.secret)
      else setErro(AVISO[res.status] ?? AVISO.desconhecido!)
    })
  }

  if (secret) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-bold text-amber-900">
            Copie agora. Esta credencial não será exibida novamente.
          </p>
          <p className="mt-1 text-xs text-amber-800">
            Guardamos apenas o hash dela. Se perder, não há como recuperá-la — só emitir outra.
          </p>
        </div>

        <div className="flex items-start gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900">
            {secret}
          </code>
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(secret)
              setCopiado(true)
            }}
          >
            {copiado ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </Button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Como usar</p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
            {`curl https://app.clinnipro.com.br/api/parceiros/v1/clinicas \\
  -H "Authorization: Bearer SUA_CHAVE"`}
          </pre>
          <p className="mt-3 text-xs text-slate-500">
            Documentação completa em{' '}
            <a className="font-medium text-primary hover:underline" href="/docs">
              app.clinnipro.com.br/docs
            </a>
            .
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {parceiro ? (
          <>
            Credencial de API para <strong className="text-slate-900">{parceiro}</strong>.
          </>
        ) : (
          'Credencial de API.'
        )}{' '}
        Ela aparece <strong className="text-slate-900">uma única vez</strong> e este link deixa de
        funcionar em seguida. Tenha onde guardá-la antes de continuar.
      </p>

      <Button onClick={revelar} disabled={pendente}>
        {pendente ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Eye className="mr-2 h-4 w-4" />
        )}
        Revelar credencial
      </Button>

      {erro && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {erro}
        </p>
      )}
    </div>
  )
}
