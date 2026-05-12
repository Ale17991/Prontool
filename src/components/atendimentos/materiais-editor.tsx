'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TussTypeahead, type TussTypeaheadValue } from '@/components/tuss/tuss-typeahead'

export interface MaterialDraft {
  tussCode: string
  tussDescription: string
  quantity: number
}

export interface MateriaisEditorProps {
  value: MaterialDraft[]
  onChange: (next: MaterialDraft[]) => void
  disabled?: boolean
  /** Inicia expandido (default false). */
  defaultOpen?: boolean
}

/**
 * Editor opcional de materiais (TUSS tabela 19) para um atendimento
 * em criacao. Estado totalmente controlado pelo parent — este componente
 * apenas renderiza e dispara onChange.
 *
 * Comportamento (feature 007):
 *   - Colapsada por padrao (pode-se forcar via defaultOpen)
 *   - Sem nenhum material adicionado: salvavel sem efeito
 *   - "+ Adicionar material" abre typeahead TUSS tabela 19
 *   - Cada linha: codigo + descricao + input numerico de quantidade + X
 *   - Aceita duplicatas (mesmo codigo em linhas separadas)
 *   - Quantidade < 1 mostra erro inline e o submit do parent deve barrar
 */
export function MateriaisEditor({
  value,
  onChange,
  disabled = false,
  defaultOpen = false,
}: MateriaisEditorProps) {
  const [expanded, setExpanded] = useState(defaultOpen)
  const [picker, setPicker] = useState<TussTypeaheadValue | null>(null)
  const [pickerKey, setPickerKey] = useState(0)

  function addMaterial(item: TussTypeaheadValue | null) {
    if (!item) return
    onChange([
      ...value,
      { tussCode: item.code, tussDescription: item.description, quantity: 1 },
    ])
    // reset typeahead para escolher proximo item
    setPicker(null)
    setPickerKey((k) => k + 1)
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

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

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
        <div className="space-y-2 border-t border-slate-200 px-3 py-3">
          {value.length > 0 ? (
            <ul className="space-y-1.5">
              {value.map((m, i) => {
                const invalid = !Number.isFinite(m.quantity) || m.quantity < 1
                return (
                  <li
                    key={`${m.tussCode}-${i}`}
                    className="flex flex-wrap items-start gap-2 rounded border border-slate-200 bg-white p-2 text-xs"
                  >
                    <span className="font-mono font-bold text-slate-900">{m.tussCode}</span>
                    <span className="min-w-0 flex-1 text-slate-700">{m.tussDescription}</span>
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
                        className={`h-7 w-14 text-center tabular-nums ${invalid ? 'border-red-400 focus-visible:ring-red-300' : ''}`}
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
                        className="ml-1 h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                        title="Remover material"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    {invalid ? (
                      <span className="basis-full text-[11px] text-red-600">
                        Quantidade deve ser um número inteiro maior que zero.
                      </span>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          ) : null}

          <div className="space-y-1">
            <div className="text-[11px] text-slate-500">
              Selecione um material no catálogo TUSS tabela 19:
            </div>
            <TussTypeahead
              key={pickerKey}
              table="19"
              value={picker}
              onChange={addMaterial}
              placeholder="+ Adicionar material…"
              hideListButton
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Helper de validacao: retorna lista de materiais validos (quantity > 0)
 * ou null caso haja entradas invalidas.
 */
export function validateMaterials(items: MaterialDraft[]): MaterialDraft[] | null {
  for (const m of items) {
    if (!Number.isFinite(m.quantity) || m.quantity < 1 || !Number.isInteger(m.quantity)) {
      return null
    }
    if (!m.tussCode || !m.tussDescription) {
      return null
    }
  }
  return items
}
