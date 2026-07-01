import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { verifyToken, incrementVerification } from '@/lib/core/surgical-scans/verification-service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Backlog 1/4/3 — verificação PÚBLICA de documento via QR. Sem layout do
 * dashboard, sem auth, sem QUALQUER dado de paciente. Apenas confirma que o
 * documento foi emitido pela clínica e quando.
 */
export default async function VerificarPage({ params }: { params: { token: string } }) {
  const supabase = createSupabaseServiceClient()
  const result = await verifyToken(supabase, params.token).catch(() => ({ valid: false }))
  if ('valid' in result && result.valid) {
    await incrementVerification(supabase, params.token).catch(() => {})
  }

  const valid = result.valid
  const issuedAt =
    'issuedAt' in result && result.issuedAt
      ? new Date(result.issuedAt).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' })
      : null
  const clinicName = 'clinicName' in result ? result.clinicName : undefined

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div
            className={`flex h-12 w-12 items-center justify-center rounded-full text-2xl ${
              valid ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}
            aria-hidden
          >
            {valid ? '✓' : '✕'}
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {valid ? 'Documento autêntico' : 'Documento não encontrado'}
            </h1>
            <p className="text-sm text-slate-500">Verificação Clinni</p>
          </div>
        </div>

        {valid ? (
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Emitido por</dt>
              <dd className="text-right font-semibold text-slate-900">{clinicName}</dd>
            </div>
            {issuedAt ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Emitido em</dt>
                <dd className="text-right font-semibold text-slate-900">{issuedAt}</dd>
              </div>
            ) : null}
            <p className="pt-3 text-xs text-slate-400">
              Este código confirma que o documento foi emitido pela clínica acima. Por privacidade,
              nenhum dado do paciente é exibido nesta página.
            </p>
          </dl>
        ) : (
          <p className="text-sm text-slate-600">
            O código informado não corresponde a nenhum documento emitido. Verifique se o QR foi
            lido corretamente.
          </p>
        )}
      </div>
    </main>
  )
}
