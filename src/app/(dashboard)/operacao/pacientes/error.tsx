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
  const isMissingFunction =
    /Could not find the function|schema cache|function .* does not exist|PGRST202|PGRST203|list_patients_for_tenant/i.test(
      error.message,
    )
  const isMissingTable =
    /relation .* does not exist|table .* does not exist|PGRST204|PGRST205/i.test(
      error.message,
    )
  const isMissingColumn =
    /column .* does not exist|42703/i.test(error.message)
  const isDecryptFailure =
    /pgp_sym_decrypt|Wrong key or corrupt data|decryption failed/i.test(error.message)
  const isAuthIssue =
    /jwt_tenant_id|tenant_id is null|JWT|claim/i.test(error.message)

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
            ) : isMissingFunction ? (
              <p className="text-xs text-slate-600">
                A função <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">list_patients_for_tenant</code>{' '}
                não foi encontrada no banco. Aplique as migrations mais recentes em produção (em especial{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">0044_ensure_patient_rpcs</code>) com{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">supabase db push</code>.
              </p>
            ) : isMissingTable ? (
              <p className="text-xs text-slate-600">
                Uma tabela referenciada por essa página ainda não existe em produção. Aplique as
                migrations pendentes com{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">supabase db push</code>.
              </p>
            ) : isMissingColumn ? (
              <p className="text-xs text-slate-600">
                Uma coluna referenciada por essa página ainda não existe em produção. Aplique as
                migrations pendentes com{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">supabase db push</code>.
              </p>
            ) : isAuthIssue ? (
              <p className="text-xs text-slate-600">
                Token JWT sem <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">tenant_id</code>{' '}
                custom claim. Verifique se o auth hook está habilitado em Supabase &gt; Authentication
                &gt; Hooks.
              </p>
            ) : isPermission ? (
              <p className="text-xs text-slate-600">
                Permissões do banco insuficientes para descriptografar pacientes. Aplique as migrations mais recentes
                (incluindo <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">0044_ensure_patient_rpcs</code>).
              </p>
            ) : isDecryptFailure ? (
              <p className="text-xs text-slate-600">
                Falha ao descriptografar PII. A chave{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">PATIENT_DATA_ENCRYPTION_KEY</code>{' '}
                configurada na Vercel não bate com a que cifrou os dados em prod. Use o mesmo valor do GUC{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono">app.patient_encryption_key</code>.
              </p>
            ) : (
              <div className="space-y-2 text-xs text-slate-600">
                <p>Erro inesperado ao consultar pacientes.</p>
                <p>
                  Em produção, o detalhe do erro é ocultado aqui — consulte os runtime logs da
                  Vercel pelo digest abaixo. Causas comuns:
                </p>
                <ul className="ml-4 list-disc space-y-1 text-left">
                  <li>
                    Migrations não aplicadas em prod —{' '}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">
                      supabase db push
                    </code>{' '}
                    para garantir{' '}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">
                      0044_ensure_patient_rpcs
                    </code>
                    .
                  </li>
                  <li>
                    Variável{' '}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">
                      PATIENT_DATA_ENCRYPTION_KEY
                    </code>{' '}
                    ausente ou divergente do GUC{' '}
                    <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">
                      app.patient_encryption_key
                    </code>
                    .
                  </li>
                  <li>Auth hook custom claims não habilitado (sem tenant_id no JWT).</li>
                </ul>
              </div>
            )}
            <details className="mx-auto mt-2 max-w-md rounded-md bg-slate-50 px-3 py-2 text-left">
              <summary className="cursor-pointer text-[11px] font-semibold text-slate-600">
                Detalhes técnicos
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[10px] text-slate-700">
                {error.message || '(sem mensagem)'}
              </pre>
              {error.digest ? (
                <p className="mt-1 font-mono text-[10px] text-slate-400">
                  digest: {error.digest}
                </p>
              ) : null}
            </details>
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
