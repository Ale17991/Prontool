'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type {
  PrintoutDocumentSpec,
  PrintoutFieldSpec,
  PrintoutPatientField,
} from '@/lib/core/printouts/fields'

interface Config {
  fields: PrintoutPatientField[]
  overrides: Partial<Record<string, PrintoutPatientField[]>>
}

const AREA_LABEL: Record<PrintoutDocumentSpec['area'], string> = {
  geral: 'Geral',
  nutricao: 'Nutrição',
  odonto: 'Odontologia',
  oftalmo: 'Oftalmologia',
}

export function PrintoutFieldsManager({
  initial,
  fields,
  documents,
}: {
  initial: Config
  fields: PrintoutFieldSpec[]
  documents: PrintoutDocumentSpec[]
}) {
  const router = useRouter()
  const [config, setConfig] = useState<Config>(initial)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const areas = useMemo(() => {
    const byArea = new Map<PrintoutDocumentSpec['area'], PrintoutDocumentSpec[]>()
    for (const d of documents) {
      const list = byArea.get(d.area) ?? []
      list.push(d)
      byArea.set(d.area, list)
    }
    return [...byArea.entries()]
  }, [documents])

  function toggleDefault(key: PrintoutPatientField) {
    setSaved(false)
    setConfig((c) => ({
      ...c,
      fields: c.fields.includes(key) ? c.fields.filter((k) => k !== key) : [...c.fields, key],
    }))
  }

  function toggleOverride(docId: string, key: PrintoutPatientField) {
    setSaved(false)
    setConfig((c) => {
      const current = c.overrides[docId] ?? c.fields
      const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key]
      return { ...c, overrides: { ...c.overrides, [docId]: next } }
    })
  }

  /** Personalizar começa do padrão — ninguém quer recomeçar do zero. */
  function startOverride(docId: string) {
    setSaved(false)
    setConfig((c) => ({ ...c, overrides: { ...c.overrides, [docId]: [...c.fields] } }))
  }

  function clearOverride(docId: string) {
    setSaved(false)
    setConfig((c) => {
      const next = { ...c.overrides }
      delete next[docId]
      return { ...c, overrides: next }
    })
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/configuracoes/impressos', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields: config.fields, overrides: config.overrides }),
      })
      if (!res.ok) throw new Error('Não foi possível salvar.')
      setSaved(true)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Padrão da clínica</CardTitle>
          <p className="text-sm text-slate-500">
            Vale para todos os documentos que não tiverem exceção própria.
          </p>
        </CardHeader>
        <CardContent>
          <FieldGrid fields={fields} selected={config.fields} onToggle={(k) => toggleDefault(k)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exceções por documento</CardTitle>
          <p className="text-sm text-slate-500">
            Um documento personalizado passa a ter lista própria e{' '}
            <strong>deixa de acompanhar</strong> mudanças no padrão acima. Use “voltar ao padrão”
            para religá-lo.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {areas.map(([area, docs]) => (
            <div key={area} className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {AREA_LABEL[area]}
              </p>
              {docs.map((doc) => {
                const custom = config.overrides[doc.id] !== undefined
                return (
                  <div
                    key={doc.id}
                    className={cn(
                      'rounded-lg border p-3',
                      custom ? 'border-primary/40 bg-primary/5' : 'border-slate-200',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{doc.label}</span>
                        {custom ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                            personalizado
                          </span>
                        ) : (
                          <span className="text-xs text-slate-400">segue o padrão</span>
                        )}
                      </div>
                      {custom ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => clearOverride(doc.id)}
                        >
                          <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                          Voltar ao padrão
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => startOverride(doc.id)}
                        >
                          Personalizar
                        </Button>
                      )}
                    </div>
                    {custom ? (
                      <div className="mt-3">
                        <FieldGrid
                          fields={fields}
                          selected={config.overrides[doc.id] ?? []}
                          onToggle={(k) => toggleOverride(doc.id, k)}
                        />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Salvar
        </Button>
        {saved ? (
          <span className="flex items-center gap-1.5 text-sm text-success-text">
            <Check className="h-4 w-4" />
            Salvo. Vale a partir da próxima emissão.
          </span>
        ) : null}
        {error ? <span className="text-sm text-danger-text">{error}</span> : null}
      </div>
    </div>
  )
}

function FieldGrid({
  fields,
  selected,
  onToggle,
}: {
  fields: PrintoutFieldSpec[]
  selected: PrintoutPatientField[]
  onToggle: (key: PrintoutPatientField) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {/* O nome é piso, não opção: mostrado desligado-e-travado para a ausência
          na lista não parecer esquecimento de quem configura. */}
      <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <div>
          <span className="block text-sm font-medium text-slate-500">Nome</span>
          <span className="text-[11px] text-slate-400">Sempre aparece</span>
        </div>
      </div>
      {fields.map((f) => {
        const on = selected.includes(f.key)
        return (
          <button
            key={f.key}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onToggle(f.key)}
            className={cn(
              'flex items-start gap-2 rounded-md border p-2.5 text-left transition-colors',
              on ? 'border-primary/40 bg-accent' : 'border-slate-200 bg-white hover:bg-slate-50',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                on ? 'border-primary bg-primary text-white' : 'border-slate-300 bg-white',
              )}
            >
              {on ? <Check className="h-3 w-3" /> : null}
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-1 text-sm font-medium text-slate-900">
                {f.label}
                {f.sensitive ? (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-orange-500" />
                ) : null}
              </span>
              {f.hint ? <span className="block text-[11px] text-slate-500">{f.hint}</span> : null}
            </span>
          </button>
        )
      })}
    </div>
  )
}
