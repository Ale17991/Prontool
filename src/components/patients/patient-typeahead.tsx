'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown, Loader2, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TagBadge } from '@/components/patient-tags/tag-badge'
import type { PatientTagColor } from '@/lib/core/patient-tags/palette'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

/**
 * Resultado mínimo entregue ao parent quando um paciente é escolhido.
 * Inclui planId pra evitar uma segunda chamada quando o consumidor precisa
 * derivar plano default (ex.: form de novo atendimento).
 */
export interface PatientTypeaheadTag {
  id: string
  name: string
  color: PatientTagColor
}

export interface PatientTypeaheadValue {
  id: string
  fullName: string
  cpf: string
  planId: string | null
  planName: string | null
  tags: PatientTypeaheadTag[]
}

interface ApiItem {
  id: string
  fullName: string
  cpf: string
  anonymizedAt: string | null
  planId?: string | null
  planName?: string | null
  tags?: PatientTypeaheadTag[]
}

export interface PatientTypeaheadProps {
  /** Paciente selecionado atualmente (id), ou null pra estado vazio. */
  value: string | null
  /** Disparado tanto na seleção quanto na limpeza. */
  onChange: (patient: PatientTypeaheadValue | null) => void
  /**
   * Seed exibido quando `value` está preenchido mas o componente acabou
   * de montar — evita buscar só pra mostrar o nome no botão. Opcional.
   */
  initial?: PatientTypeaheadValue | null
  placeholder?: string
  id?: string
  disabled?: boolean
  /** Mostra a opção de cadastrar um paciente novo direto do seletor. */
  allowCreate?: boolean
}

function maskCpf(raw: string | null | undefined): string {
  if (!raw) return '—'
  const d = raw.replace(/\D/g, '')
  if (d.length !== 11) return raw
  return `***.***.***-${d.slice(9)}`
}

/**
 * Combobox de paciente com busca server-side.
 *
 * - Debounce 300ms entre digitação e fetch
 * - `AbortController` cancela buscas anteriores
 * - Lista vazia (`q=""`) carrega os pacientes mais recentes do tenant
 * - Anonimizados ficam fora dos resultados (filtrados aqui)
 *
 * PII é criptografada no banco; por isso o filtro não pode ser
 * client-side. O endpoint `/api/pacientes` decripta via RPC bulk e
 * faz a busca por nome/CPF no servidor (lib/core/patients/list.ts).
 */
export function PatientTypeahead({
  value,
  onChange,
  initial,
  placeholder = 'Buscar paciente por nome ou CPF…',
  id,
  disabled,
  allowCreate = false,
}: PatientTypeaheadProps) {
  const [open, setOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<PatientTypeaheadValue[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Cache do paciente atualmente selecionado pra renderizar o botão sem
   * depender do array `items` (que muda conforme a busca).
   */
  const [selected, setSelected] = useState<PatientTypeaheadValue | null>(initial ?? null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Mantém o display do botão sincronizado quando o parent troca o id.
  useEffect(() => {
    if (!value) {
      setSelected(null)
      return
    }
    if (selected?.id === value) return
    if (initial && initial.id === value) {
      setSelected(initial)
      return
    }
    // Sem seed e id desconhecido: busca o detalhe pra exibir nome.
    const ctrl = new AbortController()
    fetch(`/api/pacientes/${value}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body?.patient) return
        setSelected({
          id: body.patient.id,
          fullName: body.patient.fullName ?? '',
          cpf: body.patient.cpf ?? '',
          planId: body.patient.healthPlan?.id ?? null,
          planName: body.patient.healthPlan?.name ?? null,
          tags: [],
        })
      })
      .catch(() => {
        // silencioso — botão fica com placeholder
      })
    return () => ctrl.abort()
  }, [value, initial, selected?.id])

  // Fetch com debounce sempre que abre o popover ou muda a busca.
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    setError(null)
    debounceRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          page_size: '20',
          include: 'plan,tags',
        })
        const q = search.trim()
        if (q) params.set('q', q)
        const res = await fetch(`/api/pacientes?${params.toString()}`, {
          signal: ctrl.signal,
        })
        if (!res.ok) {
          setError('Falha ao buscar pacientes.')
          setItems([])
          return
        }
        const body = (await res.json()) as { items: ApiItem[] }
        const mapped: PatientTypeaheadValue[] = (body.items ?? [])
          .filter((p) => !p.anonymizedAt)
          .map((p) => ({
            id: p.id,
            fullName: p.fullName || '(sem nome)',
            cpf: p.cpf ?? '',
            planId: p.planId ?? null,
            planName: p.planName ?? null,
            tags: p.tags ?? [],
          }))
        setItems(mapped)
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return
        setError('Falha ao buscar pacientes.')
        setItems([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      ctrl.abort()
    }
  }, [open, search])

  function pick(p: PatientTypeaheadValue) {
    setSelected(p)
    onChange(p)
    setOpen(false)
    setSearch('')
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    setSelected(null)
    onChange(null)
  }

  const triggerLabel = useMemo(() => {
    if (!selected) return placeholder
    return selected.fullName
  }, [selected, placeholder])

  return (
    <>
      <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            <span className={cn('truncate', !selected && 'text-slate-500')}>{triggerLabel}</span>
            <span className="ml-2 flex shrink-0 items-center gap-1">
              {selected ? (
                <button
                  type="button"
                  onClick={clear}
                  aria-label="Limpar seleção"
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <ChevronsUpDown className="h-4 w-4 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[min(640px,calc(100vw-2rem))] min-w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Digite nome ou CPF…"
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Buscando…
                </div>
              ) : error ? (
                <p className="py-6 text-center text-xs text-destructive">{error}</p>
              ) : items.length === 0 ? (
                <CommandEmpty className="py-6 text-center text-xs text-slate-500">
                  {search.trim() ? 'Nenhum paciente encontrado.' : 'Nenhum paciente nesta clínica.'}
                </CommandEmpty>
              ) : (
                <CommandGroup heading="Pacientes">
                  {items.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={p.id}
                      onSelect={() => pick(p)}
                      className="cursor-pointer items-start py-2 text-xs"
                    >
                      <Check
                        className={cn(
                          'mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary',
                          selected?.id === p.id ? 'opacity-100' : 'opacity-0',
                        )}
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-semibold text-slate-900">{p.fullName}</span>
                        {p.tags.length > 0 ? (
                          <span className="flex flex-wrap items-center gap-1">
                            {p.tags.map((t) => (
                              <TagBadge key={t.id} name={t.name} color={t.color} size="sm" />
                            ))}
                          </span>
                        ) : null}
                        <span className="flex items-center gap-2 text-[11px] text-slate-500">
                          <span className="font-mono">{maskCpf(p.cpf)}</span>
                          <span aria-hidden>·</span>
                          <span className="truncate">{p.planName ?? 'Particular'}</span>
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
            {allowCreate ? (
              <div className="border-t border-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setCreateOpen(true)
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-primary hover:bg-primary/5"
                >
                  <UserPlus className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    Cadastrar novo paciente{search.trim() ? `: “${search.trim()}”` : ''}
                  </span>
                </button>
              </div>
            ) : null}
          </Command>
        </PopoverContent>
      </Popover>
      {allowCreate ? (
        <QuickCreatePatient
          open={createOpen}
          onOpenChange={setCreateOpen}
          initialName={search.trim()}
          onCreated={(p) => {
            setCreateOpen(false)
            pick(p)
          }}
        />
      ) : null}
    </>
  )
}

/** Cadastro rápido de paciente a partir do seletor (nome obrigatório). */
function QuickCreatePatient({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  initialName: string
  onCreated: (p: PatientTypeaheadValue) => void
}) {
  const [name, setName] = useState(initialName)
  const [cpf, setCpf] = useState('')
  const [birth, setBirth] = useState('')
  const [sex, setSex] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setCpf('')
      setBirth('')
      setSex('')
      setErr(null)
    }
  }, [open, initialName])

  async function submit() {
    if (name.trim().length < 2) {
      setErr('Informe o nome (mínimo 2 letras).')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = { full_name: name.trim() }
      const cpfDigits = cpf.replace(/\D/g, '')
      if (cpfDigits.length === 11) body.cpf = cpfDigits
      if (birth) body.birth_date = birth
      if (sex) body.sex = sex
      const res = await fetch('/api/pacientes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setErr(b.error?.message ?? 'Falha ao cadastrar o paciente.')
        return
      }
      const r = (await res.json()) as { patientId: string }
      onCreated({
        id: r.patientId,
        fullName: name.trim(),
        cpf: cpfDigits.length === 11 ? cpfDigits : '',
        planId: null,
        planName: null,
        tags: [],
      })
    } catch {
      setErr('Falha ao cadastrar o paciente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Novo paciente</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="qp_name">Nome completo *</Label>
            <Input id="qp_name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="qp_birth">Data de nascimento</Label>
              <Input
                id="qp_birth"
                type="date"
                value={birth}
                onChange={(e) => setBirth(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="qp_sex">Sexo</Label>
              <select
                id="qp_sex"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={sex}
                onChange={(e) => setSex(e.target.value)}
              >
                <option value="">—</option>
                <option value="feminino">Feminino</option>
                <option value="masculino">Masculino</option>
                <option value="intersexo">Intersexo</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="qp_cpf">CPF (opcional)</Label>
            <Input
              id="qp_cpf"
              inputMode="numeric"
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="somente números"
            />
          </div>
          {err ? <p className="text-xs font-semibold text-destructive">{err}</p> : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={saving} className="gap-1.5">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}{' '}
            Cadastrar e selecionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
