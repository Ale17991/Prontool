'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { EXAM_REPORT_PLACEHOLDERS } from '@/lib/core/exam-report-templates/placeholders'

type ExamType = 'oftalmologico'

export interface LaudoTemplateDTO {
  id: string
  examType: ExamType
  name: string
  headerText: string | null
  conclusionText: string | null
  footerText: string | null
  isDefault: boolean
}

const TYPE_LABEL: Record<ExamType, string> = {
  oftalmologico: 'Oftalmológico',
}

const EMPTY = {
  id: null as string | null,
  examType: 'oftalmologico' as ExamType,
  name: '',
  headerText: '',
  conclusionText: '',
  footerText: '',
  isDefault: false,
}

export function LaudoTemplatesManager({ initial }: { initial: LaudoTemplateDTO[] }) {
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
  function startEdit(t: LaudoTemplateDTO) {
    setForm({
      id: t.id,
      examType: t.examType,
      name: t.name,
      headerText: t.headerText ?? '',
      conclusionText: t.conclusionText ?? '',
      footerText: t.footerText ?? '',
      isDefault: t.isDefault,
    })
    setEditing(true)
    setError(null)
  }

  async function save() {
    setError(null)
    if (form.name.trim().length < 1) {
      setError('Informe o nome do modelo.')
      return
    }
    setPending(true)
    try {
      const payload = {
        exam_type: form.examType,
        name: form.name.trim(),
        header_text: form.headerText.trim() || null,
        conclusion_text: form.conclusionText.trim() || null,
        footer_text: form.footerText.trim() || null,
        is_default: form.isDefault,
      }
      const res = await fetch(
        form.id ? `/api/exam-report-templates/${form.id}` : '/api/exam-report-templates',
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
      await fetch(`/api/exam-report-templates/${id}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {editing ? (form.id ? 'Editar modelo' : 'Novo modelo') : 'Modelo de laudo'}
          </CardTitle>
          {!editing ? (
            <Button type="button" size="sm" onClick={startNew} className="h-8 gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Novo
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {editing ? (
            <>
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">Nome</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">
                  Cabeçalho (acima das tabelas)
                </Label>
                <Textarea
                  value={form.headerText}
                  onChange={(e) => setForm({ ...form, headerText: e.target.value })}
                  rows={3}
                  maxLength={4000}
                />
              </div>
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">
                  Conclusão / observações
                </Label>
                <Textarea
                  value={form.conclusionText}
                  onChange={(e) => setForm({ ...form, conclusionText: e.target.value })}
                  rows={5}
                  maxLength={8000}
                />
              </div>
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">
                  Rodapé (opcional)
                </Label>
                <Textarea
                  value={form.footerText}
                  onChange={(e) => setForm({ ...form, footerText: e.target.value })}
                  rows={2}
                  maxLength={2000}
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Variáveis: {EXAM_REPORT_PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(' · ')}
              </p>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={form.isDefault}
                  onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Usar como modelo padrão (aplicado automaticamente ao gerar o laudo)
              </label>
              {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={save} disabled={pending} className="gap-2">
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Salvar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditing(false)
                    setForm(EMPTY)
                  }}
                  disabled={pending}
                >
                  Cancelar
                </Button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              Modelos pré-estabelecidos de laudo por tipo de exame. O modelo padrão é aplicado
              automaticamente sobre os dados estruturados do exame ao gerar o PDF na ficha do
              paciente.
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
                <li
                  key={t.id}
                  className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                    {TYPE_LABEL[t.examType]}
                  </span>
                  <span className="flex-1 font-semibold text-slate-800">{t.name}</span>
                  {t.isDefault ? (
                    <span className="rounded bg-success-bg px-1.5 py-0.5 text-[10px] font-bold text-success-text">
                      padrão
                    </span>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => startEdit(t)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-destructive"
                    onClick={() => remove(t.id)}
                    disabled={pending}
                  >
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
