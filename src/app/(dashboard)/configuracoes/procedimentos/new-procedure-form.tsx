'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import {
  TussTableBadge,
  type TussTable,
  TUSS_TABLES,
} from './tuss-table-badge'
import { TussTypeahead, type TussTypeaheadValue } from '@/components/tuss/tuss-typeahead'

export function NewProcedureForm() {
  const router = useRouter()
  const [tussTable, setTussTable] = useState<TussTable>('22')
  const [selected, setSelected] = useState<TussTypeaheadValue | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [customCode, setCustomCode] = useState('')
  const [defaultAmount, setDefaultAmount] = useState('')
  const [coveredByPlan, setCoveredByPlan] = useState(true)
  const [isUnlisted, setIsUnlisted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Trocar de tabela invalida a seleção atual.
  useEffect(() => {
    setSelected(null)
  }, [tussTable])

  // Ao marcar "Não listado": apenas limpa a seleção TUSS prévia.
  // Cobertura por plano fica independente — pacotes negociados podem
  // ser unlisted + cobertos por convênio específico (migration 0067).
  useEffect(() => {
    if (isUnlisted) {
      setSelected(null)
    }
  }, [isUnlisted])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (isUnlisted) {
      if (displayName.trim().length === 0) {
        setError('Informe um nome de exibição para o procedimento não listado.')
        return
      }
    } else if (!selected) {
      setError('Selecione um código TUSS.')
      return
    }
    setPending(true)
    setError(null)
    setSuccess(null)

    let defaultAmountCents: number | null = null
    const trimmedAmount = defaultAmount.trim().replace(',', '.')
    if (trimmedAmount.length > 0) {
      const parsed = Number(trimmedAmount)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setPending(false)
        setError('Valor particular inválido.')
        return
      }
      defaultAmountCents = Math.round(parsed * 100)
    }

    try {
      const res = await fetch('/api/procedimentos', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tuss_code: isUnlisted ? null : selected?.code,
          display_name: displayName.trim() || null,
          default_amount_cents: defaultAmountCents,
          covered_by_plan: coveredByPlan,
          is_unlisted: isUnlisted,
          custom_code: isUnlisted && customCode.trim() ? customCode.trim() : null,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      const label = isUnlisted
        ? customCode.trim() || displayName.trim()
        : selected?.code
      setSuccess(`Procedimento ${label} cadastrado.`)
      setSelected(null)
      setDisplayName('')
      setCustomCode('')
      setDefaultAmount('')
      setCoveredByPlan(true)
      setIsUnlisted(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2 text-xs">
        <input
          type="checkbox"
          checked={isUnlisted}
          onChange={(e) => setIsUnlisted(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-semibold text-slate-900">Procedimento não listado</span>
          <span className="block text-slate-500">
            Marque para cadastrar um procedimento local sem código TUSS oficial
            (ex.: pacote negociado com convênio). O nome de exibição é obrigatório.
          </span>
        </span>
      </label>

      {isUnlisted ? (
        <div className="space-y-1.5">
          <Label htmlFor="custom-code" className="text-xs">
            Código personalizado <span className="text-slate-400">(opcional)</span>
          </Label>
          <Input
            id="custom-code"
            value={customCode}
            onChange={(e) => setCustomCode(e.target.value)}
            placeholder="Ex.: PKG-001, ORTO-15"
            maxLength={50}
          />
          <p className="text-[10px] text-slate-500">
            Código livre da clínica. Se já existir, será reutilizado. Deixe em branco
            para criar procedimento sem código.
          </p>
        </div>
      ) : null}

      {!isUnlisted ? (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">Tipo de item</Label>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de item TUSS">
              {TUSS_TABLES.map((opt) => {
                const active = tussTable === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTussTable(opt.value)}
                    className={cn(
                      'rounded-md border px-3 py-2 text-left text-xs transition-colors',
                      active ? opt.selectedClass : 'border-slate-200 bg-white hover:bg-slate-50',
                    )}
                  >
                    <span className="block font-bold text-slate-900">{opt.label}</span>
                    <span className="block text-[10px] text-slate-500">Tabela {opt.value}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor="tuss-typeahead">
              Código TUSS
            </Label>
            <TussTypeahead
              id="tuss-typeahead"
              table={tussTable}
              value={selected}
              onChange={setSelected}
            />
          </div>

          {selected ? (
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-blue-500">
                  Selecionado
                </p>
                <TussTableBadge table={selected.tussTable} />
              </div>
              <p className="font-mono text-xs font-bold text-primary">{selected.code}</p>
              <p className="text-xs text-slate-700">{selected.description}</p>
              {selected.manufacturer ? (
                <p className="text-[11px] text-slate-500">{selected.manufacturer}</p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div className="space-y-1.5">
        <Label htmlFor="display-name" className="text-xs">
          Nome de exibição{' '}
          <span className="text-slate-400">
            {isUnlisted ? '(obrigatório)' : '(opcional)'}
          </span>
        </Label>
        <Input
          id="display-name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Ex.: Consulta fisioterapia (30 min)"
          maxLength={120}
          required={isUnlisted}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="default-amount" className="text-xs">
          Valor particular (R$) <span className="text-slate-400">(opcional)</span>
        </Label>
        <Input
          id="default-amount"
          inputMode="decimal"
          placeholder="Ex.: 180,00"
          value={defaultAmount}
          onChange={(e) => setDefaultAmount(e.target.value)}
        />
        <p className="text-[10px] text-slate-500">
          Usado quando o paciente não tem plano ou o procedimento não é coberto.
        </p>
      </div>

      <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs">
        <input
          type="checkbox"
          checked={coveredByPlan}
          onChange={(e) => setCoveredByPlan(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="font-semibold text-slate-900">Coberto pelo plano de saúde</span>
          <span className="block text-slate-500">
            Quando desmarcado, este procedimento é sempre particular — não aparece nas tabelas
            de preço por convênio e usa o valor particular acima no plano de tratamento.
          </span>
        </span>
      </label>

      <Button
        type="submit"
        disabled={pending || (!isUnlisted && !selected) || (isUnlisted && displayName.trim().length === 0)}
        className="w-full"
      >
        {pending ? 'Salvando…' : 'Cadastrar procedimento'}
      </Button>

      {error ? (
        <p className="rounded-md border border-rose-100 bg-rose-50 p-3 text-xs font-medium text-rose-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-100 bg-emerald-50 p-3 text-xs font-medium text-emerald-700">
          {success}
        </p>
      ) : null}
    </form>
  )
}
