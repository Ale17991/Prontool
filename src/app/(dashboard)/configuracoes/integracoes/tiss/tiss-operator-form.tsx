'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2 } from 'lucide-react'

interface OperatorConfig {
  ans_registration: string
  contracted_code: string
  contracted_cnpj: string
  contracted_cnes: string | null
  active: boolean
}

export function TissOperatorForm({
  planId,
  planName,
  initialConfig,
}: {
  planId: string
  planName: string
  initialConfig: OperatorConfig | null
}): JSX.Element {
  const router = useRouter()
  const [ans, setAns] = useState(initialConfig?.ans_registration ?? '')
  const [code, setCode] = useState(initialConfig?.contracted_code ?? '')
  const [cnpj, setCnpj] = useState(initialConfig?.contracted_cnpj ?? '')
  const [cnes, setCnes] = useState(initialConfig?.contracted_cnes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const enabled = Boolean(initialConfig?.active)

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/tiss/operadoras/${planId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ans_registration: ans,
          contracted_code: code,
          contracted_cnpj: cnpj,
          contracted_cnes: cnes || undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; fields?: { message: string }[] }
        } | null
        throw new Error(
          body?.error?.fields?.map((f) => f.message).join(' · ') ??
            body?.error?.message ??
            'Falha ao salvar a configuração.',
        )
      }
      setSaved(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro inesperado.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold text-slate-900">{planName}</h3>
        {enabled && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-3 w-3" /> TISS habilitado
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Registro ANS da operadora" value={ans} onChange={setAns} placeholder="6 dígitos" />
        <Field label="Código do contratado na operadora" value={code} onChange={setCode} />
        <Field label="CNPJ do contratado" value={cnpj} onChange={setCnpj} placeholder="00.000.000/0001-00" />
        <Field label="CNES (opcional)" value={cnes} onChange={setCnes} placeholder="9999999 se não houver" />
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {enabled ? 'Atualizar' : 'Habilitar TISS'}
        </button>
        {saved && <span className="text-sm text-emerald-600">Salvo.</span>}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): JSX.Element {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
      />
    </label>
  )
}
