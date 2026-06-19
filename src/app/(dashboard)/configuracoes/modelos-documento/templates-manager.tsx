'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AVAILABLE_PLACEHOLDERS } from '@/lib/core/document-templates/placeholders'

type DocType = 'atestado' | 'declaracao' | 'receita' | 'outro'
type PaperSize = 'A4' | 'A5' | 'LETTER'

export interface TemplateDTO {
  id: string
  name: string
  docType: DocType
  body: string
  paperSize: PaperSize
  fontSize: number
}

const TYPE_LABEL: Record<DocType, string> = {
  atestado: 'Atestado',
  declaracao: 'Declaração',
  receita: 'Receita',
  outro: 'Outro',
}

const EMPTY = {
  id: null as string | null,
  name: '',
  docType: 'atestado' as DocType,
  body: '',
  paperSize: 'A4' as PaperSize,
  fontSize: 11,
}

export function TemplatesManager({ initial }: { initial: TemplateDTO[] }) {
  const router = useRouter()
  const [form, setForm] = useState<typeof EMPTY>(EMPTY)
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startNew() {
    setForm(EMPTY)
    setEditing(true)
    setError(null)
  }
  function startEdit(t: TemplateDTO) {
    setForm({ ...t })
    setEditing(true)
    setError(null)
  }

  async function save() {
    setError(null)
    if (form.name.trim().length < 1 || form.body.trim().length < 1) {
      setError('Preencha nome e conteúdo.')
      return
    }
    setPending(true)
    try {
      const payload = {
        name: form.name.trim(),
        doc_type: form.docType,
        body: form.body,
        paper_size: form.paperSize,
        font_size: form.fontSize,
      }
      const res = await fetch(
        form.id ? `/api/document-templates/${form.id}` : '/api/document-templates',
        {
          method: form.id ? 'PUT' : 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao salvar.')
        return
      }
      setEditing(false)
      setForm(EMPTY)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  async function remove(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Excluir este modelo?')) return
    setPending(true)
    try {
      await fetch(`/api/document-templates/${id}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">{editing ? (form.id ? 'Editar modelo' : 'Novo modelo') : 'Modelos'}</CardTitle>
          {!editing ? (
            <Button type="button" size="sm" onClick={startNew} className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Novo
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {editing ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px] font-bold uppercase text-slate-500">Nome</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div>
                  <Label className="text-[11px] font-bold uppercase text-slate-500">Tipo</Label>
                  <Select value={form.docType} onValueChange={(v) => setForm({ ...form, docType: v as DocType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="atestado">Atestado</SelectItem>
                      <SelectItem value="declaracao">Declaração</SelectItem>
                      <SelectItem value="receita">Receita</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <Label className="text-[11px] font-bold uppercase text-slate-500">Papel</Label>
                  <Select value={form.paperSize} onValueChange={(v) => setForm({ ...form, paperSize: v as PaperSize })}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A4">A4</SelectItem>
                      <SelectItem value="A5">A5</SelectItem>
                      <SelectItem value="LETTER">Carta</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[11px] font-bold uppercase text-slate-500">Fonte</Label>
                  <Input
                    type="number"
                    min={8}
                    max={18}
                    value={form.fontSize}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value))
                      if (Number.isFinite(n)) setForm({ ...form, fontSize: Math.min(18, Math.max(8, n)) })
                    }}
                    className="w-20"
                  />
                </div>
              </div>
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">Conteúdo</Label>
                <Textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={8} maxLength={8000} />
                <p className="mt-1 text-[11px] text-slate-500">
                  Variáveis: {AVAILABLE_PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(' · ')}
                </p>
              </div>
              {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={save} disabled={pending} className="gap-2">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => { setEditing(false); setForm(EMPTY) }} disabled={pending}>
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Crie modelos reutilizáveis para atestados, declarações e receitas com variáveis do
              paciente. Eles ficam disponíveis ao emitir documentos na ficha.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Modelos cadastrados ({initial.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {initial.length === 0 ? (
            <p className="py-3 text-center text-xs text-slate-500">Nenhum modelo cadastrado.</p>
          ) : (
            <ul className="space-y-1.5">
              {initial.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                    {TYPE_LABEL[t.docType]}
                  </span>
                  <span className="flex-1 font-semibold text-slate-800">{t.name}</span>
                  <span className="text-[10px] text-slate-400">{t.paperSize} · {t.fontSize}pt</span>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => startEdit(t)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-destructive" onClick={() => remove(t.id)} disabled={pending}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
