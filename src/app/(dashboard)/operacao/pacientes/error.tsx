'use client'

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function PacientesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('pacientes-page-error', error)
  }, [error])

  const isMissingKey = /PATIENT_DATA_ENCRYPTION_KEY/.test(error.message)
  const isPermission = /permission denied/i.test(error.message)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Pacientes</h1>
      </div>
      <Card>
        <CardContent className="flex flex-col items-center gap-4 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="max-w-lg space-y-2">
            <p className="text-sm font-bold text-slate-900">
              Não foi possível carregar a lista de pacientes.
            </p>
            {isMissingKey ? (
              <p className="text-xs text-slate-600">
                A variável <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">PATIENT_DATA_ENCRYPTION_KEY</code>{' '}
                não está configurada no ambiente. Peça ao administrador para defini-la nas variáveis de ambiente da Vercel.
              </p>
            ) : isPermission ? (
              <p className="text-xs text-slate-600">
                Permissões do banco insuficientes para descriptografar pacientes. Aplique as migrations mais recentes
                (incluindo <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">0043_grant_patient_rpcs_to_authenticated</code>).
              </p>
            ) : (
              <p className="text-xs text-slate-600">
                Erro inesperado ao consultar pacientes. Tente novamente em alguns segundos. Se persistir, verifique os logs.
              </p>
            )}
            {error.digest ? (
              <p className="font-mono text-[10px] text-slate-400">digest: {error.digest}</p>
            ) : null}
          </div>
          <Button onClick={reset} variant="outline" className="mt-2">
            <RotateCcw className="mr-2 h-3.5 w-3.5" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
