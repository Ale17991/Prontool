'use client'

import { useState } from 'react'
import { Check, Copy, Link2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Backlog 1/3 — gera um link de auto-cadastro (uso único, 7 dias) para enviar
 * ao paciente completar contato/endereço.
 */
export function PatientIntakeLink({ patientId, canEdit }: { patientId: string; canEdit: boolean }) {
  const [link, setLink] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canEdit) return null

  async function generate() {
    setError(null)
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/link-cadastro`, { method: 'POST' })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao gerar o link.')
        return
      }
      const b = (await res.json()) as { path: string }
      setLink(`${window.location.origin}${b.path}`)
      setCopied(false)
    } finally {
      setPending(false)
    }
  }

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Link2 className="h-4 w-4 text-primary" />
          Link de auto-cadastro
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-[11px] text-slate-500">
          Gere um link para o paciente completar contato e endereço. Uso único, expira em 7 dias.
        </p>
        {link ? (
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link}
              className="flex-1 truncate rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700"
            />
            <Button type="button" variant="outline" size="sm" onClick={copy}>
              {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
              {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>
        ) : null}
        {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
        <Button type="button" size="sm" variant="outline" onClick={generate} disabled={pending} className="gap-2">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {link ? 'Gerar novo link' : 'Gerar link'}
        </Button>
      </CardContent>
    </Card>
  )
}
