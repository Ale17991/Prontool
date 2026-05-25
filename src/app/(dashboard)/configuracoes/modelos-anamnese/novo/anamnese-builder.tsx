'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlignLeft,
  ArrowDown,
  ArrowUp,
  Calendar,
  CheckSquare,
  ChevronDown,
  Eye,
  GripVertical,
  Hash,
  Layers,
  Layout,
  Loader2,
  Plus,
  Radio,
  Save,
  Settings2,
  Trash2,
  Type,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type FieldType =
  | 'texto_curto'
  | 'texto_longo'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'data'
  | 'numero'

interface Field {
  id: string
  type: FieldType
  label: string
  required: boolean
  options?: string[]
  is_default?: boolean
}

const DEFAULT_FIELDS: Field[] = [
  { id: 'default_nome', type: 'texto_curto', label: 'Nome completo', required: true, is_default: true },
  { id: 'default_cpf', type: 'texto_curto', label: 'CPF', required: true, is_default: true },
  { id: 'default_telefone', type: 'texto_curto', label: 'Telefone', required: true, is_default: true },
  { id: 'default_email', type: 'texto_curto', label: 'Email', required: false, is_default: true },
  { id: 'default_data_nasc', type: 'data', label: 'Data de nascimento', required: false, is_default: true },
  { id: 'default_plano', type: 'texto_curto', label: 'Plano de saúde', required: false, is_default: true },
  { id: 'default_cep', type: 'texto_curto', label: 'CEP', required: false, is_default: true },
  { id: 'default_endereco', type: 'texto_longo', label: 'Endereço completo', required: false, is_default: true },
  { id: 'default_alergias', type: 'texto_longo', label: 'Alergias conhecidas', required: true, is_default: true },
]

const FIELD_TYPES: Array<{
  type: FieldType
  label: string
  icon: React.ComponentType<{ className?: string }>
  color: string
}> = [
  // 016 — campos categoricos (tipos de field) — usa paleta do designer
  // onde semantic e Tailwind defaults para variedade categorica.
  { type: 'texto_curto', label: 'Campo de texto', icon: Type, color: 'text-info-text bg-info-bg' },
  { type: 'texto_longo', label: 'Área de texto', icon: AlignLeft, color: 'text-indigo-600 bg-indigo-50' },
  { type: 'checkbox', label: 'Checkboxes', icon: CheckSquare, color: 'text-success-strong bg-success-bg' },
  { type: 'radio', label: 'Múltipla escolha', icon: Radio, color: 'text-violet-600 bg-violet-50' },
  { type: 'select', label: 'Seleção única', icon: ChevronDown, color: 'text-[hsl(var(--warning-foreground))] bg-[hsl(var(--warning)/0.15)]' },
  { type: 'data', label: 'Data', icon: Calendar, color: 'text-destructive bg-destructive/10' },
  { type: 'numero', label: 'Numérico', icon: Hash, color: 'text-slate-600 bg-slate-50' },
]

const HAS_OPTIONS = new Set<FieldType>(['radio', 'select', 'checkbox'])

export function AnamneseBuilder() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Defaults pré-marcados (controlados via includedDefaults). Custom fields
  // ficam num array separado pra preservar ordem das duas seções.
  const [includedDefaults, setIncludedDefaults] = useState<Record<string, boolean>>(
    Object.fromEntries(DEFAULT_FIELDS.map((d) => [d.id, true])),
  )
  const [fields, setFields] = useState<Field[]>([])
  const [activeTab, setActiveTab] = useState<'build' | 'preview'>('build')

  function addField(type: FieldType) {
    const newField: Field = {
      id: `f_${Math.random().toString(36).slice(2, 10)}`,
      type,
      label: `Novo campo`,
      required: false,
      options: HAS_OPTIONS.has(type) ? ['Opção 1'] : undefined,
    }
    setFields([...fields, newField])
  }

  function removeField(id: string) {
    setFields(fields.filter((f) => f.id !== id))
  }

  function updateField(id: string, updates: Partial<Field>) {
    setFields(fields.map((f) => (f.id === id ? { ...f, ...updates } : f)))
  }

  function moveField(index: number, direction: 'up' | 'down') {
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= fields.length) return
    const next = [...fields]
    const [moved] = next.splice(index, 1)
    if (moved) next.splice(target, 0, moved)
    setFields(next)
  }

  function buildFinalFields(): Field[] {
    const includedDefaultsList = DEFAULT_FIELDS.filter((d) => includedDefaults[d.id])
    return [...includedDefaultsList, ...fields]
  }

  async function handleSave() {
    setError(null)
    if (!title.trim()) {
      setError('Informe o título do modelo.')
      return
    }
    const finalFields = buildFinalFields()
    if (finalFields.length === 0) {
      setError('Adicione pelo menos um campo ao modelo.')
      return
    }
    for (const f of finalFields) {
      if (!f.label.trim()) {
        setError('Todo campo precisa de um rótulo.')
        return
      }
      if (HAS_OPTIONS.has(f.type) && (!f.options || f.options.length === 0)) {
        setError(`Campo "${f.label}" precisa de pelo menos uma opção.`)
        return
      }
    }

    setLoading(true)
    // Flag para impedir double-submit durante a janela router.push.
    let success = false
    try {
      const res = await fetch('/api/anamnesis-templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          fields: finalFields,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao salvar o modelo.')
        return
      }
      success = true
      router.push('/configuracoes/modelos-anamnese')
      router.refresh()
    } finally {
      if (!success) setLoading(false)
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="outline" className="bg-slate-50 text-slate-500">
            Anamnese · rascunho
          </Badge>
          <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
            Construtor de modelos
          </h1>
          <p className="text-sm text-slate-500">
            Padronize atendimentos com campos estruturados. Salvar cria v1; editar depois
            cria nova versão (anamneses anteriores ficam preservadas).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-md bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('build')}
              className={cn(
                'flex items-center gap-1 rounded px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors',
                activeTab === 'build'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Layout className="h-3 w-3" /> Construir
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={cn(
                'flex items-center gap-1 rounded px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors',
                activeTab === 'preview'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              <Eye className="h-3 w-3" /> Preview
            </button>
          </div>
          <Button onClick={handleSave} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar modelo
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-3">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Tipos de campo
          </h3>
          <div className="space-y-2">
            {FIELD_TYPES.map(({ type, label, icon: Icon, color }) => (
              <motion.button
                key={type}
                type="button"
                whileHover={{ x: 3 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => addField(type)}
                className="flex w-full items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-blue-400"
              >
                <div className={cn('rounded-md p-2', color)}>
                  <Icon className="h-4 w-4" />
                </div>
                <span className="text-xs font-semibold text-slate-700">{label}</span>
              </motion.button>
            ))}
          </div>
        </aside>

        <div className="space-y-5">
          <AnimatePresence mode="wait">
            {activeTab === 'build' ? (
              <motion.div
                key="build"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-5"
              >
                <Card className="p-5 space-y-3">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Informações básicas
                  </label>
                  <Input
                    placeholder="Título (ex.: Anamnese ortopédica)"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="text-base font-bold"
                  />
                  <Textarea
                    placeholder="Descrição interna para os profissionais (opcional)…"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="min-h-[80px]"
                  />
                </Card>

                <Card className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Campos padrão
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Pré-preenchidos a partir do cadastro do paciente quando aplicado.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {DEFAULT_FIELDS.map((d) => {
                      const included = includedDefaults[d.id] ?? true
                      return (
                        <label
                          key={d.id}
                          className={cn(
                            'flex items-center justify-between gap-3 rounded-md border bg-white px-3 py-2 transition-colors',
                            included
                              ? 'border-blue-200 bg-blue-50/30'
                              : 'border-slate-200 opacity-70',
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <input
                              type="checkbox"
                              checked={included}
                              onChange={(e) =>
                                setIncludedDefaults((prev) => ({
                                  ...prev,
                                  [d.id]: e.target.checked,
                                }))
                              }
                              className="h-4 w-4"
                            />
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {d.label}
                                {d.required ? (
                                  <span className="ml-1 text-rose-500">*</span>
                                ) : null}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                Tipo: {d.type.replace('_', ' ')}
                              </p>
                            </div>
                          </div>
                          <Badge
                            variant="secondary"
                            className="h-5 bg-blue-100 px-2 text-[10px] text-blue-800"
                          >
                            Padrão
                          </Badge>
                        </label>
                      )
                    })}
                  </div>
                </Card>

                {fields.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center">
                    <Layers className="h-8 w-8 text-slate-300" />
                    <p className="text-sm font-semibold text-slate-500">
                      Os campos padrão acima já estão prontos.
                    </p>
                    <p className="text-xs text-slate-500">
                      Para adicionar campos personalizados, escolha um tipo no painel
                      à esquerda.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {fields.map((field, index) => (
                      <motion.div
                        key={field.id}
                        layout
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                      >
                        <Card className="p-5">
                          <div className="flex items-start gap-4">
                            <div className="mt-1 text-slate-300">
                              <GripVertical className="h-4 w-4" />
                            </div>
                            <div className="flex-1 space-y-3">
                              <Input
                                value={field.label}
                                onChange={(e) =>
                                  updateField(field.id, { label: e.target.value })
                                }
                                className="font-semibold"
                                placeholder="Rótulo do campo"
                              />
                              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                                Tipo: {field.type.replace('_', ' ')}
                              </p>

                              {HAS_OPTIONS.has(field.type) ? (
                                <div className="space-y-2">
                                  <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                    <Settings2 className="h-3 w-3" /> Opções
                                  </div>
                                  <div className="space-y-1">
                                    {(field.options ?? []).map((opt, optIndex) => (
                                      <div key={optIndex} className="flex gap-2">
                                        <Input
                                          value={opt}
                                          onChange={(e) => {
                                            const next = [...(field.options ?? [])]
                                            next[optIndex] = e.target.value
                                            updateField(field.id, { options: next })
                                          }}
                                          className="h-8 text-xs"
                                        />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const next = (field.options ?? []).filter(
                                              (_, i) => i !== optIndex,
                                            )
                                            updateField(field.id, { options: next })
                                          }}
                                          className="px-2 text-destructive/70 hover:text-destructive"
                                          aria-label="Remover opção"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    ))}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateField(field.id, {
                                          options: [
                                            ...(field.options ?? []),
                                            `Opção ${(field.options?.length ?? 0) + 1}`,
                                          ],
                                        })
                                      }
                                      className="text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-700"
                                    >
                                      + adicionar opção
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="flex flex-col items-end gap-2 text-xs">
                              <label className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                                <input
                                  type="checkbox"
                                  checked={field.required}
                                  onChange={(e) =>
                                    updateField(field.id, { required: e.target.checked })
                                  }
                                  className="h-3.5 w-3.5"
                                />
                                Obrigatório
                              </label>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => moveField(index, 'up')}
                                  className="rounded bg-slate-50 p-1 text-slate-400 hover:bg-slate-100"
                                  aria-label="Subir"
                                >
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveField(index, 'down')}
                                  className="rounded bg-slate-50 p-1 text-slate-400 hover:bg-slate-100"
                                  aria-label="Descer"
                                >
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeField(field.id)}
                                  className="rounded bg-destructive/10 p-1 text-destructive hover:bg-destructive/20"
                                  aria-label="Remover campo"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </Card>
                      </motion.div>
                    ))}
                  </div>
                )}
              </motion.div>
            ) : (
              <motion.div
                key="preview"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
              >
                <Card className="p-8 space-y-6">
                  <div>
                    <h2 className="text-xl font-black text-slate-900">
                      {title || 'Título do modelo'}
                    </h2>
                    {description ? (
                      <p className="mt-1 text-sm text-slate-500">{description}</p>
                    ) : null}
                  </div>
                  <div className="space-y-4">
                    {buildFinalFields().length === 0 ? (
                      <p className="text-sm text-slate-400">Nenhum campo selecionado.</p>
                    ) : (
                      buildFinalFields().map((field) => (
                        <div key={field.id} className="space-y-1">
                          <label className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-700">
                            {field.label}
                            {field.required ? (
                              <span className="text-rose-500">*</span>
                            ) : null}
                            {field.is_default ? (
                              <Badge
                                variant="secondary"
                                className="h-4 bg-blue-100 px-1.5 text-[9px] text-blue-800"
                              >
                                Padrão
                              </Badge>
                            ) : null}
                          </label>
                          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400">
                            Prévia — {field.type.replace('_', ' ')}
                            {field.options ? ` · ${field.options.length} opções` : ''}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
