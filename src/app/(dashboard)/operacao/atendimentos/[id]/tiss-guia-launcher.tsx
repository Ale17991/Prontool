'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, FileText, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Feature 029 (US2) — Launcher de geração da Guia TISS de consulta.
 *
 * Espelha o padrão do PrescreverLauncher (Memed): um botão dispara
 * `POST /api/tiss/guias` com o `appointmentId`; o resultado vem com
 * `status` = `pronta` (✓) ou `rascunho` (⚠ + lista de pendências campo a
 * campo). Toda a lógica de elegibilidade/decifragem fica server-side.
 */

interface ValidationError {
  field: string
  message: string
}

interface GuiaResult {
  guiaId: string
  guiaNumber: string
  status: 'rascunho' | 'pronta'
  validationErrors: ValidationError[]
}

interface ApiError {
  error?: { code?: string; message?: string }
}

export function TissGuiaLauncher({
  appointmentId,
  onRecorded,
}: {
  appointmentId: string
  /** Chamado após gerar — usado pelo sheet para refetch. */
  onRecorded?: () => void
}): JSX.Element {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GuiaResult | null>(null)
  const [guiaType, setGuiaType] = useState<'consulta' | 'sp_sadt'>('consulta')

  async function handleGerar() {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/tiss/guias', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appointmentId, guiaType }),
      })
      const body = (await res.json().catch(() => ({}))) as GuiaResult | ApiError
      if (!res.ok) {
        const apiErr = body as ApiError
        throw new Error(apiErr.error?.message ?? `Falha ao gerar a guia (${res.status}).`)
      }
      setResult(body as GuiaResult)
      onRecorded?.()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar a guia TISS.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      {result ? (
        result.status === 'pronta' ? (
          <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success-bg/60 p-3 text-xs text-success-text">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-strong" />
            <div>
              <p className="font-bold">Guia {result.guiaNumber} pronta.</p>
              <p className="mt-0.5">
                Pode ser incluída num lote no painel{' '}
                <span className="font-semibold">Análise → TISS</span>.
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
            <p className="font-bold">
              Guia {result.guiaNumber} salva como rascunho — há pendências.
            </p>
            {result.validationErrors.length > 0 ? (
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {result.validationErrors.map((e, i) => (
                  <li key={`${e.field}-${i}`}>
                    <span className="font-semibold">{e.field}:</span> {e.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-1.5 text-amber-700">
              Corrija os dados (carteira do beneficiário, CBO do médico, etc.) e gere novamente.
            </p>
          </div>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs font-bold">
          <button
            type="button"
            onClick={() => setGuiaType('consulta')}
            className={
              guiaType === 'consulta'
                ? 'rounded bg-white px-2.5 py-1 text-slate-900 shadow-sm'
                : 'px-2.5 py-1 text-slate-500 hover:text-slate-800'
            }
          >
            Consulta
          </button>
          <button
            type="button"
            onClick={() => setGuiaType('sp_sadt')}
            className={
              guiaType === 'sp_sadt'
                ? 'rounded bg-white px-2.5 py-1 text-slate-900 shadow-sm'
                : 'px-2.5 py-1 text-slate-500 hover:text-slate-800'
            }
          >
            SP/SADT
          </button>
        </div>
        <Button onClick={handleGerar} disabled={loading} className="gap-2">
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FileText className="h-4 w-4" />
          )}
          {loading ? 'Gerando…' : 'Gerar guia TISS'}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
