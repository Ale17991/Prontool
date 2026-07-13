'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TussTypeahead, type TussTypeaheadValue } from '@/components/tuss/tuss-typeahead'

/**
 * Feature 045 — material de um atendimento em criação. Origem: catálogo
 * (`materialId`), insumo livre (`materialName`) ou TUSS (`tussCode`). `costReais`
 * é o custo unitário editável em reais (string "12,50"); vazio = pendência de
 * custo (unit_cost_cents = 0). O parent controla todo o estado.
 */
export interface MaterialDraft {
  materialId: string | null
  materialName: string | null
  tussCode: string | null
  tussDescription: string | null
  quantity: number
  costReais: string
}

interface CatalogItem {
  id: string
  name: string
  unit_cost_cents: number
  tuss_code: string | null
}

type AddMode = 'catalogo' | 'livre' | 'tuss'

export interface MateriaisEditorProps {
  value: MaterialDraft[]
  onChange: (next: MaterialDraft[]) => void
  disabled?: boolean
  /** Inicia expandido (default false). */
  defaultOpen?: boolean
  /**
   * Quando true (admin/financeiro), habilita "salvar no catálogo" no
   * quick-add de insumo livre (T024). Sem permissão, o insumo é só do
   * atendimento.
   */
  canManageCatalog?: boolean
}

/** "12,50" | "12.50" | "1250" (reais) → centavos. Vazio → null (pendência). */
export function parseReaisToCents(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const normalized = s.replace(/\./g, '').replace(',', '.')
  const n = Number.parseFloat(normalized)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

export function centsToReais(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

function displayName(m: MaterialDraft): string {
  return m.materialName || m.tussDescription || m.tussCode || '—'
}

export function MateriaisEditor({
  value,
  onChange,
  disabled = false,
  defaultOpen = false,
  canManageCatalog = false,
}: MateriaisEditorProps) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const [mode, setMode] = useState<AddMode>('catalogo')
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [catalogLoaded, setCatalogLoaded] = useState(false)
  const [tussPicker, setTussPicker] = useState<TussTypeaheadValue | null>(null)
  const [tussKey, setTussKey] = useState(0)
  const [freeName, setFreeName] = useState('')
  const [freeCost, setFreeCost] = useState('')
  const [saveToCatalog, setSaveToCatalog] = useState(false)
  const [savingFree, setSavingFree] = useState(false)
  const [freeError, setFreeError] = useState<string | null>(null)

  useEffect(() => {
    if (!expanded || catalogLoaded) return
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/api/materiais', { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { materials?: CatalogItem[] }
        if (alive) setCatalog(body.materials ?? [])
      } catch {
        // catálogo indisponível — segue com insumo livre/TUSS.
      } finally {
        if (alive) setCatalogLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [expanded, catalogLoaded])

  const catalogById = useMemo(() => {
    const map = new Map<string, CatalogItem>()
    for (const c of catalog) map.set(c.id, c)
    return map
  }, [catalog])

  function addFromCatalog(id: string) {
    const item = catalogById.get(id)
    if (!item) return
    onChange([
      ...value,
      {
        materialId: item.id,
        materialName: item.name,
        tussCode: item.tuss_code,
        tussDescription: null,
        quantity: 1,
        costReais: item.unit_cost_cents > 0 ? centsToReais(item.unit_cost_cents) : '',
      },
    ])
  }

  function addFromTuss(item: TussTypeaheadValue | null) {
    if (!item) return
    onChange([
      ...value,
      {
        materialId: null,
        materialName: null,
        tussCode: item.code,
        tussDescription: item.description,
        quantity: 1,
        costReais: '',
      },
    ])
    setTussPicker(null)
    setTussKey((k) => k + 1)
  }

  async function addFree() {
    setFreeError(null)
    const name = freeName.trim()
    if (!name) {
      setFreeError('Informe o nome do insumo.')
      return
    }
    const costCents = parseReaisToCents(freeCost)
    if (freeCost.trim() && costCents === null) {
      setFreeError('Custo inválido.')
      return
    }

    // T024: opcionalmente persiste no catálogo antes de anexar.
    let materialId: string | null = null
    if (saveToCatalog && canManageCatalog) {
      setSavingFree(true)
      try {
        const res = await fetch('/api/materiais', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, unit_cost_cents: costCents ?? 0 }),
        })
        if (res.ok) {
          const created = (await res.json()) as CatalogItem
          materialId = created.id
          setCatalog((prev) => [...prev, created])
        } else {
          const body = (await res.json().catch(() => null)) as {
            error?: { message?: string }
          } | null
          setFreeError(body?.error?.message ?? 'Não foi possível salvar no catálogo.')
          setSavingFree(false)
          return
        }
      } catch {
        setFreeError('Não foi possível salvar no catálogo.')
        setSavingFree(false)
        return
      }
      setSavingFree(false)
    }

    onChange([
      ...value,
      {
        materialId,
        materialName: name,
        tussCode: null,
        tussDescription: null,
        quantity: 1,
        costReais: costCents !== null ? centsToReais(costCents) : '',
      },
    ])
    setFreeName('')
    setFreeCost('')
  }

  function updateQuantity(index: number, raw: string) {
    const parsed = Number.parseInt(raw, 10)
    const quantity = Number.isFinite(parsed) ? parsed : 0
    onChange(value.map((m, i) => (i === index ? { ...m, quantity } : m)))
  }

  function incrementQuantity(index: number, delta: number) {
    onChange(
      value.map((m, i) =>
        i === index ? { ...m, quantity: Math.max(1, (m.quantity || 1) + delta) } : m,
      ),
    )
  }

  function updateCost(index: number, raw: string) {
    onChange(value.map((m, i) => (i === index ? { ...m, costReais: raw } : m)))
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  const availableCatalog = catalog

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50/40">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-slate-700 hover:text-slate-900"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-2">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
          Materiais utilizados (opcional)
          {value.length > 0 ? (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">
              {value.length}
            </span>
          ) : null}
        </span>
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-slate-200 px-3 py-3">
          {value.length > 0 ? (
            <ul className="space-y-1.5">
              {value.map((m, i) => {
                const qtyInvalid = !Number.isFinite(m.quantity) || m.quantity < 1
                const costCents = parseReaisToCents(m.costReais)
                const costInvalid = m.costReais.trim() !== '' && costCents === null
                const pending = costCents === null || costCents === 0
                return (
                  <li
                    key={`${m.materialId ?? m.tussCode ?? m.materialName}-${i}`}
                    className="flex flex-wrap items-start gap-2 rounded border border-slate-200 bg-white p-2 text-xs"
                  >
                    {m.tussCode ? (
                      <span className="font-mono font-bold text-slate-900">{m.tussCode}</span>
                    ) : null}
                    <span className="min-w-0 flex-1 text-slate-700">
                      {displayName(m)}
                      {pending ? (
                        <span
                          className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                          title="Custo ainda não informado — poderá ser completado depois."
                        >
                          custo pendente
                        </span>
                      ) : null}
                    </span>
                    <div className="flex items-center gap-1">
                      <label className="mr-1 text-[10px] uppercase text-slate-500">Custo un.</label>
                      <span className="text-slate-400">R$</span>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={m.costReais}
                        onChange={(e) => updateCost(i, e.target.value)}
                        disabled={disabled}
                        placeholder="0,00"
                        className={`h-7 w-20 text-right tabular-nums ${costInvalid ? 'border-destructive/60 focus-visible:ring-destructive/30' : ''}`}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <label className="mr-1 text-[10px] uppercase text-slate-500">Qtd</label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => incrementQuantity(i, -1)}
                        disabled={disabled || (m.quantity ?? 1) <= 1}
                        className="h-7 w-7 p-0"
                        title="Diminuir quantidade"
                        aria-label="Diminuir quantidade"
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={m.quantity}
                        onChange={(e) => updateQuantity(i, e.target.value)}
                        disabled={disabled}
                        className={`h-7 w-14 text-center tabular-nums ${qtyInvalid ? 'border-destructive/60 focus-visible:ring-destructive/30' : ''}`}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => incrementQuantity(i, 1)}
                        disabled={disabled}
                        className="h-7 w-7 p-0"
                        title="Aumentar quantidade"
                        aria-label="Aumentar quantidade"
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAt(i)}
                        disabled={disabled}
                        className="ml-1 h-7 w-7 p-0 text-slate-400 hover:text-destructive"
                        title="Remover material"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {qtyInvalid ? (
                      <span className="basis-full text-[11px] text-destructive">
                        Quantidade deve ser um número inteiro maior que zero.
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}

          {/* Seletor de modo de adição */}
          <div className="inline-flex overflow-hidden rounded-md border border-slate-200 text-xs">
            {(
              [
                ['catalogo', 'Do catálogo'],
                ['livre', 'Insumo livre'],
                ['tuss', 'TUSS'],
              ] as Array<[AddMode, string]>
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                disabled={disabled}
                className={`px-3 py-1.5 ${mode === m ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'catalogo' ? (
            <div className="space-y-1">
              <div className="text-[11px] text-slate-500">
                Selecione um insumo cadastrado (o custo vem do catálogo e pode ser ajustado por
                lançamento):
              </div>
              {catalogLoaded && availableCatalog.length === 0 ? (
                <div className="text-[11px] text-slate-400">
                  Nenhum insumo no catálogo ainda. Use “Insumo livre” ou cadastre em
                  Configurações → Materiais.
                </div>
              ) : (
                <select
                  className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-700 disabled:opacity-60"
                  value=""
                  disabled={disabled || !catalogLoaded}
                  onChange={(e) => {
                    if (e.target.value) addFromCatalog(e.target.value)
                    e.target.value = ''
                  }}
                >
                  <option value="">+ Adicionar do catálogo…</option>
                  {availableCatalog.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.unit_cost_cents > 0 ? ` — R$ ${centsToReais(c.unit_cost_cents)}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ) : null}

          {mode === 'livre' ? (
            <div className="space-y-1.5">
              <div className="text-[11px] text-slate-500">
                Insumo fora do catálogo (só neste atendimento):
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="text"
                  value={freeName}
                  onChange={(e) => setFreeName(e.target.value)}
                  disabled={disabled || savingFree}
                  placeholder="Nome do insumo"
                  className="h-9 min-w-[180px] flex-1"
                />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-slate-400">R$</span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={freeCost}
                    onChange={(e) => setFreeCost(e.target.value)}
                    disabled={disabled || savingFree}
                    placeholder="0,00"
                    className="h-9 w-24 text-right tabular-nums"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void addFree()}
                  disabled={disabled || savingFree}
                  className="h-9"
                >
                  {savingFree ? 'Salvando…' : 'Adicionar'}
                </Button>
              </div>
              {canManageCatalog ? (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={saveToCatalog}
                    onChange={(e) => setSaveToCatalog(e.target.checked)}
                    disabled={disabled || savingFree}
                  />
                  Salvar também no catálogo de insumos
                </label>
              ) : null}
              {freeError ? (
                <span className="block text-[11px] text-destructive">{freeError}</span>
              ) : null}
            </div>
          ) : null}

          {mode === 'tuss' ? (
            <div className="space-y-1">
              <div className="text-[11px] text-slate-500">
                Material do catálogo TUSS tabela 19 (custo pode ser informado por lançamento):
              </div>
              <TussTypeahead
                key={tussKey}
                table="19"
                value={tussPicker}
                onChange={addFromTuss}
                placeholder="+ Adicionar material TUSS…"
                hideListButton
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Helper de validacao: retorna a lista se todas as quantidades e custos
 * forem válidos e cada linha tiver ao menos um identificador; senão null.
 * Custo vazio é permitido (pendência).
 */
export function validateMaterials(items: MaterialDraft[]): MaterialDraft[] | null {
  for (const m of items) {
    if (!Number.isFinite(m.quantity) || m.quantity < 1 || !Number.isInteger(m.quantity)) {
      return null
    }
    if (!m.materialId && !m.materialName && !m.tussCode) {
      return null
    }
    if (m.costReais.trim() !== '' && parseReaisToCents(m.costReais) === null) {
      return null
    }
  }
  return items
}
