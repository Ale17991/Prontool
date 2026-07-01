'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Pencil, Plus, Tag as TagIcon, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import {
  PATIENT_TAG_COLOR_CLASSES,
  PATIENT_TAG_COLORS,
  type PatientTagColor,
} from '@/lib/core/patient-tags/palette'
import { cn } from '@/lib/utils'
import { TagBadge } from './tag-badge'

export interface PatientTag {
  id: string
  name: string
  color: PatientTagColor
}

export interface PatientTagsEditorProps {
  patientId: string
  /** Tags atualmente atribuídas ao paciente (controlado pelo parent). */
  value: PatientTag[]
  onChange: (next: PatientTag[]) => void
}

type Mode = 'list' | 'create' | { kind: 'edit'; tag: PatientTag }

/**
 * Editor inline de tags de um paciente.
 *
 * - Mostra badges atribuídos (com X pra remover).
 * - Botão "+ Tag" abre popover com catálogo do tenant: clique atribui.
 * - Dentro do popover: link "Nova tag" pra criar (nome + cor da paleta).
 * - Hover em cada item do catálogo mostra ícones de editar/excluir.
 *
 * Atribuir/remover é otimista: atualiza local primeiro, faz fetch em
 * paralelo, reverte se falhar.
 */
export function PatientTagsEditor({ patientId, value, onChange }: PatientTagsEditorProps) {
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<PatientTag[]>([])
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('list')
  const [search, setSearch] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!open || catalogLoaded) return
    setLoading(true)
    fetch('/api/patient-tags')
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((body: { tags: PatientTag[] }) => {
        setCatalog(body.tags ?? [])
        setCatalogLoaded(true)
      })
      .catch(() => setErrorMsg('Falha ao carregar catálogo.'))
      .finally(() => setLoading(false))
  }, [open, catalogLoaded])

  const assignedIds = useMemo(() => new Set(value.map((t) => t.id)), [value])

  async function assign(tag: PatientTag) {
    if (assignedIds.has(tag.id)) {
      setOpen(false)
      return
    }
    const previous = value
    onChange([...value, tag].sort((a, b) => a.name.localeCompare(b.name)))
    setOpen(false)
    setSearch('')
    const res = await fetch(`/api/pacientes/${patientId}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_id: tag.id }),
    })
    if (!res.ok) {
      onChange(previous)
      setErrorMsg('Falha ao atribuir tag.')
    }
  }

  async function unassign(tag: PatientTag) {
    const previous = value
    onChange(value.filter((t) => t.id !== tag.id))
    const res = await fetch(`/api/pacientes/${patientId}/tags?tag_id=${tag.id}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      onChange(previous)
      setErrorMsg('Falha ao remover tag.')
    }
  }

  async function createAndAssign(name: string, color: PatientTagColor) {
    setErrorMsg(null)
    const res = await fetch('/api/patient-tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      setErrorMsg(body?.error?.message ?? 'Falha ao criar tag.')
      return
    }
    const body = (await res.json()) as { tag: PatientTag }
    setCatalog((prev) => [...prev, body.tag].sort((a, b) => a.name.localeCompare(b.name)))
    setMode('list')
    await assign(body.tag)
  }

  async function updateTag(tag: PatientTag, name: string, color: PatientTagColor) {
    setErrorMsg(null)
    const res = await fetch(`/api/patient-tags/${tag.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      setErrorMsg(body?.error?.message ?? 'Falha ao atualizar tag.')
      return
    }
    const body = (await res.json()) as { tag: PatientTag }
    setCatalog((prev) =>
      prev
        .map((t) => (t.id === body.tag.id ? body.tag : t))
        .sort((a, b) => a.name.localeCompare(b.name)),
    )
    // Se a tag editada está atribuída, propaga a nova cor/nome pro parent.
    if (assignedIds.has(body.tag.id)) {
      onChange(value.map((t) => (t.id === body.tag.id ? body.tag : t)))
    }
    setMode('list')
  }

  async function removeFromCatalog(tag: PatientTag) {
    if (
      !confirm(`Excluir a tag "${tag.name}" do catálogo? Ela será removida de todos os pacientes.`)
    ) {
      return
    }
    setErrorMsg(null)
    const res = await fetch(`/api/patient-tags/${tag.id}`, { method: 'DELETE' })
    if (!res.ok) {
      setErrorMsg('Falha ao excluir tag.')
      return
    }
    setCatalog((prev) => prev.filter((t) => t.id !== tag.id))
    if (assignedIds.has(tag.id)) {
      onChange(value.filter((t) => t.id !== tag.id))
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((tag) => (
        <TagBadge key={tag.id} name={tag.name} color={tag.color} onRemove={() => unassign(tag)} />
      ))}

      <Popover
        open={open}
        onOpenChange={(v) => {
          setOpen(v)
          if (!v) {
            setMode('list')
            setSearch('')
            setErrorMsg(null)
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 rounded-full border-dashed px-2 text-xs font-medium text-slate-600"
          >
            <Plus className="h-3 w-3" />
            Tag
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          {mode === 'list' ? (
            <ListMode
              loading={loading}
              catalog={catalog}
              assignedIds={assignedIds}
              search={search}
              setSearch={setSearch}
              onAssign={assign}
              onUnassign={unassign}
              onEdit={(t) => setMode({ kind: 'edit', tag: t })}
              onCreateNew={() => setMode('create')}
              onDelete={removeFromCatalog}
              error={errorMsg}
            />
          ) : mode === 'create' ? (
            <TagForm
              title="Nova tag"
              initialName={search}
              initialColor="sky"
              onCancel={() => setMode('list')}
              onSubmit={createAndAssign}
              error={errorMsg}
            />
          ) : (
            <TagForm
              title="Editar tag"
              initialName={mode.tag.name}
              initialColor={mode.tag.color}
              onCancel={() => setMode('list')}
              onSubmit={(name, color) => updateTag(mode.tag, name, color)}
              error={errorMsg}
            />
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

interface ListModeProps {
  loading: boolean
  catalog: PatientTag[]
  assignedIds: Set<string>
  search: string
  setSearch: (v: string) => void
  onAssign: (tag: PatientTag) => void
  onUnassign: (tag: PatientTag) => void
  onEdit: (tag: PatientTag) => void
  onCreateNew: () => void
  onDelete: (tag: PatientTag) => void
  error: string | null
}

function ListMode({
  loading,
  catalog,
  assignedIds,
  search,
  setSearch,
  onAssign,
  onUnassign,
  onEdit,
  onCreateNew,
  onDelete,
  error,
}: ListModeProps) {
  const term = search.trim().toLowerCase()
  const filtered = term ? catalog.filter((t) => t.name.toLowerCase().includes(term)) : catalog
  const exactMatch = catalog.some((t) => t.name.toLowerCase() === term)

  return (
    <Command shouldFilter={false}>
      <CommandInput placeholder="Buscar ou criar tag..." value={search} onValueChange={setSearch} />
      <CommandList>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Carregando…
          </div>
        ) : filtered.length === 0 ? (
          <CommandEmpty className="py-4 text-center text-xs text-slate-500">
            {catalog.length === 0 ? 'Nenhuma tag cadastrada ainda.' : 'Nenhuma tag encontrada.'}
          </CommandEmpty>
        ) : (
          <CommandGroup heading="Catálogo">
            {filtered.map((t) => {
              const isAssigned = assignedIds.has(t.id)
              return (
                <CommandItem
                  key={t.id}
                  value={t.id}
                  onSelect={() => (isAssigned ? onUnassign(t) : onAssign(t))}
                  className="group/item cursor-pointer items-center gap-2 py-1.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'inline-block h-3 w-3 shrink-0 rounded-full',
                      PATIENT_TAG_COLOR_CLASSES[t.color].swatch,
                    )}
                  />
                  <span className="flex-1 truncate text-xs">{t.name}</span>
                  {isAssigned ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                  <span className="ml-1 hidden gap-0.5 group-hover/item:flex">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(t)
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      aria-label="Editar tag"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(t)
                      }}
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label="Excluir tag"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}
        {term && !exactMatch ? (
          <CommandGroup>
            <CommandItem
              value="__create__"
              onSelect={onCreateNew}
              className="cursor-pointer items-center gap-2 py-2 text-xs font-semibold text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Criar tag &quot;{search.trim()}&quot;
            </CommandItem>
          </CommandGroup>
        ) : !term ? (
          <CommandGroup>
            <CommandItem
              value="__create__"
              onSelect={onCreateNew}
              className="cursor-pointer items-center gap-2 py-2 text-xs font-semibold text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
              Nova tag
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
      {error ? (
        <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-destructive">{error}</p>
      ) : null}
    </Command>
  )
}

interface TagFormProps {
  title: string
  initialName: string
  initialColor: PatientTagColor
  onCancel: () => void
  onSubmit: (name: string, color: PatientTagColor) => void
  error: string | null
}

function TagForm({ title, initialName, initialColor, onCancel, onSubmit, error }: TagFormProps) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState<PatientTagColor>(initialColor)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed.length < 1) return
    setSubmitting(true)
    try {
      await onSubmit(trimmed, color)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <TagIcon className="h-3.5 w-3.5 text-slate-400" />
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">{title}</h4>
      </div>
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-500">Nome</label>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          className="h-8 text-xs"
          placeholder="Ex: VIP, Inadimplente, Crônico"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] font-semibold text-slate-500">Cor</label>
        <div className="grid grid-cols-8 gap-1.5">
          {PATIENT_TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Cor ${c}`}
              className={cn(
                'h-6 w-6 rounded-full border-2 transition-all',
                PATIENT_TAG_COLOR_CLASSES[c].swatch,
                c === color
                  ? 'border-slate-900 ring-2 ring-slate-300 ring-offset-1'
                  : 'border-white hover:scale-110',
              )}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <div className="text-[11px]">
          <span className="text-slate-400">Prévia: </span>
          <TagBadge name={name.trim() || 'tag'} color={color} size="sm" />
        </div>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            className="h-7 text-xs"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={submitting || name.trim().length < 1}
            className="h-7 text-xs"
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Salvar'}
          </Button>
        </div>
      </div>
      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
    </form>
  )
}
