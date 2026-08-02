'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Download, Loader2, Sparkles } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { READY_MADE_TEMPLATES } from '@/lib/core/anamnesis/ready-made'

/**
 * Modelos prontos que a clínica instala em um clique. Instalar é uma CÓPIA:
 * gera um modelo normal do tenant, que a profissional edita depois como
 * qualquer outro.
 */
export function ReadyMadeTemplates({ installedTitles }: { installedTitles: string[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const installed = new Set(installedTitles)

  async function install(slug: string) {
    const model = READY_MADE_TEMPLATES.find((m) => m.slug === slug)
    if (!model) return
    setBusy(slug)
    setError(null)
    try {
      const res = await fetch('/api/anamnesis-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: model.title,
          description: model.description,
          fields: model.fields,
        }),
      })
      if (!res.ok) {
        setError('Não foi possível instalar o modelo. Tente de novo.')
        return
      }
      router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-primary" />
          Modelos prontos
        </CardTitle>
        <p className="text-xs text-slate-500">
          Roteiros de consulta já montados. Instalar cria uma cópia sua, que você pode editar campo
          a campo depois.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {READY_MADE_TEMPLATES.map((m) => {
          const already = installed.has(m.title)
          return (
            <div
              key={m.slug}
              className="flex flex-col gap-2 rounded-md border border-slate-200 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">{m.title}</p>
                <p className="text-xs text-slate-500">{m.description}</p>
                <p className="mt-1 text-[11px] text-slate-400">
                  {m.fields.filter((f) => !f.label.startsWith('—')).length} perguntas
                </p>
              </div>
              {already ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-600">
                  <Check className="h-3.5 w-3.5" />
                  Já instalado
                </span>
              ) : (
                <Button
                  size="sm"
                  className="shrink-0"
                  disabled={busy === m.slug}
                  onClick={() => void install(m.slug)}
                >
                  {busy === m.slug ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-1 h-3.5 w-3.5" />
                  )}
                  Instalar
                </Button>
              )}
            </div>
          )
        })}
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
