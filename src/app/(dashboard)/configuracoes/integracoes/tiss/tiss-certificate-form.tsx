'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldCheck, Trash2 } from 'lucide-react'

interface Certificate {
  id: string
  subject_cn: string
  not_after: string
}

export function TissCertificateForm({
  initialCertificate,
}: {
  initialCertificate: Certificate | null
}): JSX.Element {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const expired = initialCertificate
    ? new Date(initialCertificate.not_after).getTime() < Date.now()
    : false

  async function upload(): Promise<void> {
    if (!file) {
      setError('Selecione o arquivo .pfx do certificado.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('certificate', file)
      form.append('password', password)
      const res = await fetch('/api/tiss/certificados', { method: 'POST', body: form })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
        throw new Error(body?.error?.message ?? 'Falha ao enviar o certificado.')
      }
      setFile(null)
      setPassword('')
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro inesperado.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(): Promise<void> {
    if (!initialCertificate) return
    setBusy(true)
    setError(null)
    try {
      await fetch(`/api/tiss/certificados/${initialCertificate.id}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="flex items-center gap-2 font-bold text-slate-900">
        <ShieldCheck className="h-5 w-5 text-primary" /> Certificado ICP-Brasil (A1)
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Usado para assinar digitalmente os lotes TISS. O arquivo e a senha ficam cifrados no
        servidor e nunca trafegam de volta para o navegador.
      </p>

      {initialCertificate ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-slate-50 p-3">
          <div className="text-sm">
            <p className="font-semibold text-slate-800">{initialCertificate.subject_cn}</p>
            <p className={expired ? 'text-red-600' : 'text-slate-500'}>
              Válido até {new Date(initialCertificate.not_after).toLocaleDateString('pt-BR')}
              {expired && ' — EXPIRADO'}
            </p>
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-sm font-semibold text-red-600 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> Remover
          </button>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Arquivo .pfx / .p12</span>
          <input
            type="file"
            accept=".pfx,.p12"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">Senha do certificado</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
          />
        </label>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button
        type="button"
        onClick={upload}
        disabled={busy}
        className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {initialCertificate ? 'Substituir certificado' : 'Enviar certificado'}
      </button>
    </section>
  )
}
